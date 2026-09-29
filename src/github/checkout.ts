import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { Octokit } from "octokit";

export interface Checkout {
  dir: string;
  headRef: string;
  /** The PR head commit this checkout was cloned at. */
  headSha: string;
  /**
   * Pushes the checkout's HEAD to the PR branch. The only holder of the
   * credential: it is deliberately not stored in the checkout (see
   * bindPushCredentials).
   */
  push: () => Promise<void>;
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

/**
 * Keeps the GitHub token out of the checkout. Cloning with the token in the
 * URL makes git store it in `.git/config`, where a model session running in
 * this checkout could open it with the Read tool (and the checkout holds a
 * PR someone else wrote). So the remote is reset to its plain URL and the
 * token stays only in the returned push function's closure, used for that one
 * command. Any git error text is scrubbed of the token before it propagates,
 * since errors end up in logs and in the UI.
 */
export async function bindPushCredentials(
  dir: string,
  options: {
    plainUrl: string;
    authenticatedUrl: string;
    token: string;
    ref: string;
  },
): Promise<() => Promise<void>> {
  const { plainUrl, authenticatedUrl, token, ref } = options;
  await simpleGit(dir).remote(["set-url", "origin", plainUrl]);

  const scrub = (text: string): string => text.split(token).join("***");
  return async () => {
    try {
      await simpleGit(dir).raw([
        "push",
        authenticatedUrl,
        `HEAD:refs/heads/${ref}`,
      ]);
    } catch (error) {
      // Scrub the original error in place (its stack repeats the message),
      // rather than wrapping it, so no copy of the token survives anywhere.
      if (error instanceof Error) {
        error.message = scrub(error.message);
        if (error.stack) error.stack = scrub(error.stack);
        throw error;
      }
      // A non-Error throw has no stack or cause to preserve; only its text matters.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(scrub(String(error)));
    }
  };
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

  // realpath matters on macOS: os.tmpdir() returns an unresolved /var/...
  // path, but /var is a symlink to /private/var -- any tool that reports an
  // absolute path (Read, Edit, ...) reports the resolved /private/var/...
  // form. Without resolving here too, string-matching this dir against a
  // tool's reported path (e.g. to shorten it for logging) silently fails.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pr-review-agent-")));
  const authenticatedUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const git = simpleGit();
  await git.clone(authenticatedUrl, dir, [
    "--depth",
    "1",
    "--branch",
    pr.head.ref,
    "--single-branch",
  ]);

  const push = await bindPushCredentials(dir, {
    plainUrl: `https://github.com/${owner}/${repo}.git`,
    authenticatedUrl,
    token,
    ref: pr.head.ref,
  });

  return {
    dir,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    push,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
