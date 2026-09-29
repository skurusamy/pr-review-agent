import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplyNotAllowedError,
  applyRun,
  assertApplicable,
  type ApplyDeps,
} from "./applyRun.js";
import type { RunRecord, ThreadRecord } from "./runRecord/types.js";

const IDENTITY = ["user.name", "t"] as const;

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "apply-test-"));
}

async function cloneOf(remote: string): Promise<string> {
  const dir = await tmp();
  const git = simpleGit();
  await git.clone(remote, dir, ["--branch", "main"]);
  const inner = simpleGit(dir);
  await inner.addConfig(...IDENTITY);
  await inner.addConfig("user.email", "t@t");
  return dir;
}

// A bare "remote" holding one base commit, and two saved patches (one per
// fix) made against it -- exactly what a dry run's record would carry.
async function fixture() {
  const remote = await tmp();
  await simpleGit(remote).init(true, ["--initial-branch=main"]);
  const seed = await tmp();
  const seedGit = simpleGit(seed);
  await seedGit.init(false, ["--initial-branch=main"]);
  await seedGit.addConfig(...IDENTITY);
  await seedGit.addConfig("user.email", "t@t");
  await writeFile(join(seed, "a.txt"), "one\ntwo\nthree\n");
  await writeFile(join(seed, "b.txt"), "alpha\nbeta\n");
  await seedGit.add(".");
  await seedGit.commit("base");
  await seedGit.addRemote("origin", remote);
  await seedGit.push("origin", "main");
  const baseSha = (await seedGit.revparse(["HEAD"])).trim();

  const work = await cloneOf(remote);
  const workGit = simpleGit(work);
  await writeFile(join(work, "a.txt"), "ONE\ntwo\nthree\n");
  await workGit.add(".");
  await workGit.commit("Fix: first");
  const patch1 = await workGit.raw(["format-patch", "-1", "--stdout", "HEAD"]);
  await writeFile(join(work, "b.txt"), "alpha\nBETA\n");
  await workGit.add(".");
  await workGit.commit("Fix: second");
  const patch2 = await workGit.raw(["format-patch", "-1", "--stdout", "HEAD"]);

  return { remote, baseSha, patch1, patch2 };
}

async function remoteLog(remote: string): Promise<string[]> {
  const log = await simpleGit(remote).raw(["log", "--format=%H", "main"]);
  return log.split("\n").filter(Boolean);
}

async function pushFromElsewhere(
  remote: string,
  file: string,
  content: string,
): Promise<void> {
  const dir = await cloneOf(remote);
  await writeFile(join(dir, file), content);
  const git = simpleGit(dir);
  await git.add(".");
  await git.commit(`someone else touches ${file}`);
  await git.push("origin", "main");
}

const thread = (
  id: number,
  path: string,
  outcome: ThreadRecord["outcome"],
): ThreadRecord => ({
  threadId: id,
  path,
  line: 1,
  outdated: false,
  reviewer: "maria",
  comment: `comment ${id}`,
  url: "u",
  log: [],
  outcome,
});

function makeRecord(
  fx: Awaited<ReturnType<typeof fixture>>,
  extra: Partial<RunRecord> = {},
): RunRecord {
  const fix = (patch: string, summary: string) => ({
    kind: "fix" as const,
    commitSha: "dryrun",
    summary,
    attempts: 1,
    gateSteps: ["typecheck"],
    patch,
  });
  return {
    id: "20260929-100000-aaaa",
    kind: "fix",
    status: "completed",
    startedAt: "2026-09-29T10:00:00.000Z",
    triggeredBy: null,
    pr: { owner: "o", repo: "r", prNumber: 1 },
    dryRun: true,
    headSha: fx.baseSha,
    rawLog: [],
    threads: [
      thread(1, "a.txt", fix(fx.patch1, "uppercase one")),
      thread(2, "b.txt", fix(fx.patch2, "uppercase beta")),
      thread(3, "c.ts", { kind: "draft", body: "Not a bug." }),
      thread(4, "d.ts", {
        kind: "fix-failed",
        attempts: 3,
        failedGate: "test",
        body: "Couldn't fix.",
      }),
    ],
    ...extra,
  };
}

function makeDeps(remote: string, overrides: Partial<ApplyDeps> = {}) {
  const handled = new Set<number>();
  const calls = {
    confirmations: [] as { id: number; sha: string; summary: string }[],
    reviews: [] as { rootCommentId: number; body: string }[][],
  };
  const deps: ApplyDeps = {
    checkout: async () => {
      const dir = await cloneOf(remote);
      return {
        dir,
        headRef: "main",
        headSha: (await simpleGit(dir).revparse(["HEAD"])).trim(),
        cleanup: () => rm(dir, { recursive: true, force: true }),
      };
    },
    hasExistingReply: async (id) => handled.has(id),
    postFixConfirmation: async (id, sha, summary) => {
      calls.confirmations.push({ id, sha, summary });
      handled.add(id);
    },
    createPendingReview: async (entries) => {
      calls.reviews.push(entries);
      for (const e of entries) handled.add(e.rootCommentId);
      return { created: true, reviewId: 99 };
    },
    runValidationGate: async () => ({ passed: true, ranGates: ["typecheck"] }),
    ...overrides,
  };
  return { deps, calls, handled };
}

