import { createOctokit } from "./github/client.js";
import { prUrlOf } from "./prUrl.js";
import { fetchPrContext } from "./briefing/fetchPrContext.js";
import { fetchLinkedIssuesOfPr } from "./briefing/linkedIssues.js";
import {
  generateBriefing,
  type BriefMode,
} from "./briefing/generateBriefing.js";
import { checkoutPullRequestHead, withCheckout } from "./github/checkout.js";
import { formatBriefingMarkdown } from "./briefing/formatBriefing.js";

export interface BriefRunOptions {
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
  /** quick (default) reads only the PR's text and diff; deeper also reads the code. */
  mode?: BriefMode;
}

/**
 * One PR Briefing: fetch the PR's title/description/conversation/diff (a
 * read-only checkout only in deeper mode), generate a Briefing, and render it as Markdown. Returns the
 * rendered text rather than only logging it -- the next ticket's UI/file/
 * GitHub-comment paths all need the value itself, not just console output.
 */
export async function runBrief(options: BriefRunOptions): Promise<string> {
  const {
    owner,
    repo,
    prNumber,
    githubToken,
    log = console.log,
    abortController,
    onStep = () => {},
    mode = "quick",
  } = options;
  const octokit = createOctokit(githubToken);

  onStep("Fetching pull request");
  log(`Fetching PR context for ${owner}/${repo}#${prNumber}...`);
  const context = await fetchPrContext(octokit, owner, repo, prNumber, log);

  // The PR's own words often say what it was for ("Fixes #123"). Read those
  // issues here, in plain code, so the briefing can compare the change to
  // what was asked without the model session having any tools of its own.
  context.linkedIssues = await fetchLinkedIssuesOfPr(
    octokit,
    { owner, repo, prNumber },
    context,
    log,
  );

  let briefing;
  if (mode === "deeper") {
    // Read-only, like Review PR: the pull ref, so merged and fork PRs work.
    onStep("Checking out the branch");
    log("Checking out the PR's head commit (deeper briefing)...");
    briefing = await withCheckout(
      () =>
        checkoutPullRequestHead(octokit, owner, repo, prNumber, githubToken, {
          readOnly: true,
        }),
      (checkout) => {
        onStep("Generating briefing");
        log("Generating a deeper briefing... (waiting for the model)");
        return generateBriefing(context, log, abortController, {
          checkoutDir: checkout.dir,
        });
      },
    );
  } else {
    onStep("Generating briefing");
    log("Generating briefing... (waiting for the model)");
    briefing = await generateBriefing(context, log, abortController);
  }

  return formatBriefingMarkdown(
    context.title,
    prUrlOf(owner, repo, prNumber),
    briefing,
  );
}
