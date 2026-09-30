import { createOctokit } from "./github/client.js";
import { checkoutPullRequestHead, withCheckout } from "./github/checkout.js";
import { prUrlOf } from "./prUrl.js";
import { fetchPrContext } from "./briefing/fetchPrContext.js";
import { fetchReviewThreads } from "./github/reviewComments.js";
import { fetchLinkedIssuesOfPr } from "./briefing/linkedIssues.js";
import {
  generateCodeReview,
  type CodeReview,
} from "./codeReview/generateReview.js";
import { formatCodeReviewMarkdown } from "./codeReview/formatReview.js";

export interface CodeReviewRunOptions {
  owner: string;
  repo: string;
  prNumber: number;
  githubToken: string;
  /** Progress lines, same convention as FixRunOptions.log. */
  log?: (line: string) => void;
  /** Same convention as FixRunOptions.abortController. */
  abortController?: AbortController;
  /** Starts the next step of the progress checklist (the web UI shows it). */
  onStep?: (label: string) => void;
}

export interface CodeReviewResult {
  title: string;
  prUrl: string;
  /** The commit the review was made against; posting pins its comments to it. */
  headSha: string;
  review: CodeReview;
  markdown: string;
}

/**
 * One Code Review: fetch the PR's context, check out its head commit
 * read-only, and have the model review it. Returns both the structured
 * review (the posting step needs the Findings themselves) and its rendered
 * Markdown (what the CLI prints and the UI/file show).
 */
export async function runCodeReview(
  options: CodeReviewRunOptions,
): Promise<CodeReviewResult> {
  const {
    owner,
    repo,
    prNumber,
    githubToken,
    log = console.log,
    abortController,
    onStep = () => {},
  } = options;
  const octokit = createOctokit(githubToken);

  onStep("Fetching pull request");
  log(`Fetching PR context for ${owner}/${repo}#${prNumber}...`);
  const context = await fetchPrContext(octokit, owner, repo, prNumber, log);

  // Same lookup as Brief PR: what the PR was asked to do is the yardstick
  // for "drift", and it is read here in plain code, not by the model.
  context.linkedIssues = await fetchLinkedIssuesOfPr(
    octokit,
    { owner, repo, prNumber },
    context,
    log,
  );

  onStep("Checking out the branch");
  // Points already raised inline, so the review builds on them instead of
  // repeating them. Read here in plain code, like the linked issues.
  log("  Fetching existing review threads...");
  context.reviewThreads = await fetchReviewThreads(
    octokit,
    owner,
    repo,
    prNumber,
  );

  log("Checking out the PR's head commit...");
  return withCheckout(
    () =>
      checkoutPullRequestHead(octokit, owner, repo, prNumber, githubToken, {
        readOnly: true,
      }),
    async (checkout) => {
      onStep("Reviewing the code");
      log("Reviewing the code... (waiting for the model)");
      const review = await generateCodeReview(
        context,
        checkout.dir,
        log,
        abortController,
      );

      const prUrl = prUrlOf(owner, repo, prNumber);
      return {
        title: context.title,
        prUrl,
        headSha: context.headSha,
        review,
        markdown: formatCodeReviewMarkdown(context.title, prUrl, review),
      };
    },
  );
}
