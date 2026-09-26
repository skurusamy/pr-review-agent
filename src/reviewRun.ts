import { createOctokit } from "./github/client.js";
import { fetchReviewThreads } from "./github/reviewComments.js";
import { checkoutPullRequestHead } from "./github/checkout.js";
import {
  reachVerdict,
  decideAction,
  VerdictIncompleteError,
} from "./verdict/reachVerdict.js";
import { attemptFix } from "./fix/attemptFix.js";
import {
  buildDraftReply,
  hasExistingReply,
  createPendingReview,
  postFixConfirmation,
  type DraftReplyEntry,
} from "./draft/draftReply.js";

export interface ReviewRunOptions {
  owner: string;
  repo: string;
  prNumber: number;
  dryRun: boolean;
  githubToken: string;
}

/**
 * One Review Run: fetch a PR's inline review comments, reach a Verdict on
 * each unhandled one, apply a Fix Attempt or accumulate a Draft Reply, then
 * submit every accumulated draft as one pending review. In --dry-run mode,
 * everything runs for real (including the Fix Attempt's edit + Validation
 * Gate) except the final git push and GitHub review-creation call.
 */
export async function runReview(options: ReviewRunOptions): Promise<void> {
  const { owner, repo, prNumber, dryRun, githubToken } = options;
  const octokit = createOctokit(githubToken);

  console.log(`Fetching review comments for ${owner}/${repo}#${prNumber}...`);
  const threads = await fetchReviewThreads(octokit, owner, repo, prNumber);
  console.log(`Found ${threads.length} comment thread(s).`);

  if (threads.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("Checking out the PR's head branch...");
  const checkout = await checkoutPullRequestHead(
    octokit,
    owner,
    repo,
    prNumber,
    githubToken,
  );

  const draftEntries: DraftReplyEntry[] = [];

  try {
    for (const thread of threads) {
      const { rootComment } = thread;
      console.log(
        `\n--- ${rootComment.path}:${rootComment.line ?? rootComment.originalLine} (${rootComment.htmlUrl}) ---`,
      );

      const alreadyHandled = await hasExistingReply(
        octokit,
        owner,
        repo,
        prNumber,
        rootComment.id,
      );
      if (alreadyHandled) {
        console.log("Already handled in a previous run, skipping.");
        continue;
      }

      let verdict;
      try {
        verdict = await reachVerdict(checkout.dir, thread);
      } catch (error) {
        if (error instanceof VerdictIncompleteError) {
          console.log(`Could not reach a verdict: ${error.message}. Skipping.`);
          continue;
        }
        throw error;
      }
      console.log(`Verdict: ${verdict.verdict} -- ${verdict.reasoning}`);

      const action = decideAction(thread, verdict);

      if (action === "fix") {
        console.log("Attempting a fix...");
        const fixResult = await attemptFix(
          checkout.dir,
          thread,
          verdict,
          dryRun,
        );
        if (fixResult.outcome === "fixed") {
          console.log(
            dryRun
              ? `[dry-run] Would push commit ${fixResult.commitSha}: ${fixResult.summary}`
              : `Pushed commit ${fixResult.commitSha}: ${fixResult.summary}`,
          );
          if (dryRun) {
            console.log(
              "[dry-run] Would post a confirmation reply marking this comment as handled.",
            );
          } else {
            // Without this, a rerun's hasExistingReply would find no marker
            // for this comment at all (a fix commits code, not a comment)
            // and redo the whole Verdict/Fix Attempt loop on something
            // already fixed.
            await postFixConfirmation(
              octokit,
              owner,
              repo,
              prNumber,
              rootComment.id,
              fixResult.commitSha,
              fixResult.summary,
            );
          }
        } else {
          console.log(
            `Fix Attempt exhausted after ${fixResult.attempts} attempts (${fixResult.lastFailedGate}); falling back to a draft reply.`,
          );
          draftEntries.push(
            buildDraftReply(thread, {
              kind: "exhausted",
              failedGate: fixResult.lastFailedGate,
            }),
          );
        }
      } else {
        console.log("Not a bug; drafting a reply.");
        draftEntries.push(
          buildDraftReply(thread, { kind: "not-a-bug", verdict }),
        );
      }
    }
  } finally {
    await checkout.cleanup();
  }

  if (draftEntries.length === 0) {
    console.log("\nNo draft replies to create.");
    return;
  }

  if (dryRun) {
    console.log(
      `\n[dry-run] Would create a pending review with ${draftEntries.length} comment(s):`,
    );
    for (const entry of draftEntries) {
      console.log(
        `  - ${entry.path}:${entry.line}\n    ${entry.body.split("\n")[0]}`,
      );
    }
    return;
  }

  const result = await createPendingReview(
    octokit,
    owner,
    repo,
    prNumber,
    draftEntries,
  );
  if (result.created) {
    console.log(
      `\nCreated a pending review (id ${result.reviewId}) with ${draftEntries.length} comment(s). Submit it on GitHub when ready.`,
    );
  } else {
    console.log(
      "\nCould not create a pending review: one already exists. Submit or dismiss it on GitHub first.",
    );
  }
}
