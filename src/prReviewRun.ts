import { createOctokit } from "./github/client.js";
import { checkoutPullRequestHead, withCheckout } from "./github/checkout.js";
import { prUrlOf } from "./prUrl.js";
import { gatherReviewContext, verifyReview } from "./codeReviewRun.js";
import { generateBriefing } from "./briefing/generateBriefing.js";
import {
  formatBriefingForReview,
  formatBriefingMarkdown,
} from "./briefing/formatBriefing.js";
import {
  generateCodeReview,
  type CodeReview,
} from "./codeReview/generateReview.js";
import { markUnchecked } from "./codeReview/verifyFindings.js";
import { formatCodeReviewMarkdown } from "./codeReview/formatReview.js";
import { ApiKeyRejectedError } from "./agentSession.js";
import { formatError } from "./errorLog.js";

/** The structured part of a review the page renders from (and posting needs). */
export interface ReviewData {
  title: string;
  prUrl: string;
  /** The commit the review was made against; posting pins its comments to it. */
  headSha: string;
  review: CodeReview;
}

export interface PrReviewRunOptions {
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
  /** The briefing is done: called as soon as it is, before the review starts. */
  onBriefing?: (markdown: string) => void;
  /** The briefing failed twice; the review goes on without it. */
  onBriefingFailed?: (message: string) => void;
  /**
   * The review session is done and its Findings are about to be checked: all
   * of them marked unchecked. What stays on the page if the run is stopped now.
   */
  onDraft?: (draft: ReviewData) => void;
}

export interface PrReviewResult extends ReviewData {
  /** The briefing as Markdown, or undefined when it failed. */
  briefingMarkdown?: string;
  /** The Code Review as Markdown, what the download holds. */
  markdown: string;
}

/**
 * Runs an attempt, and once more if it failed. A stop or a rejected API key
 * is not retried: the first is the person's choice, the second would only
 * fail the same way.
 */
async function retryOnce<T>(
  attempt: () => Promise<T>,
  signal: AbortSignal | undefined,
  log: (line: string) => void,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (signal?.aborted || error instanceof ApiKeyRejectedError) throw error;
    log(`Briefing failed (${formatError(error)}); trying once more...`);
    return await attempt();
  }
}

/**
 * One PR Review (see CONTEXT.md): a briefing and then a Code Review of the
 * same PR, on one read-only checkout.
 *
 * Sequential on purpose: the review is handed the finished briefing as
 * background, so it spends fewer turns finding its way around. The briefing is
 * retried once; if it still fails the review runs without it and says so.
 * The Verification of each Finding never sees the briefing.
 */
export async function runPrReview(
  options: PrReviewRunOptions,
): Promise<PrReviewResult> {
  const {
    owner,
    repo,
    prNumber,
    githubToken,
    log = console.log,
    abortController,
    onStep = () => {},
    onBriefing = () => {},
    onBriefingFailed = () => {},
    onDraft = () => {},
  } = options;
  const octokit = createOctokit(githubToken);
  const prUrl = prUrlOf(owner, repo, prNumber);

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
      onStep("Writing the briefing");
      log("Writing the briefing... (waiting for the model)");
      let briefingMarkdown: string | undefined;
      let briefingForReview: string | undefined;
      try {
        const briefing = await retryOnce(
          () =>
            generateBriefing(context, log, abortController, {
              checkoutDir: checkout.dir,
            }),
          abortController?.signal,
          log,
        );
        briefingMarkdown = formatBriefingMarkdown(
          context.title,
          prUrl,
          briefing,
        );
        briefingForReview = formatBriefingForReview(briefing);
        onBriefing(briefingMarkdown);
      } catch (error) {
        // A stop, or a rejected key, ends the whole run. Anything else only
        // costs the briefing: the Findings are still wanted.
        if (
          abortController?.signal.aborted ||
          error instanceof ApiKeyRejectedError
        ) {
          throw error;
        }
        const message = formatError(error);
        log(`Warning: no briefing (${message}); reviewing without it.`);
        onBriefingFailed(message);
      }

      onStep("Reviewing the code");
      log("Reviewing the code... (waiting for the model)");
      const reviewed = await generateCodeReview(
        context,
        checkout.dir,
        log,
        abortController,
        briefingForReview,
      );
      onDraft({
        title: context.title,
        prUrl,
        headSha: context.headSha,
        review: markUnchecked(reviewed),
      });

      const review = await verifyReview(
        context,
        checkout.dir,
        reviewed,
        log,
        abortController,
        onStep,
      );

      return {
        title: context.title,
        prUrl,
        headSha: context.headSha,
        review,
        ...(briefingMarkdown ? { briefingMarkdown } : {}),
        markdown: formatCodeReviewMarkdown(context.title, prUrl, review),
      };
    },
  );
}
