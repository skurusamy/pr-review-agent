import type { Octokit } from "octokit";
import {
  createPendingReview,
  getAuthenticatedLogin,
  hasExistingReply,
  postFixConfirmation,
  type CreatePendingReviewResult,
  type DraftReplyEntry,
} from "./draftReply.js";

/**
 * Everything the agent reads and writes about "which review comments are
 * already handled" on one PR: the Agent Marker checks, the fix confirmation
 * reply, and the single pending review that holds every Draft Reply.
 *
 * It is the seam between the Fix Run / Apply logic and GitHub. Three adapters
 * sit behind it: GitHub (`githubReplyLedger`), a Dry Run one that reads for
 * real but only prints what it would write (`dryRunReplyLedger`), and the fakes
 * in tests.
 */
export interface ReplyLedger {
  hasExistingReply: (threadId: number) => Promise<boolean>;
  postFixConfirmation: (
    threadId: number,
    commitSha: string,
    summary: string,
  ) => Promise<void>;
  createPendingReview: (
    entries: DraftReplyEntry[],
  ) => Promise<CreatePendingReviewResult>;
}

export interface PrTarget {
  owner: string;
  repo: string;
  prNumber: number;
}

export function githubReplyLedger(octokit: Octokit, pr: PrTarget): ReplyLedger {
  const { owner, repo, prNumber } = pr;
  // The authenticated user never changes within a run, so ask GitHub once
  // rather than on every thread's marker check.
  let login: Promise<string> | undefined;
  const ownLogin = (): Promise<string> =>
    (login ??= getAuthenticatedLogin(octokit));

  return {
    hasExistingReply: async (id) =>
      hasExistingReply(octokit, owner, repo, prNumber, id, await ownLogin()),
    postFixConfirmation: (id, sha, summary) =>
      postFixConfirmation(octokit, owner, repo, prNumber, id, sha, summary),
    createPendingReview: async (entries) =>
      createPendingReview(
        octokit,
        owner,
        repo,
        prNumber,
        entries,
        await ownLogin(),
      ),
  };
}

/**
 * A Dry Run: reads go through to `inner` (so already-handled comments are
 * still skipped), writes are printed instead of performed.
 */
export function dryRunReplyLedger(
  inner: ReplyLedger,
  log: (line: string) => void,
): ReplyLedger {
  return {
    hasExistingReply: inner.hasExistingReply,
    postFixConfirmation: async () => {
      log(
        "[dry-run] Would post a confirmation reply marking this comment as handled.",
      );
    },
    createPendingReview: async (entries) => {
      log(
        `\n[dry-run] Would create a pending review with ${entries.length} comment(s):`,
      );
      // Just the locations -- the reasoning for each was already printed once,
      // at its own "Verdict: ..." line.
      for (const entry of entries) {
        log(`  - ${entry.path}:${entry.line}`);
      }
      return { created: false, reason: "dry-run" };
    },
  };
}

export const PENDING_REVIEW_EXISTS_MESSAGE =
  "Could not create a pending review: one already exists. Submit or dismiss it on GitHub first.";
