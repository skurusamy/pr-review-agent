import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { Octokit } from "octokit";

export interface Checkout {
  dir: string;
  headRef: string;
  cleanup: () => Promise<void>;
}

export class ForkPullRequestError extends Error {}

interface PullRequestRepoInfo {
  head: {
    repo: { full_name: string } | null;
    ref: string;
  };
  base: {
    repo: { full_name: string };
  };
}

/** v1 assumes same-repo PRs only; throws if the PR's head branch lives in a fork. */
export function assertSameRepoPullRequest(pr: PullRequestRepoInfo): void {
  const headFullName = pr.head.repo?.full_name;
  const baseFullName = pr.base.repo.full_name;
  if (headFullName !== baseFullName) {
    throw new ForkPullRequestError(
      `PR head is ${headFullName ?? "an inaccessible or deleted fork"}, but base is ${baseFullName}. Fork PRs aren't supported yet.`,
    );
  }
}

export async function checkoutPullRequestHead(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<Checkout> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  assertSameRepoPullRequest(pr);

  const dir = await mkdtemp(join(tmpdir(), "pr-review-agent-"));
  const authenticatedUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const git = simpleGit();
  await git.clone(authenticatedUrl, dir, [
    "--depth",
    "1",
    "--branch",
    pr.head.ref,
    "--single-branch",
  ]);

  return {
    dir,
    headRef: pr.head.ref,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
