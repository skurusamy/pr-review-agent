import type { Octokit } from "octokit";
import type { PrReference } from "./prUrl.js";

/** What the UI's PR card shows before anything runs: one cheap GitHub call. */
export interface PrSummary {
  owner: string;
  repo: string;
  prNumber: number;
  url: string;
  title: string;
  /** The PR description, cut short for a card; null if it has none. */
  description: string | null;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headRef: string;
  baseRef: string;
  author: string;
  createdAt: string;
  /** Conversation comments plus inline review comments. */
  comments: number;
  changedFiles: number;
  additions: number;
  deletions: number;
}

const DESCRIPTION_LIMIT = 280;

function shorten(text: string | null): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > DESCRIPTION_LIMIT
    ? `${trimmed.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
    : trimmed;
}

export async function fetchPrSummary(
  octokit: Octokit,
  pr: PrReference,
): Promise<PrSummary> {
  const { data } = await octokit.rest.pulls.get({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.prNumber,
  });
  return {
    ...pr,
    url: data.html_url,
    title: data.title,
    description: shorten(data.body),
    state: data.merged ? "merged" : data.state === "open" ? "open" : "closed",
    draft: data.draft ?? false,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    author: data.user?.login ?? "unknown",
    createdAt: data.created_at,
    comments: data.comments + data.review_comments,
    changedFiles: data.changed_files,
    additions: data.additions,
    deletions: data.deletions,
  };
}
