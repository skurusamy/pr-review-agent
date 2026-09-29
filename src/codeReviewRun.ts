import { simpleGit } from "simple-git";
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
  review: CodeReview;
  markdown: string;
}

/**
 * The clone URL embeds the token, and git keeps it in .git/config. This
 * action reads other people's PRs and lets the model Read the checkout, so
 * the token must not be sitting in a file it can open. A Code Review never
 * pushes, so nothing after the clone needs the credential.
 */
export async function stripRemoteCredentials(
  dir: string,
  owner: string,
  repo: string,
): Promise<void> {
  await simpleGit(dir).remote([
    "set-url",
    "origin",
    `https://github.com/${owner}/${repo}.git`,
  ]);
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
    await stripRemoteCredentials(checkout.dir, owner, repo);

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
      review,
      markdown: formatCodeReviewMarkdown(context.title, prUrl, review),
    };
  } finally {
    await checkout.cleanup();
  }
}
