import { createOctokit } from "./github/client.js";
import {
  postCodeReviewAsPending,
  type PostableReview,
  type PostReviewResult,
} from "./codeReview/postReview.js";
import { PENDING_REVIEW_EXISTS_MESSAGE } from "./draft/replyLedger.js";
import type { PrReference } from "./prUrl.js";

/**
 * The "post it" half of Review PR, shared by the CLI and the web UI so both do
 * the same thing and say the same thing. Posting is always a separate,
 * explicit step from generating; this is only called when a person asked for
 * it (`--post`, "Post to GitHub"). Only the Code Review is ever posted: a
 * briefing is not.
 */

/**
 * Creates a PENDING review holding the Findings: private to the person until
 * they submit it on GitHub, and never an approval or a request for changes.
 */
export async function postReview(
  githubToken: string,
  pr: PrReference,
  review: PostableReview,
  headSha: string,
): Promise<PostReviewResult> {
  return postCodeReviewAsPending(
    createOctokit(githubToken),
    pr.owner,
    pr.repo,
    pr.prNumber,
    review,
    headSha,
  );
}

/** What to tell the person after `postReview`. */
export function describePostedReview(result: PostReviewResult): string {
  if (!result.created) return PENDING_REVIEW_EXISTS_MESSAGE;
  const skipped =
    result.alreadyPosted > 0
      ? ` (${result.alreadyPosted} finding(s) left out because an earlier run already posted them)`
      : "";
  return `Created a pending review (id ${result.reviewId}) with ${result.commentCount} comment(s)${skipped}: ${result.url}\nSubmit it on GitHub when ready.`;
}

/** Where the CLI saves a generated briefing or review. */
export function markdownFileName(
  kind: "pr-briefing" | "code-review",
  pr: PrReference,
): string {
  return `${kind}-${pr.owner}-${pr.repo}-${pr.prNumber}.md`;
}
