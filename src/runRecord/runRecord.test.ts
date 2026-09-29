import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEvent } from "./applyEvent.js";
import { RunRecorder } from "./recorder.js";
import { FileRunStore, isRunId, newRunId } from "./runStore.js";
import type { ReviewEvent, RunRecord } from "./types.js";

const base: RunRecord = {
  id: "20260929-183012-a3f9",
  kind: "review",
  status: "running",
  startedAt: "2026-09-29T18:30:12.000Z",
  triggeredBy: null,
  pr: { owner: "o", repo: "r", prNumber: 1 },
  threads: [],
  rawLog: [],
};

const started: ReviewEvent = {
  type: "thread-started",
  threadId: 7,
  path: "src/a.ts",
  line: 3,
  outdated: false,
  reviewer: "maria",
  comment: "null?",
  url: "https://github.com/o/r/pull/1#discussion_r7",
};

describe("applyEvent", () => {
  it("folds a thread's events into its record without mutating the input", () => {
    let record = applyEvent(base, started);
    record = applyEvent(record, {
      type: "thread-log",
      threadId: 7,
      kind: "tool",
      text: "[tool] Read a.ts",
    });
    record = applyEvent(record, {
      type: "thread-verdict",
      threadId: 7,
      verdict: "bug",
      reasoning: "yes",
    });
    record = applyEvent(record, {
      type: "thread-outcome",
      threadId: 7,
      outcome: { kind: "draft", body: "hi" },
    });

    expect(base.threads).toEqual([]);
    expect(record.threads).toHaveLength(1);
    expect(record.threads[0]).toMatchObject({
      threadId: 7,
      verdict: "bug",
      reasoning: "yes",
      outcome: { kind: "draft", body: "hi" },
      log: [{ kind: "tool", text: "[tool] Read a.ts" }],
    });
  });

  it("records the run's dry-run flag and head sha", () => {
    const record = applyEvent(base, {
      type: "run-started",
      owner: "o",
      repo: "r",
      prNumber: 1,
      dryRun: true,
      headSha: "abc",
    });
    expect(record).toMatchObject({ dryRun: true, headSha: "abc" });
  });

  it("ignores events for an unknown thread", () => {
    const record = applyEvent(base, {
      type: "thread-verdict",
      threadId: 99,
      verdict: "bug",
      reasoning: "x",
    });
    expect(record.threads).toEqual([]);
  });
});

describe("run ids", () => {
  it("are time-sortable and match the accepted format", () => {
    const a = newRunId(new Date("2026-09-29T18:30:12Z"));
    const b = newRunId(new Date("2026-09-29T18:30:13Z"));
    expect(isRunId(a)).toBe(true);
    expect(a.slice(0, 15) < b.slice(0, 15)).toBe(true);
    expect(a).toMatch(/^20260929-183012-[0-9a-f]{4}$/);
  });

  it("reject anything that could escape the store directory", () => {
    expect(isRunId("../../etc/passwd")).toBe(false);
    expect(isRunId("20260929-183012-a3f9.json")).toBe(false);
  });
});

