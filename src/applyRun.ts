import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { Octokit } from "octokit";
import { checkoutPullRequestHead, type Checkout } from "./github/checkout.js";
import {
  createPendingReview,
  hasExistingReply,
  marker,
  postFixConfirmation,
  type CreatePendingReviewResult,
  type DraftReplyEntry,
} from "./draft/draftReply.js";
import {
  runValidationGate,
  type GateResult,
} from "./validation/validationGate.js";
import type {
  AppliedInfo,
  AppliedItem,
  RunRecord,
  ThreadRecord,
} from "./runRecord/types.js";

export class ApplyNotAllowedError extends Error {
  constructor(
    message: string,
    readonly code: "not-applicable" | "already-applied",
  ) {
    super(message);
  }
}

/** Everything applying touches outside the record, so tests can fake it. */
export interface ApplyDeps {
  checkout: () => Promise<Checkout>;
  hasExistingReply: (threadId: number) => Promise<boolean>;
  postFixConfirmation: (
    threadId: number,
    commitSha: string,
    summary: string,
  ) => Promise<void>;
  createPendingReview: (
    entries: DraftReplyEntry[],
  ) => Promise<CreatePendingReviewResult>;
  runValidationGate: (dir: string) => Promise<GateResult>;
}

export function githubApplyDeps(
  octokit: Octokit,
  pr: RunRecord["pr"],
  githubToken: string,
): ApplyDeps {
  const { owner, repo, prNumber } = pr;
  return {
    checkout: () =>
      checkoutPullRequestHead(octokit, owner, repo, prNumber, githubToken),
    hasExistingReply: (id) =>
      hasExistingReply(octokit, owner, repo, prNumber, id),
    postFixConfirmation: (id, sha, summary) =>
      postFixConfirmation(octokit, owner, repo, prNumber, id, sha, summary),
    createPendingReview: (entries) =>
      createPendingReview(octokit, owner, repo, prNumber, entries),
    runValidationGate,
  };
}

/** Throws unless this record is a completed dry run that isn't fully applied. */
export function assertApplicable(record: RunRecord): void {
  if (
    record.kind !== "review" ||
    record.dryRun !== true ||
    record.status !== "completed"
  ) {
    throw new ApplyNotAllowedError(
      "Only a completed dry run can be applied.",
      "not-applicable",
    );
  }
  if (record.applied?.complete) {
    throw new ApplyNotAllowedError(
      "This run has already been applied.",
      "already-applied",
    );
  }
}

const where = (t: ThreadRecord): string =>
  `${t.path}${t.line ? `:${t.line}` : ""}`;

/**
 * Replays a dry run's saved results onto the PR without re-running any
 * model: applies the recorded patches (in thread order) to a fresh clone,
 * re-runs the Validation Gate on the result, pushes, posts the fix
 * confirmations, and creates one pending review holding the draft replies.
 *
 * Every item is checked against its Agent Marker first, so nothing is
 * posted twice, and the returned AppliedInfo (also reported through
 * `onProgress` as it changes) lets a retry pick up where a failure left off.
 * A code problem (a patch that no longer applies, a failing gate) pushes
 * nothing but does not stop the drafts, which never touch code.
 */
