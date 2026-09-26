import type { Octokit } from "octokit";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { ReviewComment, ReviewThread } from "./types.js";

type RawReviewComment = Pick<
  RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][number],
  | "id"
  | "path"
  | "line"
  | "original_line"
  | "diff_hunk"
  | "body"
  | "created_at"
  | "html_url"
> & { user: { login: string }; in_reply_to_id?: number | bigint | null };

export async function fetchReviewThreads(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<ReviewThread[]> {
  const raw = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return groupIntoThreads(raw);
}

export function groupIntoThreads(raw: RawReviewComment[]): ReviewThread[] {
  const roots = raw.filter((c) => c.in_reply_to_id == null);
  const repliesByRootId = new Map<number, RawReviewComment[]>();
  for (const c of raw) {
    if (c.in_reply_to_id != null) {
      const rootId = Number(c.in_reply_to_id);
      const list = repliesByRootId.get(rootId) ?? [];
      list.push(c);
      repliesByRootId.set(rootId, list);
    }
  }

  return roots.map((root) => ({
    rootComment: toReviewComment(root),
    replies: (repliesByRootId.get(Number(root.id)) ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(toReviewComment),
  }));
}

function toReviewComment(c: RawReviewComment): ReviewComment {
  return {
    id: Number(c.id),
    path: c.path,
    line: c.line ?? null,
    originalLine: c.original_line ?? null,
    diffHunk: c.diff_hunk,
    body: c.body,
    author: c.user.login,
    createdAt: c.created_at,
    htmlUrl: c.html_url,
    outdated: c.line == null,
  };
}
