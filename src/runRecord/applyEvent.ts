import type { ReviewEvent, RunRecord } from "./types.js";

/**
 * Folds one ReviewEvent into a record. Pure and mutation-free so the same
 * events replay to the same record, whichever code path saved them.
 */
export function applyEvent(record: RunRecord, event: ReviewEvent): RunRecord {
  switch (event.type) {
    case "run-started":
      return { ...record, dryRun: event.dryRun, headSha: event.headSha };
    case "thread-started":
      return {
        ...record,
        threads: [
          ...record.threads,
          {
            threadId: event.threadId,
            path: event.path,
            line: event.line,
            outdated: event.outdated,
            reviewer: event.reviewer,
            comment: event.comment,
            url: event.url,
            log: [],
          },
        ],
      };
    case "thread-log":
      return updateThread(record, event.threadId, (t) => ({
        ...t,
        log: [...t.log, { kind: event.kind, text: event.text }],
      }));
    case "thread-verdict":
      return updateThread(record, event.threadId, (t) => ({
        ...t,
        verdict: event.verdict,
        reasoning: event.reasoning,
      }));
    case "thread-outcome":
      return updateThread(record, event.threadId, (t) => ({
        ...t,
        outcome: event.outcome,
      }));
  }
}

function updateThread(
  record: RunRecord,
  threadId: number,
  update: (
    thread: RunRecord["threads"][number],
  ) => RunRecord["threads"][number],
): RunRecord {
  return {
    ...record,
    threads: record.threads.map((t) =>
      t.threadId === threadId ? update(t) : t,
    ),
  };
}
