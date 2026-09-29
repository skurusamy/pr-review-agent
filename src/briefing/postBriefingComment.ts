import type { Octokit } from "octokit";

export interface PostedBriefingComment {
  url: string;
}

/**
 * Posts a Briefing as a top-level PR comment -- octokit's Issues API, not
 * the Pull Request Review API used elsewhere in this repo, since a PR is an
 * issue for commenting purposes and this isn't anchored to a diff line the
 * way a Draft Reply is. Always adds a new comment: no Agent Marker, no
 * replace-in-place -- a PR can accumulate several Briefing comments across
 * its revisions, and that history is the point, not clutter.
 */
export async function postBriefingComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  markdown: string,
): Promise<PostedBriefingComment> {
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: markdown,
  });
  return { url: data.html_url };
}
