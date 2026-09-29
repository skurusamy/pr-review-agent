import type { RunRecord, RunStatus } from "./types.js";

/** The light view of a record a history list needs: no logs, no patches. */
export interface RunSummary {
  id: string;
  kind: RunRecord["kind"];
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  pr: RunRecord["pr"];
  dryRun?: boolean;
  /** True once a dry run's results were applied to the PR. */
  applied?: boolean;
  /** Reviews only: how the run's threads came out. */
  tally?: { threads: number; fixes: number; drafts: number; skipped: number };
}

export function summarize(record: RunRecord): RunSummary {
  const summary: RunSummary = {
    id: record.id,
    kind: record.kind,
    status: record.status,
    startedAt: record.startedAt,
    pr: record.pr,
  };
  if (record.finishedAt) summary.finishedAt = record.finishedAt;
  if (record.dryRun !== undefined) summary.dryRun = record.dryRun;
  if (record.applied?.complete) summary.applied = true;

  if (record.kind === "review") {
    const kinds = record.threads.map((t) => t.outcome?.kind);
    summary.tally = {
      threads: record.threads.length,
      fixes: kinds.filter((k) => k === "fix").length,
      // A failed fix falls back to a draft reply, so it counts as one.
      drafts: kinds.filter((k) => k === "draft" || k === "fix-failed").length,
      skipped: kinds.filter((k) => k === "skipped").length,
    };
  }
  return summary;
}
