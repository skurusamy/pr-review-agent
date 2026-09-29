import { createOctokit } from "./github/client.js";
import { fetchReviewThreads } from "./github/reviewComments.js";
import { checkoutPullRequestHead, withCheckout } from "./github/checkout.js";
import {
  reachVerdict,
  decideAction,
  VerdictIncompleteError,
} from "./verdict/reachVerdict.js";
import { attemptFix } from "./fix/attemptFix.js";
import {
  buildDraftReply,
  stripMarker,
  type DraftReplyEntry,
} from "./draft/draftReply.js";
import {
  PENDING_REVIEW_EXISTS_MESSAGE,
  dryRunReplyLedger,
  githubReplyLedger,
} from "./draft/replyLedger.js";
import { classifyLogLine } from "./logFormat.js";
import type { FixEvent } from "./runRecord/types.js";

export interface FixRunOptions {
  owner: string;
  repo: string;
  prNumber: number;
  dryRun: boolean;
  githubToken: string;
  /**
   * Where progress lines go. Defaults to console.log (the CLI's behavior).
   * The server passes a capturing function instead, since a request/response
   * cycle has no stdout of its own to write to.
   */
  log?: (line: string) => void;
  /**
   * Lets a caller (the server, on a client disconnect/Stop click) cancel a
   * run in progress -- forwarded to the Claude Agent SDK's query() calls,
   * which tear down their subprocess on abort rather than running to
   * completion regardless.
   */
  abortController?: AbortController;
  /**
   * Structured progress (per-thread verdicts, outcomes, log lines) alongside
   * the text `log`. The text log is unchanged, so the CLI needs no handler.
   */
  onEvent?: (event: FixEvent) => void;
  /** Starts the next step of the progress checklist (the web UI shows it). */
  onStep?: (label: string) => void;
}

/**
 * One Fix Run: fetch a PR's inline review comments, reach a Verdict on
 * each unhandled one, apply a Fix Attempt or accumulate a Draft Reply, then
 * submit every accumulated draft as one pending review. In --dry-run mode,
 * everything runs for real (including the Fix Attempt's edit + Validation
 * Gate) except the final git push and GitHub review-creation call.
 */