describe("FileRunStore", () => {
  it("saves, reads back, and lists newest first", async () => {
    const store = new FileRunStore(await mkdtemp(join(tmpdir(), "runs-")));
    const older = { ...base, id: "20260929-100000-aaaa" };
    const newer = { ...base, id: "20260929-110000-bbbb" };
    await store.save(older);
    await store.save(newer);

    expect(await store.get(newer.id)).toEqual(newer);
    expect((await store.list()).map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  it("returns undefined for a missing or malformed id, and [] for no dir", async () => {
    const store = new FileRunStore(join(tmpdir(), "does-not-exist-runs"));
    expect(await store.get("20260929-100000-aaaa")).toBeUndefined();
    expect(await store.get("../secret")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("refuses to save a record with an invalid id", async () => {
    const store = new FileRunStore(await mkdtemp(join(tmpdir(), "runs-")));
    await expect(store.save({ ...base, id: "../x" })).rejects.toThrow();
  });
});

describe("RunRecorder", () => {
  it("saves incrementally and ends with the final status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runs-"));
    const store = new FileRunStore(dir);
    const recorder = new RunRecorder(store, {
      kind: "review",
      pr: base.pr,
    });
    await recorder.start();
    expect((await store.get(recorder.id))?.status).toBe("running");

    recorder.log({ kind: "info", text: "hello" });
    recorder.event(started);
    await recorder.finish("stopped");

    const saved = JSON.parse(
      await readFile(join(dir, `${recorder.id}.json`), "utf-8"),
    ) as RunRecord;
    expect(saved.status).toBe("stopped");
    expect(saved.finishedAt).toBeDefined();
    expect(saved.rawLog).toEqual([{ kind: "info", text: "hello" }]);
    expect(saved.threads).toHaveLength(1);
    expect(saved.triggeredBy).toBeNull();
  });

  it("records the error message on failure", async () => {
    const store = new FileRunStore(await mkdtemp(join(tmpdir(), "runs-")));
    const recorder = new RunRecorder(store, { kind: "briefing", pr: base.pr });
    await recorder.finish("failed", "boom");
    expect(await store.get(recorder.id)).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });
});

describe("run history helpers", () => {
  const record = (id: string, extra: Partial<RunRecord> = {}): RunRecord => ({
    ...base,
    id,
    ...extra,
  });

  it("summarize drops logs and patches and tallies outcomes", async () => {
    const { summarize } = await import("./summary.js");
    const thread = (
      threadId: number,
      outcome?: RunRecord["threads"][number]["outcome"],
    ) => ({
      threadId,
      path: "a",
      line: 1,
      outdated: false,
      reviewer: "r",
      comment: "c",
      url: "u",
      log: [{ kind: "info" as const, text: "x" }],
      ...(outcome ? { outcome } : {}),
    });
    const summary = summarize(
      record("20260929-100000-aaaa", {
        dryRun: true,
        rawLog: [{ kind: "info", text: "line" }],
        threads: [
          thread(1, {
            kind: "fix",
            commitSha: "s",
            summary: "x",
            attempts: 1,
            gateSteps: [],
            patch: "PATCH",
          }),
          thread(2, { kind: "draft", body: "b" }),
          thread(3, {
            kind: "fix-failed",
            attempts: 3,
            failedGate: "test",
            body: "b",
          }),
          thread(4, { kind: "skipped", reason: "already-handled" }),
          thread(5),
        ],
      }),
    );
    expect(summary.tally).toEqual({
      threads: 5,
      fixes: 1,
      drafts: 2,
      skipped: 1,
    });
    expect(summary.dryRun).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("PATCH");
    expect(summary).not.toHaveProperty("rawLog");
    expect(summary).not.toHaveProperty("threads");
  });

  it("summarize gives briefings no tally", async () => {
    const { summarize } = await import("./summary.js");
    const summary = summarize(
      record("20260929-100000-bbbb", { kind: "briefing" }),
    );
    expect(summary.tally).toBeUndefined();
  });

  it("pruneRuns keeps only the newest max records", async () => {
    const { pruneRuns } = await import("./maintenance.js");
    const store = new FileRunStore(await mkdtemp(join(tmpdir(), "runs-")));
    for (const id of [
      "20260929-100000-aaaa",
      "20260929-110000-bbbb",
      "20260929-120000-cccc",
    ]) {
      await store.save(record(id));
    }
    expect(await pruneRuns(store, 2)).toBe(1);
    expect(await store.listIds()).toEqual([
      "20260929-120000-cccc",
      "20260929-110000-bbbb",
    ]);
    expect(await pruneRuns(store, 2)).toBe(0);
  });

  it("sweepOrphanedRuns stops running records and leaves finished ones alone", async () => {
    const { sweepOrphanedRuns } = await import("./maintenance.js");
    const store = new FileRunStore(await mkdtemp(join(tmpdir(), "runs-")));
    await store.save(record("20260929-100000-aaaa", { status: "running" }));
    await store.save(record("20260929-110000-bbbb", { status: "completed" }));
    expect(await sweepOrphanedRuns(store)).toBe(1);
    expect(await store.get("20260929-100000-aaaa")).toMatchObject({
      status: "stopped",
      error: expect.stringContaining("restarted"),
    });
    expect((await store.get("20260929-110000-bbbb"))?.status).toBe("completed");
  });
});
