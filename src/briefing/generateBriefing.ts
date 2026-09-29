import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { PrContext } from "./fetchPrContext.js";
import {
  parseChangedFiles,
  formatChangedFilesTree,
  type ChangedFile,
} from "./changedFilesTree.js";
import { formatThinking } from "../toolLog.js";
import {
  formatLinkedIssuesForPrompt,
  type LinkedIssue,
} from "./linkedIssues.js";
import { isMaxTurnsError, lockedDown } from "../agentSession.js";

export interface Briefing {
  summary: string;
  mermaidDiagram: string;
  risks: string[];
  changedFiles: ChangedFile[];
  /** The issues the model was given as background, so the report can show them. */
  linkedIssues: LinkedIssue[];
}

/**
 * Thrown when the model exhausts its turn budget without ever calling
 * `submit_briefing` -- same philosophy as VerdictIncompleteError: a
 * judgment the model never actually reached shouldn't masquerade as one it
 * did.
 */
export class BriefingIncompleteError extends Error {}

// No investigation loop here (there's no checkout to Read/Grep/Glob against),
// so this is really just "one turn to think, one tool call to answer" --
// a small cap is enough, and a larger one would only mask a real failure to
// call submit_briefing as looking like more thinking happened.
const MAX_TURNS = 4;

// The changed-files tree is mechanical (parseChangedFiles) and never asked
// of the model -- only the parts that need real judgment go through this
// tool, same "the tool call is the answer, never parsed from prose" rule as
// submit_verdict/submit_fix.
const submitBriefingTool = tool(
  "submit_briefing",
  "Report your briefing on this pull request for a human reviewer.",
  {
    summary: z
      .string()
      .describe(
        "A concise prose summary of what this PR does and why. If the diff seems to drift from what the title/description claims, say so explicitly here.",
      ),
    mermaidDiagram: z
      .string()
      .describe(
        "A Mermaid diagram (flowchart or sequence, whichever fits) sketching the SHAPE of this change -- e.g. new or altered control flow -- not a literal file listing.",
      ),
    risks: z
      .array(z.string())
      .describe(
        "Specific things a reviewer should double-check, ordered by importance. Empty array if genuinely nothing stands out.",
      ),
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (_input) => {
    return { content: [{ type: "text" as const, text: "Briefing recorded." }] };
  },
);

export function buildBriefingPrompt(
  context: PrContext,
  changedFiles: ChangedFile[],
): string {
  const conversation =
    context.comments.length > 0
      ? `\n\nExisting conversation on this PR:\n${context.comments.map((c) => `- ${c.author}: ${c.body}`).join("\n")}`
      : "";

  // Only when there is something to compare against; otherwise the model
  // would be told to check an issue that doesn't exist.
  const issueInstruction =
    (context.linkedIssues?.length ?? 0) > 0
      ? " Where a linked issue says what this change is for, say in the summary whether the diff appears to deliver it, and list anything the issue asks for that the diff does not do. Linked pull requests are background only."
      : "";

  return `A teammate is about to review this pull request. Give them a briefing.

Title: ${context.title}

Description:
${context.description ?? "(no description provided)"}${formatLinkedIssuesForPrompt(context.linkedIssues ?? [])}
${conversation}

Changed files (mechanical, already computed -- for your own context, not something to repeat):
${formatChangedFilesTree(changedFiles)}

Full diff:
${context.diff}

Investigate nothing beyond what's above -- there's no local checkout to read.
Decide what a reviewer most needs to know: what this change actually does,
whether the diff matches what the title/description claim, a diagram
sketching the shape of the change, and the specific things worth
double-checking.${issueInstruction}
When ready, call submit_briefing exactly once.`;
}

/**
 * The SDK options for a Briefing session, a pure function so a test can pin
 * the security-relevant parts. The prompt carries a PR's title, description,
 * conversation and diff, all written by other people, and the session has
 * nothing to investigate: `tools` is empty (no built-in tools exist for the
 * model, only `submit_briefing`), no settings are loaded, and the GitHub token
 * is not in its environment. `cwd` is the system temp directory rather than
 * the server's own working directory, which holds this app's `.env`.
 */
export function buildBriefingQueryOptions(
  briefingServer: ReturnType<typeof createSdkMcpServer>,
  abortController?: AbortController,
  processEnv: NodeJS.ProcessEnv = process.env,
): Options {
  return {
    cwd: tmpdir(),
    model: "claude-sonnet-5",
    maxTurns: MAX_TURNS,
    thinking: { type: "adaptive", display: "summarized" },
    ...lockedDown([], processEnv),
    allowedTools: ["mcp__briefing-tools__submit_briefing"],
    mcpServers: { "briefing-tools": briefingServer },
    ...(abortController ? { abortController } : {}),
  };
}

/**
 * Runs a single, read-only Claude Agent SDK session to produce a PR
 * Briefing. No checkout, no investigative tools (Read/Grep/Glob) -- there's
 * nothing local to look at, only the PR's own metadata and diff.
 */
export async function generateBriefing(
  context: PrContext,
  log: (line: string) => void = console.log,
  abortController?: AbortController,
): Promise<Briefing> {
  const changedFiles = parseChangedFiles(context.diff);

  const briefingServer = createSdkMcpServer({
    name: "briefing-tools",
    version: "1.0.0",
    tools: [submitBriefingTool],
  });

  try {
    for await (const message of query({
      prompt: buildBriefingPrompt(context, changedFiles),
      options: buildBriefingQueryOptions(briefingServer, abortController),
    })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "thinking") {
            log(formatThinking(block.thinking));
            continue;
          }
          if (block.type !== "tool_use") {
            continue;
          }
          if (block.name.endsWith("submit_briefing")) {
            const input = block.input as {
              summary: string;
              mermaidDiagram: string;
              risks: string[];
            };
            return {
              ...input,
              changedFiles,
              linkedIssues: context.linkedIssues ?? [],
            };
          }
        }
      }
    }
  } catch (error) {
    // The SDK throws (rather than ending the stream) when the turn budget
    // runs out, so the fallback below would never be reached for that case.
    if (!isMaxTurnsError(error)) throw error;
  }

  throw new BriefingIncompleteError(
    `Model exhausted ${MAX_TURNS} turns without submitting a briefing.`,
  );
}
