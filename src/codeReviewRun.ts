import { createOctokit } from "./github/client.js";
import { checkoutPullRequestHead } from "./github/checkout.js";
import { fetchPrContext } from "./briefing/fetchPrContext.js";
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
 * One Code Review: fetch the PR's context, check out its head branch
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
  } = options;
  const octokit = createOctokit(githubToken);

  log(`Fetching PR context for ${owner}/${repo}#${prNumber}...`);
  const context = await fetchPrContext(octokit, owner, repo, prNumber, log);

  log("Checking out the PR's head branch...");
  const checkout = await checkoutPullRequestHead(
    octokit,
    owner,
    repo,
    prNumber,
    githubToken,
  );

  try {
    log("Reviewing the code... (waiting for the model)");
    const review = await generateCodeReview(
      context,
      checkout.dir,
      log,
      abortController,
    );

    const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    return {
      title: context.title,
      prUrl,
      headSha: context.headSha,
      review,
      markdown: formatCodeReviewMarkdown(context.title, prUrl, review),
    };
  } finally {
    await checkout.cleanup();
  }
}
