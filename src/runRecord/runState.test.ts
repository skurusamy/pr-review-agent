import { describe, expect, it } from "vitest";
import { applyEvent as serverApply } from "./applyEvent.js";
// Plain browser JS with no types -- see the header comment in runState.js.
// @ts-expect-error untyped module
import * as browser from "../../public/js/runState.js";
import type { FixEvent, RunRecord } from "./types.js";

const events: FixEvent[] = [
  {
    type: "run-started",
    owner: "o",
    repo: "r",
    prNumber: 1,
    dryRun: true,
    headSha: "abc",
  },
  {
    type: "thread-started",
    threadId: 1,
    path: "src/a.ts",
    line: 3,
    outdated: false,
    reviewer: "maria",
    comment: "null?",
    url: "https://x/1",
  },
  { type: "thread-log", threadId: 1, kind: "tool", text: "[tool] Read a.ts" },
  { type: "thread-verdict", threadId: 1, verdict: "bug", reasoning: "yes" },
  {
    type: "thread-outcome",
    threadId: 1,
    outcome: {
      kind: "fix",
      commitSha: "abc123",
      summary: "guard null",
      attempts: 1,
      gateSteps: ["typecheck", "lint", "test"],
      patch: "diff",
    },
  },
  {
    type: "thread-started",
    threadId: 2,
    path: "src/b.ts",
    line: null,
    outdated: true,
    reviewer: "tom",
    comment: "rename",
    url: "https://x/2",
  },
  {
    type: "thread-outcome",
    threadId: 2,
    outcome: { kind: "skipped", reason: "already-handled" },
  },
  // An event for a thread that never started must be ignored by both.
  { type: "thread-verdict", threadId: 99, verdict: "bug", reasoning: "x" },
];

const start = {
  id: "20260929-183012-a3f9",
  kind: "fix",
  status: "running",
  threads: [],
  rawLog: [],
};

describe("browser runState matches the server's applyEvent", () => {
  it("folds the same events to the same record at every step", () => {
    let server = start as unknown as RunRecord;
    let client = start;
    for (const event of events) {
      server = serverApply(server, event);
      client = browser.applyEvent(client, event);
      expect(client).toEqual(server);
    }
  });
});

describe("groupThreads", () => {
  const thread = (id: number, outcome?: object) => ({
    threadId: id,
    path: "a",
    line: 1,
    outdated: false,
    reviewer: "r",
    comment: "c",
    url: "u",
    log: [],
    ...(outcome ? { outcome } : {}),
  });

  it("orders groups and puts drafts and failed fixes under attention", () => {
    const groups = browser.groupThreads({
      status: "completed",
      dryRun: true,
      threads: [
        thread(1, { kind: "skipped", reason: "already-handled" }),
        thread(2, { kind: "fix" }),
        thread(3, { kind: "draft" }),
        thread(4, { kind: "fix-failed" }),
      ],
    });
    expect(groups.map((g: { key: string }) => g.key)).toEqual([
      "attention",
      "fixes",
      "skipped",
    ]);
    expect(
      groups[0].threads.map((t: { threadId: number }) => t.threadId),
    ).toEqual([3, 4]);
    expect(groups[1].title).toBe("Fixes ready to push");
  });

  it("shows a thread with no outcome as in progress, then interrupted once the run ended", () => {
    const running = { status: "running", threads: [thread(1)] };
    expect(browser.groupThreads(running)[0].key).toBe("progress");
    const stopped = { status: "stopped", threads: [thread(1)] };
    expect(browser.groupThreads(stopped)[0].key).toBe("interrupted");
  });

  it("titles the fixes group 'pushed' for a live run", () => {
    const groups = browser.groupThreads({
      status: "completed",
      dryRun: false,
      threads: [thread(1, { kind: "fix" })],
    });
    expect(groups[0].title).toBe("Fixes pushed");
  });
});
