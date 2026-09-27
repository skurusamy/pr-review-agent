import {
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { simpleGit, ResetMode, CleanOptions } from "simple-git";
import type { ReviewThread } from "../github/types.js";
import type { Verdict } from "../verdict/reachVerdict.js";
import {
  runValidationGate,
  type GateResult,
} from "../validation/validationGate.js";
import { formatToolUse, formatThinking, isNoiseTool } from "../toolLog.js";

export type FixResult =
  | { outcome: "fixed"; commitSha: string; summary: string }
  | { outcome: "exhausted"; attempts: number; lastFailedGate: string };

// The outer retry cap (decided earlier, alongside the Validation Gate
// concept itself) and a separate, tighter turn cap for each individual
// attempt -- editing needs more back-and-forth than the Verdict loop's
// read-only investigation, but each attempt still needs its own ceiling.
const MAX_ATTEMPTS = 3;
const MAX_TURNS_PER_ATTEMPT = 10;

// The Fix Attempt's own "I'm done" tool, separate from the Verdict loop's
// submit_verdict -- they belong to different loops with different jobs.
// Asking for a one-line summary here is what makes the eventual commit
// message meaningful instead of generic.
const submitFixTool = tool(
  "submit_fix",
  "Call this once your edit fixes the bug and is ready to be validated.",
  {
    summary: z
      .string()
      .describe("A one-line summary of the fix, for the commit message"),
  },
  async () => {
    return {
      content: [
        { type: "text" as const, text: "Fix noted; running validation now." },
      ],
    };
  },
);

function buildFixPrompt(thread: ReviewThread, verdict: Verdict): string {
  const { rootComment } = thread;
  return `A reviewer left this comment on a pull request, and it's been judged to be a real bug:

File: ${rootComment.path}
Line: ${rootComment.line ?? rootComment.originalLine}

Diff context:
${rootComment.diffHunk}

Comment: "${rootComment.body}"

Why this is a bug: ${verdict.reasoning}

Use Read/Grep/Glob to understand the surrounding code, then use Edit to fix
the bug. Make the smallest change that actually fixes it -- don't refactor
unrelated code. When you're done, call submit_fix with a one-line summary
of what you changed.`;
}

function buildRetryPrompt(gate: GateResult): string {
  return `Your fix didn't pass validation. The "${gate.failedGate}" script failed:

${gate.output}

Adjust your edit to fix this, then call submit_fix again once you believe it's ready.`;
}

interface AttemptOutcome {
  summary: string | null;
  sessionId: string;
}

// Runs one query() call to completion (or until it calls submit_fix,
// whichever comes first -- we stop consuming the stream as soon as we have
// what we need, same pattern as reachVerdict). Returns null summary if the
// model exhausted its turn budget without calling submit_fix.
async function runAttempt(
  prompt: string,
  checkoutDir: string,
  fixServer: ReturnType<typeof createSdkMcpServer>,
  log: (line: string) => void,
  resumeSessionId?: string,
): Promise<AttemptOutcome> {
  let sessionId = "";

  for await (const message of query({
    prompt,
    options: {
      cwd: checkoutDir,
      model: "claude-sonnet-5",
      maxTurns: MAX_TURNS_PER_ATTEMPT,
      permissionMode: "acceptEdits",
      // Same as reachVerdict: adaptive thinking, summarized for log
      // readability.
      thinking: { type: "adaptive", display: "summarized" },
      // Read-only investigation, targeted Edit, and the one "I'm done" tool.
      // Deliberately no Write (full-file overwrite, unnecessary for a scoped
      // fix) and no Bash -- the Validation Gate is our own deterministic
      // code, never something the agent can run itself.
      allowedTools: [
        "Read",
        "Grep",
        "Glob",
        "Edit",
        "mcp__fix-tools__submit_fix",
      ],
      mcpServers: { "fix-tools": fixServer },
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  })) {
    if ("session_id" in message && message.session_id) {
      sessionId = message.session_id;
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "thinking") {
          log(formatThinking(block.thinking));
          continue;
        }
        if (block.type !== "tool_use") {
          continue;
        }
        if (block.name.endsWith("submit_fix")) {
          const input = block.input as { summary: string };
          return { summary: input.summary, sessionId };
        }
        if (isNoiseTool(block.name)) {
          continue;
        }
        // Investigation and edit tools (Read/Grep/Glob/Edit) -- same
        // lightweight visibility as reachVerdict, not full tracing.
        log(formatToolUse(block.name, block.input, checkoutDir));
      }
    }
  }

  return { summary: null, sessionId };
}

async function commitAndPush(
  checkoutDir: string,
  thread: ReviewThread,
  summary: string,
  dryRun: boolean,
): Promise<string> {
  const git = simpleGit(checkoutDir);
  // A fresh clone has no local git identity -- set one rather than relying
  // on whatever (if anything) is configured globally on the machine this runs on.
  await git.addConfig("user.name", "pr-review-agent");
  await git.addConfig("user.email", "pr-review-agent@users.noreply.github.com");
  await git.add(".");
  const message = `Fix: ${summary}

Addresses review comment: ${thread.rootComment.htmlUrl}

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`;
  // The commit itself is local to a throwaway temp checkout -- harmless to
  // make even in a dry run, and it's what gives us a real commitSha to
  // report. Only the push actually reaches GitHub, so that's the one step
  // dry-run skips.
  const result = await git.commit(message);
  if (!dryRun) {
    await git.push();
  }
  return result.commit;
}

// Discards a failed attempt's partial edits so they don't bleed into the
// next comment's Fix Attempt within the same Review Run.
async function resetWorkingTree(checkoutDir: string): Promise<void> {
  const git = simpleGit(checkoutDir);
  await git.reset(ResetMode.HARD);
  await git.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);
}

/**
 * Attempts to fix a comment judged to be a real bug: up to 3 attempts, each
 * a resumed continuation of the same conversation (so the model sees its
 * own prior edit and the Validation Gate's failure, rather than starting
 * over from scratch each time). Commits and pushes only once the gate
 * passes; resets the working tree if all attempts are exhausted.
 */
export async function attemptFix(
  checkoutDir: string,
  thread: ReviewThread,
  verdict: Verdict,
  dryRun = false,
  log: (line: string) => void = console.log,
): Promise<FixResult> {
  const fixServer = createSdkMcpServer({
    name: "fix-tools",
    version: "1.0.0",
    tools: [submitFixTool],
  });

  let sessionId: string | undefined;
  let prompt = buildFixPrompt(thread, verdict);
  let lastFailedGate = "the agent never completed an edit";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runAttempt(
      prompt,
      checkoutDir,
      fixServer,
      log,
      sessionId,
    );
    sessionId = result.sessionId;

    if (result.summary === null) {
      prompt =
        "You didn't finish within your turn budget. Please wrap up and call submit_fix with a summary of what you changed so far.";
      continue;
    }

    const gate = await runValidationGate(checkoutDir);
    if (gate.passed) {
      const commitSha = await commitAndPush(
        checkoutDir,
        thread,
        result.summary,
        dryRun,
      );
      return { outcome: "fixed", commitSha, summary: result.summary };
    }

    lastFailedGate = gate.failedGate ?? lastFailedGate;
    prompt = buildRetryPrompt(gate);
  }

  await resetWorkingTree(checkoutDir);
  return { outcome: "exhausted", attempts: MAX_ATTEMPTS, lastFailedGate };
}
