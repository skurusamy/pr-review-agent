import { createOctokit } from "./github/client.js";
import { fetchPrContext } from "./briefing/fetchPrContext.js";
import { generateBriefing } from "./briefing/generateBriefing.js";
import { formatBriefingMarkdown } from "./briefing/formatBriefing.js";

export interface BriefRunOptions {
  owner: string;
  repo: string;
  prNumber: number;
  githubToken: string;
  /** Progress lines, same convention as ReviewRunOptions.log. */
  log?: (line: string) => void;
}

/**
 * One PR Briefing: fetch the PR's title/description/conversation/diff (no
 * checkout), generate a Briefing, and render it as Markdown. Returns the
 * rendered text rather than only logging it -- the next ticket's UI/file/
 * GitHub-comment paths all need the value itself, not just console output.
 */
export async function runBrief(options: BriefRunOptions): Promise<string> {
  const { owner, repo, prNumber, githubToken, log = console.log } = options;
  const octokit = createOctokit(githubToken);

  log(`Fetching PR context for ${owner}/${repo}#${prNumber}...`);
  const context = await fetchPrContext(octokit, owner, repo, prNumber);

  log("Generating briefing...");
  const briefing = await generateBriefing(context, log);

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  return formatBriefingMarkdown(context.title, prUrl, briefing);
}
