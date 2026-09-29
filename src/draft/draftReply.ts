import type { Octokit } from "octokit";
import type { ReviewThread } from "../github/types.js";
import type { Verdict } from "../verdict/reachVerdict.js";

export interface DraftReplyEntry {
  rootCommentId: number;
  path: string;
  line: number;
  body: string;
}

export type DraftOutcome =
  | { kind: "not-a-bug"; verdict: Verdict }
  | { kind: "exhausted"; failedGate: string };

export type CreatePendingReviewResult =
  | { created: true; reviewId: number }
  | { created: false; reason: "pending-review-exists" }
  // Only the dry-run ledger returns this: nothing was created, by design.
  | { created: false; reason: "dry-run" };

// Embeds the specific root comment's id, not a generic tag. GitHub's API
// gives us no way to create a reply that's both pending AND nested in the
// original thread (see Learning Notes for why), so idempotency can't be
// checked via reply structure at all -- it has to be checked by scanning
// comment bodies for this exact string.
export function marker(rootCommentId: number): string {
  return `<!-- pr-review-agent:comment-${rootCommentId} -->`;
}

export function hasMarkerForComment(
  commentBody: string,
  rootCommentId: number,
): boolean {
  return commentBody.includes(marker(rootCommentId));
}

/** A Draft Reply body: the text, then the hidden Agent Marker for its comment. */
export function withMarker(text: string, rootCommentId: number): string {
  return `${text}\n\n${marker(rootCommentId)}`;
}

/** The reply text without its hidden Agent Marker, for showing to a person. */
export function stripMarker(body: string): string {
  return body.replace(/\s*<!-- pr-review-agent:comment-\d+ -->\s*$/, "");
}

export function buildDraftReply(
  thread: ReviewThread,
  outcome: DraftOutcome,
): DraftReplyEntry {
  const { rootComment } = thread;
  const line = rootComment.line ?? rootComment.originalLine;
  if (line === null) {
    throw new Error(
      `Comment ${rootComment.id} has no line to anchor a reply to`,
    );
  }

  const text =
    outcome.kind === "not-a-bug"
      ? outcome.verdict.reasoning
      : `I attempted a fix for this 3 times, but couldn't get \`${outcome.failedGate}\` passing. Flagging for a human to take a look.`;
  const body = withMarker(text, rootComment.id);

  return { rootCommentId: rootComment.id, path: rootComment.path, line, body };
}

export async function getAuthenticatedLogin(octokit: Octokit): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  return data.login;
}

interface PendingReview {
  id: number;
}

// GitHub allows only one pending review per user per PR -- a second
// createReview call while one exists is a hard 422. So every draft-review
// operation has to check for one first, scoped to OUR OWN account (a human
// reviewer's own in-progress pending review is none of our business).
export async function findOwnPendingReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  ownLogin: string,
): Promise<PendingReview | undefined> {
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return reviews.find(
    (r) => r.state === "PENDING" && r.user?.login === ownLogin,
  );
}

/**
 * Whether a comment already has a Draft Reply from a past run -- checked
 * against both submitted comments (a human approved a past draft) and any
 * currently-pending review's own comments (drafted but not yet submitted),
 * since a pending review's comments are invisible to the normal
 * listReviewComments endpoint until submitted.
 */
export async function hasExistingReply(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  rootCommentId: number,
  ownLogin?: string,
): Promise<boolean> {
  const submitted = await octokit.paginate(
    octokit.rest.pulls.listReviewComments,
    {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    },
  );
  if (submitted.some((c) => hasMarkerForComment(c.body, rootCommentId))) {
    return true;
  }

  const login = ownLogin ?? (await getAuthenticatedLogin(octokit));
  const pending = await findOwnPendingReview(
    octokit,
    owner,
    repo,
    prNumber,
    login,
  );
  if (!pending) {
    return false;
  }

  const pendingComments = await octokit.paginate(
    octokit.rest.pulls.listCommentsForReview,
    {
      owner,
      repo,
      pull_number: prNumber,
      review_id: pending.id,
      per_page: 100,
    },
  );
  return pendingComments.some((c) =>
    hasMarkerForComment(c.body, rootCommentId),
  );
}

/**
 * Marks a comment as handled after a successful Fix Attempt. Unlike
 * buildDraftReply's output, this doesn't go through a pending review -- a
 * pushed fix has already happened and is already visible (the commit
 * itself), so there's nothing pending a human's approval here, just a note
 * for transparency and (critically) an Agent Marker so a rerun's
 * hasExistingReply sees this comment as already handled. Posted as an
 * immediate reply via the single-comment endpoint, which is the only one
 * that supports in_reply_to -- unlike buildDraftReply's cases, this one
 * doesn't need to be pending, so it can use the endpoint that actually
 * nests it in the original thread.
 */
export async function postFixConfirmation(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  rootCommentId: number,
  commitSha: string,
  summary: string,
): Promise<void> {
  const body = `Fixed in ${commitSha.slice(0, 7)}: ${summary}\n\n${marker(rootCommentId)}`;
  await octokit.rest.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: rootCommentId,
    body,
  });
}

/**
 * Creates ONE pending review holding every entry -- not one review per
 * comment, since only one pending review per user per PR is allowed at all.
 * If a pending review from an earlier run already exists (a human hasn't
 * submitted or dismissed it yet), this refuses rather than erroring, so the
 * caller can surface a clear "submit or dismiss the existing review first"
 * message instead of a raw 422.
 */
export async function createPendingReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  entries: DraftReplyEntry[],
  ownLogin?: string,
): Promise<CreatePendingReviewResult> {
  const login = ownLogin ?? (await getAuthenticatedLogin(octokit));
  const existing = await findOwnPendingReview(
    octokit,
    owner,
    repo,
    prNumber,
    login,
  );
  if (existing) {
    return { created: false, reason: "pending-review-exists" };
  }

  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    comments: entries.map((e) => ({
      path: e.path,
      line: e.line,
      body: e.body,
    })),
  });
  return { created: true, reviewId: data.id };
}