describe("applyRun", () => {
  let fx: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    fx = await fixture();
  });

  it("pushes the saved fixes in order, confirms each, and creates one pending review", async () => {
    const { deps, calls } = makeDeps(fx.remote);
    const applied = await applyRun({ record: makeRecord(fx), deps });

    const log = await remoteLog(fx.remote);
    expect(log).toHaveLength(3); // base + 2 recreated fix commits
    expect(applied.complete).toBe(true);
    expect(applied.pushed[1]).toBe(log[1]);
    expect(applied.pushed[2]).toBe(log[0]);
    // The confirmations name the commits actually pushed, not the dry run's.
    expect(calls.confirmations).toEqual([
      { id: 1, sha: log[1], summary: "uppercase one" },
      { id: 2, sha: log[0], summary: "uppercase beta" },
    ]);
    expect(calls.reviews).toHaveLength(1);
    expect(calls.reviews[0]?.map((e) => e.rootCommentId)).toEqual([3, 4]);
    expect(calls.reviews[0]?.[0]?.body).toContain("Not a bug.");
    expect(calls.reviews[0]?.[0]?.body).toContain(
      "<!-- pr-review-agent:comment-3 -->",
    );
  });

  it("still applies when the PR moved in a way that doesn't touch the patched files", async () => {
    await pushFromElsewhere(fx.remote, "c.txt", "unrelated\n");
    const { deps } = makeDeps(fx.remote);
    const logs: string[] = [];
    const applied = await applyRun({
      record: makeRecord(fx),
      deps,
      log: (l) => logs.push(l),
    });
    expect(applied.complete).toBe(true);
    expect(await remoteLog(fx.remote)).toHaveLength(4);
    expect(logs.join("\n")).toContain("moved since the dry run");
  });

  it("pushes nothing when a patch no longer applies, but still creates the drafts", async () => {
    await pushFromElsewhere(fx.remote, "a.txt", "uno\ntwo\nthree\n");
    const before = await remoteLog(fx.remote);
    const { deps, calls } = makeDeps(fx.remote);
    const applied = await applyRun({ record: makeRecord(fx), deps });

    expect(await remoteLog(fx.remote)).toEqual(before);
    expect(calls.confirmations).toEqual([]);
    expect(applied.complete).toBe(false);
    const fixItems = applied.items.filter((i) => i.step === "fix");
    expect(fixItems.every((i) => i.status === "failed")).toBe(true);
    expect(fixItems[0]?.detail).toContain("no longer applies");
    expect(calls.reviews).toHaveLength(1);
    expect(applied.pushed).toEqual({});
  });

  it("pushes nothing when the Validation Gate fails on the patched tree", async () => {
    const { deps } = makeDeps(fx.remote, {
      runValidationGate: async () => ({
        passed: false,
        ranGates: [],
        failedGate: "test",
      }),
    });
    const applied = await applyRun({ record: makeRecord(fx), deps });
    expect(await remoteLog(fx.remote)).toHaveLength(1);
    expect(applied.complete).toBe(false);
    expect(applied.items.find((i) => i.step === "fix")?.detail).toContain(
      "Validation Gate failed at test",
    );
  });

  it("retries only what's left: no second push, no repeated confirmation", async () => {
    const first = makeDeps(fx.remote, {
      createPendingReview: async () => ({
        created: false,
        reason: "pending-review-exists",
      }),
    });
    const partial = await applyRun({
      record: makeRecord(fx),
      deps: first.deps,
    });
    expect(partial.complete).toBe(false);
    expect(partial.items.filter((i) => i.step === "draft")[0]?.status).toBe(
      "failed",
    );
    expect(await remoteLog(fx.remote)).toHaveLength(3);

    // Retry against the same GitHub state (confirmations already posted).
    const second = makeDeps(fx.remote);
    second.handled.add(1);
    second.handled.add(2);
    const done = await applyRun({
      record: makeRecord(fx, { applied: partial }),
      deps: second.deps,
    });
    expect(done.complete).toBe(true);
    expect(await remoteLog(fx.remote)).toHaveLength(3);
    expect(second.calls.confirmations).toEqual([]);
    expect(second.calls.reviews).toHaveLength(1);
  });

  it("skips anything already handled on the PR", async () => {
    const { deps, calls, handled } = makeDeps(fx.remote);
    for (const id of [1, 2, 3, 4]) handled.add(id);
    const applied = await applyRun({ record: makeRecord(fx), deps });
    expect(applied.items.every((i) => i.status === "skipped")).toBe(true);
    expect(await remoteLog(fx.remote)).toHaveLength(1);
    expect(calls.confirmations).toEqual([]);
    expect(calls.reviews).toEqual([]);
    expect(applied.complete).toBe(true);
  });
});

describe("assertApplicable", () => {
  const base = {
    id: "20260929-100000-aaaa",
    kind: "fix",
    status: "completed",
    startedAt: "x",
    triggeredBy: null,
    pr: { owner: "o", repo: "r", prNumber: 1 },
    dryRun: true,
    threads: [],
    rawLog: [],
  } as RunRecord;

  it("accepts a completed dry run", () => {
    expect(() => assertApplicable(base)).not.toThrow();
  });

  it.each([
    ["a live run", { dryRun: false }],
    ["a briefing", { kind: "briefing" as const }],
    ["a run still going", { status: "running" as const }],
    ["a failed run", { status: "failed" as const }],
  ])("refuses %s", (_name, extra) => {
    expect(() => assertApplicable({ ...base, ...extra })).toThrow(
      ApplyNotAllowedError,
    );
  });

  it("refuses a run that is already fully applied", () => {
    const applied = { at: "x", complete: true, items: [], pushed: {} };
    try {
      assertApplicable({ ...base, applied });
      expect.unreachable();
    } catch (error) {
      expect((error as ApplyNotAllowedError).code).toBe("already-applied");
    }
  });

  it("still allows a retry of a partly applied run", () => {
    const applied = { at: "x", complete: false, items: [], pushed: {} };
    expect(() => assertApplicable({ ...base, applied })).not.toThrow();
  });
});

vi.setConfig({ testTimeout: 20000 });