export async function applyRun(options: {
  record: RunRecord;
  deps: ApplyDeps;
  log?: (line: string) => void;
  onProgress?: (applied: AppliedInfo) => void | Promise<void>;
}): Promise<AppliedInfo> {
  const { record, deps, log = () => {}, onProgress = () => {} } = options;
  assertApplicable(record);

  const applied: AppliedInfo = {
    at: record.applied?.at ?? new Date().toISOString(),
    complete: false,
    items: [],
    pushed: { ...record.applied?.pushed },
  };
  const items: AppliedItem[] = applied.items;
  const add = (
    threadId: number,
    step: AppliedItem["step"],
    status: AppliedItem["status"],
    detail?: string,
  ): void => {
    items.push({ threadId, step, status, ...(detail ? { detail } : {}) });
  };

  const fixes = record.threads.filter((t) => t.outcome?.kind === "fix");
  const drafts = record.threads.filter(
    (t) => t.outcome?.kind === "draft" || t.outcome?.kind === "fix-failed",
  );

  // ---- Fixes ----
  const toConfirm: ThreadRecord[] = [];
  const toPush: ThreadRecord[] = [];
  for (const thread of fixes) {
    if (applied.pushed[thread.threadId]) {
      toConfirm.push(thread);
    } else if (await deps.hasExistingReply(thread.threadId)) {
      add(thread.threadId, "fix", "skipped", "Already handled on the PR.");
      log(`Skipping ${where(thread)}: already handled.`);
    } else {
      toPush.push(thread);
    }
  }

  if (toPush.length > 0) {
    try {
      const shas = await pushFixes(record, toPush, deps, log);
      Object.assign(applied.pushed, shas);
      toConfirm.push(...toPush);
      await onProgress(applied);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Warning: no fix was pushed. ${message}`);
      for (const thread of toPush)
        add(thread.threadId, "fix", "failed", message);
    }
  }

  for (const thread of toConfirm) {
    const sha = applied.pushed[thread.threadId] as string;
    const outcome = thread.outcome as Extract<
      ThreadRecord["outcome"],
      { kind: "fix" }
    >;
    try {
      if (!(await deps.hasExistingReply(thread.threadId))) {
        await deps.postFixConfirmation(thread.threadId, sha, outcome.summary);
      }
      add(thread.threadId, "fix", "done", `Pushed ${sha.slice(0, 7)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(
        `Warning: pushed ${sha.slice(0, 7)} but couldn't post its confirmation. ${message}`,
      );
      add(
        thread.threadId,
        "fix",
        "failed",
        `Pushed ${sha.slice(0, 7)}, but the confirmation reply failed: ${message}`,
      );
    }
  }

  // ---- Draft replies ----
  const entries: { thread: ThreadRecord; entry: DraftReplyEntry }[] = [];
  for (const thread of drafts) {
    if (await deps.hasExistingReply(thread.threadId)) {
      add(thread.threadId, "draft", "skipped", "Already handled on the PR.");
      log(`Skipping ${where(thread)}: already handled.`);
      continue;
    }
    const outcome = thread.outcome as Extract<
      ThreadRecord["outcome"],
      { kind: "draft" | "fix-failed" }
    >;
    entries.push({
      thread,
      entry: {
        rootCommentId: thread.threadId,
        path: thread.path,
        line: thread.line as number,
        body: `${outcome.body}\n\n${marker(thread.threadId)}`,
      },
    });
  }
  if (entries.length > 0) {
    try {
      const result = await deps.createPendingReview(
        entries.map((e) => e.entry),
      );
      if (result.created) {
        log(
          `Created a pending review (id ${result.reviewId}) with ${entries.length} comment(s). Submit it on GitHub when ready.`,
        );
        for (const { thread } of entries) {
          add(thread.threadId, "draft", "done", "In the pending review.");
        }
      } else {
        const message =
          "A pending review already exists on the PR. Submit or dismiss it on GitHub, then retry.";
        log(`Warning: ${message}`);
        for (const { thread } of entries) {
          add(thread.threadId, "draft", "failed", message);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Warning: couldn't create the pending review. ${message}`);
      for (const { thread } of entries) {
        add(thread.threadId, "draft", "failed", message);
      }
    }
  }

  applied.complete = items.every((item) => item.status !== "failed");
  applied.finishedAt = new Date().toISOString();
  await onProgress(applied);
  return applied;
}

async function pushFixes(
  record: RunRecord,
  threads: ThreadRecord[],
  deps: ApplyDeps,
  log: (line: string) => void,
): Promise<Record<number, string>> {
  log("Checking out the PR's head branch...");
  const checkout = await deps.checkout();
  const patchDir = await mkdtemp(join(tmpdir(), "pr-review-agent-patches-"));
  try {
    if (record.headSha && checkout.headSha !== record.headSha) {
      log(
        `The PR has moved since the dry run (${record.headSha.slice(0, 7)} -> ${checkout.headSha.slice(0, 7)}); applying the saved patches on top of it.`,
      );
    }
    const git = simpleGit(checkout.dir);
    // git am creates real commits, which need an identity -- same as the Fix
    // Attempt's own commits.
    await git.addConfig("user.name", "pr-review-agent");
    await git.addConfig(
      "user.email",
      "pr-review-agent@users.noreply.github.com",
    );

    const shas: Record<number, string> = {};
    for (const thread of threads) {
      const outcome = thread.outcome as Extract<
        ThreadRecord["outcome"],
        { kind: "fix" }
      >;
      const file = join(patchDir, `${thread.threadId}.patch`);
      await writeFile(file, outcome.patch);
      log(`Applying the saved patch for ${where(thread)}...`);
      try {
        await git.raw(["am", "--3way", file]);
      } catch (error) {
        await git.raw(["am", "--abort"]).catch(() => {});
        const reason =
          error instanceof Error ? error.message.split("\n")[0] : "";
        throw new Error(
          `The saved patch for ${where(thread)} no longer applies (${reason}). The PR has changed since the dry run; re-run the review.`,
          { cause: error },
        );
      }
      shas[thread.threadId] = (await git.revparse(["HEAD"])).trim();
    }

    log("Re-running the Validation Gate on the patched tree...");
    const gate = await deps.runValidationGate(checkout.dir);
    if (!gate.passed) {
      throw new Error(
        `The Validation Gate failed at ${gate.failedGate} after applying the saved patches.`,
      );
    }

    await git.push();
    log(`Pushed ${threads.length} fix commit(s) to ${checkout.headRef}.`);
    return shas;
  } finally {
    await rm(patchDir, { recursive: true, force: true });
    await checkout.cleanup();
  }
}
