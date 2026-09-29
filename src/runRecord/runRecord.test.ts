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
