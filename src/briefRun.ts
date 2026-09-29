import { createOctokit } from "./github/client.js";
import { prUrlOf } from "./prUrl.js";
import { fetchPrContext } from "./briefing/fetchPrContext.js";
import { fetchLinkedIssues } from "./briefing/linkedIssues.js";
import { generateBriefing } from "./briefing/generateBriefing.js";
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
}

/**
 * One PR Briefing: fetch the PR's title/description/conversation/diff (no
 * checkout), generate a Briefing, and render it as Markdown. Returns the
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
  } = options;
  const octokit = createOctokit(githubToken);

  log(`Fetching PR context for ${owner}/${repo}#${prNumber}...`);
  const context = await fetchPrContext(octokit, owner, repo, prNumber, log);

  // The PR's own words often say what it was for ("Fixes #123"). Read those
  // issues here, in plain code, so the briefing can compare the change to
  // what was asked without the model session having any tools of its own.
  context.linkedIssues = await fetchLinkedIssues(
    octokit,
    { owner, repo, prNumber },
    `${context.title}\n${context.description ?? ""}`,
    log,
  );

  log("Generating briefing... (waiting for the model)");
  const briefing = await generateBriefing(context, log, abortController);

  return formatBriefingMarkdown(
    context.title,
    prUrlOf(owner, repo, prNumber),
    briefing,
  );
}
