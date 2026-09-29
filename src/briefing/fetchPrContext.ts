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
}

/**
 * Everything a PR Briefing needs, and nothing a Review Run's checkout would
 * otherwise provide -- no local clone here. Title/description/conversation
 * ground the model's summary in what the PR *claims* to do, so it can flag
 * where the diff drifts from that; the diff itself is what actually changed.
 */
export async function fetchPrContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrContext> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

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
  };
}
