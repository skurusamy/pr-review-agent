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

/**
 * Runs `fn` against a checkout and always cleans it up afterwards, so a caller
 * can't forget the try/finally. `acquire` is normally a closure over
 * checkoutPullRequestHead; tests pass a fake.
 */
export async function withCheckout<T>(
  acquire: () => Promise<Checkout>,
  fn: (checkout: Checkout) => Promise<T>,
): Promise<T> {
  const checkout = await acquire();
  try {
    return await fn(checkout);
  } finally {
    await checkout.cleanup();
  }
}

/**
 * Gives a checkout the identity the agent's own commits are made under. A
 * fresh clone has none, and relying on whatever is configured globally on the
 * machine this runs on would make commits (and `git am`) fail or misattribute.
 */
export async function setAgentGitIdentity(dir: string): Promise<void> {
  const git = simpleGit(dir);
  await git.addConfig("user.name", "pr-review-agent");
  await git.addConfig("user.email", "pr-review-agent@users.noreply.github.com");
}

/**
 * Fetches a pull request's head commit from `refs/pull/N/head` into `dir` and
 * checks it out detached; returns the commit sha. GitHub keeps that ref after
 * the PR is merged or its branch is deleted, and for PRs from forks, which a
 * clone by branch name cannot reach. The url is passed to `fetch` directly and
 * never saved as a remote, so a token in it cannot end up in `.git/config`.
 */
export async function fetchPullRequestHead(
  dir: string,
  url: string,
  prNumber: number,
): Promise<string> {
  const git = simpleGit(dir);
  await git.init();
  await git.raw(["fetch", "--depth", "1", url, `refs/pull/${prNumber}/head`]);
  await git.raw(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  return (await git.revparse(["HEAD"])).trim();
}

export interface CheckoutOptions {
  /**
   * Read-only runs (Code Review) only read the files, so they take the pull
   * ref: it works for merged, branch-deleted and fork PRs. The checkout has no
   * branch to push to, so `push` throws. Runs that push a fix leave this off
   * and get the PR's own branch.
   */
  readOnly?: boolean;
}

export async function checkoutPullRequestHead(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
  options: CheckoutOptions = {},
): Promise<Checkout> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  if (!options.readOnly) assertSameRepoPullRequest(pr);

  // realpath matters on macOS: os.tmpdir() returns an unresolved /var/...
  // path, but /var is a symlink to /private/var -- any tool that reports an
  // absolute path (Read, Edit, ...) reports the resolved /private/var/...
  // form. Without resolving here too, string-matching this dir against a
  // tool's reported path (e.g. to shorten it for logging) silently fails.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pr-review-agent-")));
  const authenticatedUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const plainUrl = `https://github.com/${owner}/${repo}.git`;

  if (options.readOnly) {
    let headSha: string;
    try {
      headSha = await fetchPullRequestHead(dir, authenticatedUrl, prNumber);
    } catch (error) {
      // Nothing else cleans this dir up when the fetch fails, and git's
      // error text repeats the url, token included.
      await rm(dir, { recursive: true, force: true });
      if (error instanceof Error) {
        error.message = error.message.split(token).join("***");
        if (error.stack) error.stack = error.stack.split(token).join("***");
      }
      throw error;
    }
    await simpleGit(dir).addRemote("origin", plainUrl);
    return {
      dir,
      headRef: pr.head.ref,
      headSha,
      push: () =>
        Promise.reject(
          new Error("This checkout is read-only and cannot push."),
        ),
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }

  const git = simpleGit();
  await git.clone(authenticatedUrl, dir, [
    "--depth",
    "1",
    "--branch",
    pr.head.ref,
    "--single-branch",
  ]);

  const push = await bindPushCredentials(dir, {
    plainUrl,
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
