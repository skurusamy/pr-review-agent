import type { Octokit } from "octokit";

export interface PrComment {
  author: string;
  body: string;
}

export interface PrContext {
  title: string;
  description: string | null;
  comments: PrComment[];
  diff: string;
  /**
   * The PR's head commit when this was fetched. Inline review comments are
   * pinned to it, so a push that lands between a review and its posting
   * can't shift them onto the wrong lines.
   */
  headSha: string;
}

/**
 * Everything a PR Briefing needs, and nothing a Fix Run's checkout would
 * otherwise provide -- no local clone here. Title/description/conversation
 * ground the model's summary in what the PR *claims* to do, so it can flag
 * where the diff drifts from that; the diff itself is what actually changed.
 */
export async function fetchPrContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  log: (line: string) => void = console.log,
): Promise<PrContext> {
  // Three separate octokit calls hide behind one "Fetching PR context..."
  // line at the caller -- if one of them fails (wrong repo, no SSO
  // authorization, a bad PR number), the ONLY way to tell which is this log:
  // without it, every failure here looked identical from the outside.
  log("  Fetching PR metadata...");
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  log("  Fetching diff...");
  // octokit's types describe this call as returning the PR object regardless
  // of `mediaType.format` -- but with format "diff", the actual response body
  // GitHub sends back really is the raw diff text, not JSON. The cast makes
  // that runtime reality explicit instead of pretending it's still a PR object.
  const { data: diff } = (await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: "diff" },
  })) as unknown as { data: string };

  log("  Fetching conversation...");
  const rawComments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  return {
    title: pr.title,
    description: pr.body,
    comments: rawComments.map((c) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
    })),
    diff,
    headSha: pr.head.sha,
  };
}
