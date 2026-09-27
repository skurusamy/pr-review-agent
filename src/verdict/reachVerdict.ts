import {
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ReviewThread } from "../github/types.js";
import { formatToolUse, formatThinking, isNoiseTool } from "../toolLog.js";

export interface Verdict {
  verdict: "bug" | "not-a-bug";
  reasoning: string;
}

/**
 * Thrown when the model exhausts its turn budget without ever calling
 * `submit_verdict`. This is deliberately NOT treated as a "not-a-bug"
 * verdict — a judgment the model never actually reached shouldn't
 * masquerade as one it did. The caller decides what to do (skip + log).
 */
export class VerdictIncompleteError extends Error {}

// A circuit breaker for the agent loop: each turn is a real, billed API call,
// and the model decides for itself when to stop calling tools. Without a hard
// ceiling, an ambiguous comment could make it loop indefinitely. 8 is enough
// for a few Read/Grep/Glob calls to actually investigate, plus the final
// submit_verdict call.
const MAX_TURNS = 8;

// The one custom tool the model has, beyond the SDK's built-in read-only
// tools (Read/Grep/Glob, restricted via allowedTools below). Everything the
// model concludes has to come through this call — we never try to parse a
// verdict out of free-text, which would be unreliable. Zod's schema doubles
// as the tool's input validation AND the source of the JSON schema Claude
// sees describing what arguments to pass.
const submitVerdictTool = tool(
  "submit_verdict",
  "Report your final verdict on whether the review comment points at a real bug in the code.",
  {
    verdict: z
      .enum(["bug", "not-a-bug"])
      .describe("Whether this review comment is pointing at a real bug"),
    reasoning: z.string().describe("A brief explanation for the verdict"),
  },
  // This handler's return value is what the MODEL sees as the tool's result
  // (a normal MCP tool response) — it is NOT how we get the verdict back into
  // our own code. We capture that separately, by scanning the message stream
  // for this tool's tool_use block (see the loop below). The handler just
  // needs to acknowledge so the SDK's turn completes cleanly.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (_input) => {
    return { content: [{ type: "text" as const, text: "Verdict recorded." }] };
  },
);

export function buildPrompt(thread: ReviewThread): string {
  const { rootComment, replies } = thread;

  // Existing human replies are useful reasoning context (e.g. "this is
  // intentional, see line 40") — separate from the Agent Marker used later
  // for idempotency, which only cares whether OUR OWN bot reply exists.
  const replyContext =
    replies.length > 0
      ? `\n\nExisting replies in this thread:\n${replies.map((r) => `- ${r.author}: ${r.body}`).join("\n")}`
      : "";

  const outdatedNote = rootComment.outdated
    ? "\n\nNote: this comment's diff position is outdated (the PR has moved since it was written); the original line number may no longer be accurate."
    : "";

  return `A reviewer left this comment on a pull request.

File: ${rootComment.path}
Line: ${rootComment.line ?? rootComment.originalLine}

Diff context:
${rootComment.diffHunk}

Comment: "${rootComment.body}"${replyContext}${outdatedNote}

Investigate the surrounding code in this checkout using the Read, Grep, and
Glob tools as needed, then decide whether this comment is pointing at a real
bug in the code, or something else (a question, a style nit, a false
positive, or something already addressed). When you have decided, call
submit_verdict exactly once with your verdict and reasoning.`;
}

/**
 * Runs a single Claude Agent SDK loop, scoped to one review comment thread,
 * to reach a Verdict on it. The model can freely read the checked-out repo
 * (via the built-in Read/Grep/Glob tools) but can't write anything — this is
 * a read-only investigation, not the Fix Attempt.
 */
export async function reachVerdict(
  checkoutDir: string,
  thread: ReviewThread,
  log: (line: string) => void = console.log,
): Promise<Verdict> {
  const verdictServer = createSdkMcpServer({
    name: "verdict-tools",
    version: "1.0.0",
    tools: [submitVerdictTool],
  });

  for await (const message of query({
    prompt: buildPrompt(thread),
    options: {
      cwd: checkoutDir,
      model: "claude-sonnet-5",
      maxTurns: MAX_TURNS,
      // Adaptive: Claude decides when and how much to think. 'summarized'
      // display keeps what we log readable -- the raw chain can be long
      // prose, and this is a log line, not a transcript viewer.
      thinking: { type: "adaptive", display: "summarized" },
      // Read-only investigation tools plus our one custom "answer" tool.
      // Custom SDK MCP tools are addressed as mcp__<serverName>__<toolName>.
      allowedTools: [
        "Read",
        "Grep",
        "Glob",
        "mcp__verdict-tools__submit_verdict",
      ],
      mcpServers: { "verdict-tools": verdictServer },
    },
  })) {
    // An "assistant" SDKMessage wraps a real Anthropic Messages API message
    // under `.message` (role, content blocks, stop_reason, usage) — the outer
    // SDKMessage envelope is the harness's own bookkeeping, not part of what
    // was actually said. We're scanning for tool_use and thinking content
    // blocks, since those are the only places worth logging.
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "thinking") {
          log(formatThinking(block.thinking));
          continue;
        }
        if (block.type !== "tool_use") {
          continue;
        }
        if (block.name.endsWith("submit_verdict")) {
          const input = block.input as Verdict;
          return { verdict: input.verdict, reasoning: input.reasoning };
        }
        if (isNoiseTool(block.name)) {
          continue;
        }
        // Investigation tools (Read/Grep/Glob) -- logged so there's some
        // visibility into what the agent actually looked at, short of full
        // tracing (that's what Langfuse would give, if it existed here).
        log(formatToolUse(block.name, block.input, checkoutDir));
      }
    }
  }

  throw new VerdictIncompleteError(
    `Model exhausted ${MAX_TURNS} turns without submitting a verdict for ${thread.rootComment.htmlUrl}`,
  );
}

/**
 * Decides what ACTION a comment's thread should take, combining its Verdict
 * with its outdated flag. Kept separate from reachVerdict: reaching a
 * judgment and deciding what to do about it are different questions. An
 * outdated comment always routes to a Draft Reply — even a "bug" verdict —
 * since attempting a Fix Attempt against a diff position that's moved risks
 * editing the wrong thing.
 */
export function decideAction(
  thread: ReviewThread,
  verdict: Verdict,
): "fix" | "draft-reply" {
  if (thread.rootComment.outdated) {
    return "draft-reply";
  }
  return verdict.verdict === "bug" ? "fix" : "draft-reply";
}
