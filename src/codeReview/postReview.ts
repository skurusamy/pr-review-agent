import type { Octokit } from "octokit";
import { z } from "zod";
import {
  findOwnPendingReview,
  getAuthenticatedLogin,
} from "../draft/draftReply.js";
import {
  findingSchema,
  type CodeReview,
  type Finding,
} from "./generateReview.js";
import {
  describeVerification,
  isDismissed,
  postsInline,
  verificationSchema,
} from "./verification.js";

// A finding that comes back from the browser may carry what the verify pass
// concluded; the model's own schema (findingSchema) must not allow it.
const postableFindingSchema = findingSchema.extend({
  verification: verificationSchema.optional(),
});

/**
 * The part of a Code Review that posting needs. Also the shape the server
 * accepts back from the browser: a review makes a round trip through the UI,
 * so it is validated on the way in rather than trusted.
 */
export const postableReviewSchema = z.object({
  assessment: z.string(),
  findings: z.array(postableFindingSchema),
  unanchored: z.array(postableFindingSchema),
  skippedFiles: z.array(
    z.object({ path: z.string(), reason: z.enum(["lockfile", "too-large"]) }),
  ),
});

export type PostableReview = Pick<
  CodeReview,
  "assessment" | "findings" | "unanchored" | "skippedFiles"
>;

export type PostReviewResult =
  | { created: true; reviewId: number; url: string; commentCount: number }
  | { created: false; reason: "pending-review-exists" };

const DRAFT_NOTE =
  "_Draft from pr-review-agent's Code Review. Edit or delete anything before you submit it._";

function formatFindingHeading(f: Finding): string {
  return `**[${f.severity.toUpperCase()}] ${f.title}** · ${f.category}`;
}

/**
 * One inline comment per anchored Finding that is confirmed (or was never
 * put through the verify pass). Not-confirmed and dismissed ones stay out of
 * the PR's inline comments; buildReviewBody says what was left out.
 */
export function buildReviewComments(
  findings: Finding[],
): { path: string; line: number; side: "RIGHT"; body: string }[] {
  return findings.filter(postsInline).map((f) => ({
    path: f.path,
    line: f.line,
    // Anchors are new-side lines (added or unchanged), never deletions.
    side: "RIGHT" as const,
    body: `${formatFindingHeading(f)}\n\n${f.explanation}`,
  }));
}

/**
 * The review's own body: the assessment, plus everything that could not go
 * inline (Findings off the diff, files the model wasn't shown). Nothing the
 * Code Review concluded is left out of what gets posted.
 */
export function buildReviewBody(review: PostableReview): string {
  const parts = [DRAFT_NOTE, `## Assessment\n\n${review.assessment}`];

  const offDiff = review.unanchored.filter((f) => !isDismissed(f));
  const notConfirmed = review.findings.filter(
    (f) => !postsInline(f) && !isDismissed(f),
  );
  const dismissedCount = [...review.findings, ...review.unanchored].filter(
    isDismissed,
  ).length;

  if (notConfirmed.length > 0) {
    const items = notConfirmed
      .map(
        (f) =>
          `- ${formatFindingHeading(f)} (\`${f.path}:${f.line}\`)\n\n  ${f.explanation.replace(/\n/g, "\n  ")}\n\n  _${f.verification ? describeVerification(f.verification) : ""}_`,
      )
      .join("\n\n");
    parts.push(
      `## Not confirmed\n\nThe second check could not confirm these, so they are here rather than inline.\n\n${items}`,
    );
  }

  if (offDiff.length > 0) {
    const items = offDiff
      .map(
        (f) =>
          `- ${formatFindingHeading(f)} (\`${f.path}:${f.line}\`)\n\n  ${f.explanation.replace(/\n/g, "\n  ")}`,
      )
      .join("\n\n");
    parts.push(
      `## Findings not anchored to the diff\n\nThese name a line that is not part of the diff, so they are here rather than inline.\n\n${items}`,
    );
  }

  if (dismissedCount > 0) {
    parts.push(
      `${dismissedCount} finding(s) were checked a second time and dismissed, so they are not posted.`,
    );
  }

  if (review.skippedFiles.length > 0) {
    const items = review.skippedFiles
      .map((s) => `- \`${s.path}\` (${s.reason})`)
      .join("\n");
    parts.push(`## Not reviewed\n\n${items}`);
  }

  return parts.join("\n\n");
}

/**
 * Posts a Code Review as ONE pending review: the assessment as its body and
 * each anchored Finding as an inline comment. Pending means it is visible only
 * to its author and nothing reaches the PR until they submit it themselves on
 * GitHub -- so this never approves, requests changes, or notifies anyone (no
 * `event` is passed, which is what keeps it pending).
 *
 * Comments are pinned to `headSha`, the commit the review was made against,
 * so a push landing since then can't slide them onto other lines.
 *
 * GitHub allows one pending review per user per PR (Draft Replies use the
 * same slot); if one exists this refuses instead of failing with a raw 422.
 */
export async function postCodeReviewAsPending(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  review: PostableReview,
  headSha: string,
): Promise<PostReviewResult> {
  const ownLogin = await getAuthenticatedLogin(octokit);
  const existing = await findOwnPendingReview(
    octokit,
    owner,
    repo,
    prNumber,
    ownLogin,
  );
  if (existing) {
    return { created: false, reason: "pending-review-exists" };
  }

  const comments = buildReviewComments(review.findings);
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    body: buildReviewBody(review),
    comments,
  });
  return {
    created: true,
    reviewId: data.id,
    url: data.html_url,
    commentCount: comments.length,
  };
}
