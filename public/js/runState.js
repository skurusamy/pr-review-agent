// Browser-side twin of src/runRecord/applyEvent.ts: folds the events a
// Fix Run streams into a run record shaped like the saved RunRecord, so
// the same renderer can draw a live run and (later) a saved one. There is no
// build step to share the TypeScript file, so this is a deliberate copy --
// src/runRecord/runState.test.ts feeds both the same events and fails if they
// ever drift apart.

export function newRun(id) {
  return { id, kind: "fix", status: "running", threads: [], rawLog: [] };
}

export function applyEvent(record, event) {
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
    default:
      return record;
  }
}

function updateThread(record, threadId, update) {
  return {
    ...record,
    threads: record.threads.map((t) =>
      t.threadId === threadId ? update(t) : t,
    ),
  };
}

// The result list's groups, in the order the prototype settled on: what is
// still running first, then what needs a human, then fixes, then skipped.
// A thread with no outcome in a run that has ended never finished.
export function groupThreads(record) {
  const ended = record.status !== "running";
  const groups = [
    { key: "progress", title: "In progress", threads: [] },
    {
      key: "attention",
      title: "Needs your attention: draft replies to review",
      threads: [],
    },
    {
      key: "fixes",
      title:
        record.dryRun && !record.applied?.complete
          ? "Fixes ready to push"
          : "Fixes pushed",
      threads: [],
    },
    { key: "skipped", title: "Skipped", threads: [] },
    { key: "interrupted", title: "Interrupted", threads: [] },
  ];
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const thread of record.threads) {
    const kind = thread.outcome?.kind;
    const key = !kind
      ? ended
        ? "interrupted"
        : "progress"
      : kind === "fix"
        ? "fixes"
        : kind === "skipped"
          ? "skipped"
          : "attention";
    byKey[key].threads.push(thread);
  }
  return groups.filter((g) => g.threads.length > 0);
}