export async function runFix(options: FixRunOptions): Promise<void> {
  const {
    owner,
    repo,
    prNumber,
    dryRun,
    githubToken,
    log = console.log,
    abortController,
    onEvent = () => {},
    onStep = () => {},
  } = options;
  const octokit = createOctokit(githubToken);

  onStep("Fetching review comments");
  log(`Fetching review comments for ${owner}/${repo}#${prNumber}...`);
  const threads = await fetchReviewThreads(octokit, owner, repo, prNumber);
  log(`Found ${threads.length} comment thread(s).`);

  if (threads.length === 0) {
    log("Nothing to do.");
    return;
  }

  const ledger = githubReplyLedger(octokit, { owner, repo, prNumber });
  // In a Dry Run every write is printed instead of performed; reads still go
  // through, so already-handled comments are skipped either way.
  const ledgerFor = (logLine: (line: string) => void) =>
    dryRun ? dryRunReplyLedger(ledger, logLine) : ledger;

  const draftEntries: DraftReplyEntry[] = [];

  onStep("Checking out the branch");
  log("Checking out the PR's head branch...");
  await withCheckout(
    () => checkoutPullRequestHead(octokit, owner, repo, prNumber, githubToken),
    async (checkout) => {
      onEvent({
        type: "run-started",
        owner,
        repo,
        prNumber,
        dryRun,
        headSha: checkout.headSha,
      });

      let position = 0;
      for (const thread of threads) {
        onStep(
          `Comment ${++position} of ${threads.length}: ${thread.rootComment.path}`,
        );
        const { rootComment } = thread;
        const threadId = rootComment.id;
        // Sends every line to the shared text log as before, and also files it
        // under this thread, so "Show reasoning" needs no after-the-fact parsing.
        const tlog = (line: string): void => {
          log(line);
          onEvent({
            type: "thread-log",
            threadId,
            kind: classifyLogLine(line),
            text: line.trim(),
          });
        };
        onEvent({
          type: "thread-started",
          threadId,
          path: rootComment.path,
          line: rootComment.line ?? rootComment.originalLine,
          outdated: rootComment.outdated,
          reviewer: rootComment.author,
          comment: rootComment.body,
          url: rootComment.htmlUrl,
        });
        log(
          `\n--- ${rootComment.path}:${rootComment.line ?? rootComment.originalLine} (${rootComment.htmlUrl}) ---`,
        );

        if (await ledger.hasExistingReply(threadId)) {
          tlog("Already handled in a previous run, skipping.");
          onEvent({
            type: "thread-outcome",
            threadId,
            outcome: { kind: "skipped", reason: "already-handled" },
          });
          continue;
        }

        let verdict;
        try {
          verdict = await reachVerdict(
            checkout.dir,
            thread,
            tlog,
            abortController,
          );
        } catch (error) {
          if (error instanceof VerdictIncompleteError) {
            tlog(`Could not reach a verdict: ${error.message}. Skipping.`);
            onEvent({
              type: "thread-outcome",
              threadId,
              outcome: { kind: "skipped", reason: "no-verdict" },
            });
            continue;
          }
          throw error;
        }
        tlog(`Verdict: ${verdict.verdict} -- ${verdict.reasoning}`);
        onEvent({
          type: "thread-verdict",
          threadId,
          verdict: verdict.verdict,
          reasoning: verdict.reasoning,
        });

        const action = decideAction(thread, verdict);

        if (action === "fix") {
          tlog("Attempting a fix...");
          const fixResult = await attemptFix(
            checkout.dir,
            thread,
            verdict,
            dryRun,
            tlog,
            abortController,
            checkout.push,
          );
          if (fixResult.outcome === "fixed") {
            onEvent({
              type: "thread-outcome",
              threadId,
              outcome: {
                kind: "fix",
                commitSha: fixResult.commitSha,
                summary: fixResult.summary,
                attempts: fixResult.attempts,
                gateSteps: fixResult.gateSteps,
                patch: fixResult.patch,
              },
            });
            tlog(
              dryRun
                ? `[dry-run] Would push commit ${fixResult.commitSha}: ${fixResult.summary}`
                : `Pushed commit ${fixResult.commitSha}: ${fixResult.summary}`,
            );
            // Without this, a rerun's hasExistingReply would find no marker
            // for this comment at all (a fix commits code, not a comment)
            // and redo the whole Verdict/Fix Attempt loop on something
            // already fixed.
            await ledgerFor(tlog).postFixConfirmation(
              threadId,
              fixResult.commitSha,
              fixResult.summary,
            );
          } else {
            tlog(
              `Fix Attempt exhausted after ${fixResult.attempts} attempts (${fixResult.lastFailedGate}); falling back to a draft reply.`,
            );
            const entry = buildDraftReply(thread, {
              kind: "exhausted",
              failedGate: fixResult.lastFailedGate,
            });
            draftEntries.push(entry);
            onEvent({
              type: "thread-outcome",
              threadId,
              outcome: {
                kind: "fix-failed",
                attempts: fixResult.attempts,
                failedGate: fixResult.lastFailedGate,
                body: stripMarker(entry.body),
              },
            });
          }
        } else {
          tlog("Not a bug; drafting a reply.");
          const entry = buildDraftReply(thread, { kind: "not-a-bug", verdict });
          draftEntries.push(entry);
          onEvent({
            type: "thread-outcome",
            threadId,
            outcome: { kind: "draft", body: stripMarker(entry.body) },
          });
        }
      }
    },
  );

  if (draftEntries.length === 0) {
    log("\nNo draft replies to create.");
    return;
  }

  onStep("Drafting replies");
  const result = await ledgerFor(log).createPendingReview(draftEntries);
  if (result.created) {
    log(
      `\nCreated a pending review (id ${result.reviewId}) with ${draftEntries.length} comment(s). Submit it on GitHub when ready.`,
    );
  } else if (result.reason === "pending-review-exists") {
    log(`\n${PENDING_REVIEW_EXISTS_MESSAGE}`);
  }
}
