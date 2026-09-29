import type { LogLineKind } from "../logFormat.js";

export type RunStatus = "running" | "completed" | "failed" | "stopped";

export interface LogEntry {
  kind: LogLineKind;
  text: string;
}

/**
 * What became of one review thread. `fix` carries the full patch of the fix
 * commit (a Dry Run's checkout is deleted, so this is the only surviving
 * copy) plus the PR head it was made against; `skipped` says why.
 */
export type ThreadOutcome =
  | {
      kind: "fix";
      commitSha: string;
      summary: string;
      attempts: number;
      gateSteps: string[];
      patch: string;
    }
  | { kind: "draft"; body: string }
  | {
      kind: "fix-failed";
      attempts: number;
      failedGate: string;
      body: string;
    }
  | { kind: "skipped"; reason: "already-handled" | "no-verdict" };

export interface ThreadInfo {
  threadId: number;
  path: string;
  line: number | null;
  outdated: boolean;
  reviewer: string;
  comment: string;
  url: string;
}

/** Structured progress of a Review Run, emitted alongside the text log. */
export type ReviewEvent =
  | {
      type: "run-started";
      owner: string;
      repo: string;
      prNumber: number;
      dryRun: boolean;
      headSha: string;
    }
  | ({ type: "thread-started" } & ThreadInfo)
  | ({ type: "thread-log"; threadId: number } & LogEntry)
  | {
      type: "thread-verdict";
      threadId: number;
      verdict: "bug" | "not-a-bug";
      reasoning: string;
    }
  | { type: "thread-outcome"; threadId: number; outcome: ThreadOutcome };

export interface ThreadRecord extends ThreadInfo {
  verdict?: "bug" | "not-a-bug";
  reasoning?: string;
  outcome?: ThreadOutcome;
  log: LogEntry[];
}

/**
 * The saved, durable account of one Review Run or PR Briefing. One record
 * type for both, discriminated by `kind`; `triggeredBy` is null until v1's
 * single shared token gives way to per-user identity.
 */
export interface RunRecord {
  id: string;
  kind: "review" | "briefing";
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  triggeredBy: string | null;
  pr: { owner: string; repo: string; prNumber: number };
  dryRun?: boolean;
  headSha?: string;
  threads: ThreadRecord[];
  rawLog: LogEntry[];
  briefingMarkdown?: string;
  error?: string;
}
