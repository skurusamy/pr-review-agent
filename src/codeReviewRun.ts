import type { Octokit } from "octokit";
import { createOctokit } from "./github/client.js";
import { checkoutPullRequestHead, withCheckout } from "./github/checkout.js";
import { verifyFinding, verifyFindings } from "./codeReview/verifyFindings.js";
import { prUrlOf, type PrReference } from "./prUrl.js";
import { fetchPrContext, type PrContext } from "./briefing/fetchPrContext.js";
import { fetchRepoRules } from "./codeReview/repoRules.js";
import { parseChangedFiles } from "./briefing/changedFilesTree.js";
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
 * Everything a Code Review (and a PR Review's briefing) is told about the PR,
 * gathered in plain code before any model session starts: the PR's own text
 * and diff, the same-repo issues it links to, the repo's own rules and the
 * inline threads already on it. Shared so the two runs cannot drift apart on
 * what the model is shown.
 */
export async function gatherReviewContext(
  octokit: Octokit,
  pr: PrReference,
  log: (line: string) => void,
): Promise<PrContext> {
  const { owner, repo, prNumber } = pr;
  log(`Fetching PR context for ${owner}/${repo}#${prNumber}...`);
  const context = await fetchPrContext(octokit, owner, repo, prNumber, log);

  // What the PR was asked to do is the yardstick for "drift", and it is read
  // here in plain code, not by the model.
  context.linkedIssues = await fetchLinkedIssuesOfPr(
    octokit,
    { owner, repo, prNumber },
    context,
    log,
  );

  // The repo's own written rules, read from the BASE branch so the PR being
  // reviewed cannot edit them. Plain code, like the linked issues.
  if (context.baseSha) {
    log("  Reading the repo's own rules from the base branch...");
    context.repoRules = await fetchRepoRules(
      octokit,
      {
        owner,
        repo,
        baseSha: context.baseSha,
        changedPaths: parseChangedFiles(context.diff).map((f) => f.path),
      },
      log,
    );
    if (context.repoRules.length > 0) {
      log(
        `  Found ${context.repoRules.length} rule file(s): ${context.repoRules.map((r) => r.path).join(", ")}`,
      );
    }
  }

  // Points already raised inline, so the review builds on them instead of
  // repeating them.
  log("  Fetching existing review threads...");
  context.reviewThreads = await fetchReviewThreads(
    octokit,
    owner,
    repo,
    prNumber,
  );
  return context;
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
  const context = await gatherReviewContext(
    octokit,
    { owner, repo, prNumber },
    log,
  );

  onStep("Checking out the branch");
  log("Checking out the PR's head commit...");
  return withCheckout(
    () =>
      checkoutPullRequestHead(octokit, owner, repo, prNumber, githubToken, {
        readOnly: true,
      }),
    async (checkout) => {
      onStep("Reviewing the code");
      log("Reviewing the code... (waiting for the model)");
      const reviewed = await generateCodeReview(
        context,
        checkout.dir,
        log,
        abortController,
      );
      const review = await verifyReview(
        context,
        checkout.dir,
        reviewed,
        log,
        abortController,
        onStep,
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

/**
 * The second, fresh session that tries to disprove each Finding before it is
 * shown as standing. Skipped (no step shown) when there is nothing to check.
 * It is never given a briefing: it is the independent check on a review that
 * may have leaned on one.
 */
export function verifyReview(
  context: PrContext,
  checkoutDir: string,
  reviewed: CodeReview,
  log: (line: string) => void,
  abortController: AbortController | undefined,
  onStep: (label: string) => void,
): Promise<CodeReview> {
  if (reviewed.findings.length + reviewed.unanchored.length > 0) {
    onStep("Checking the findings");
  }
  return verifyFindings(
    reviewed,
    (finding) =>
      verifyFinding(context, checkoutDir, finding, log, abortController),
    { log },
  );
}
