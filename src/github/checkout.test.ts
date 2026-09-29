import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSameRepoPullRequest,
  bindPushCredentials,
  ForkPullRequestError,
} from "./checkout.js";

const TOKEN = "ghp_SECRET123";
const PLAIN = "https://github.com/acme/widgets.git";
const IDENTITY = ["user.name", "t"] as const;

// A bare "remote" plus a clone whose origin carries the token, like the one
// checkoutPullRequestHead makes.
let dirs: string[];
let remote: string;
let clone: string;

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "checkout-test-"));
  dirs.push(dir);
  return dir;
}

beforeEach(async () => {
  dirs = [];
  remote = await tmp();
  await simpleGit(remote).init(true, ["--initial-branch=main"]);
  const seed = await tmp();
  const seedGit = simpleGit(seed);
  await seedGit.init(false, ["--initial-branch=main"]);
  await seedGit.addConfig(...IDENTITY);
  await seedGit.addConfig("user.email", "t@t");
  await seedGit.raw(["commit", "--allow-empty", "-m", "base"]);
  await seedGit.addRemote("origin", remote);
  await seedGit.push("origin", "main");

  clone = await tmp();
  await simpleGit().clone(remote, clone);
  const git = simpleGit(clone);
  await git.addConfig(...IDENTITY);
  await git.addConfig("user.email", "t@t");
  await git.remote([
    "set-url",
    "origin",
    `https://x-access-token:${TOKEN}@github.com/acme/widgets.git`,
  ]);
});

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const config = () => readFile(join(clone, ".git", "config"), "utf-8");

describe("bindPushCredentials", () => {
  it("removes the token from .git/config and leaves the plain remote", async () => {
    expect(await config()).toContain(TOKEN);

    await bindPushCredentials(clone, {
      plainUrl: PLAIN,
      authenticatedUrl: remote,
      token: TOKEN,
      ref: "main",
    });

    const after = await config();
    expect(after).not.toContain(TOKEN);
    expect(after).not.toContain("x-access-token");
    expect((await simpleGit(clone).remote(["get-url", "origin"]))?.trim()).toBe(
      PLAIN,
    );
  });

  it("returns a push that lands HEAD on the PR branch of the authenticated remote", async () => {
    const push = await bindPushCredentials(clone, {
      plainUrl: PLAIN,
      authenticatedUrl: remote,
      token: TOKEN,
      ref: "main",
    });
    await simpleGit(clone).raw(["commit", "--allow-empty", "-m", "fix"]);
    const head = (await simpleGit(clone).revparse(["HEAD"])).trim();

    await push();

    expect((await simpleGit(remote).revparse(["main"])).trim()).toBe(head);
    // And the push left no credential behind in the checkout.
    expect(await config()).not.toContain(TOKEN);
  });

  it("scrubs the token from a failed push's error, message and stack", async () => {
    const push = await bindPushCredentials(clone, {
      plainUrl: PLAIN,
      // git echoes this bad path back in its error text.
      authenticatedUrl: `/nonexistent/${TOKEN}/repo.git`,
      token: TOKEN,
      ref: "main",
    });

    const error = await push().then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain(TOKEN);
    expect(error?.stack ?? "").not.toContain(TOKEN);
    expect(error?.message).toContain("***");
  });
});

describe("assertSameRepoPullRequest", () => {
  it("passes when head and base are the same repo", () => {
    const pr = {
      head: {
        repo: { full_name: "skurusamy/pr-review-agent" },
        ref: "my-branch",
      },
      base: { repo: { full_name: "skurusamy/pr-review-agent" } },
    };

    expect(() => assertSameRepoPullRequest(pr)).not.toThrow();
  });

  it("throws ForkPullRequestError when head repo differs from base repo", () => {
    const pr = {
      head: {
        repo: { full_name: "someone-else/pr-review-agent" },
        ref: "their-branch",
      },
      base: { repo: { full_name: "skurusamy/pr-review-agent" } },
    };

    expect(() => assertSameRepoPullRequest(pr)).toThrow(ForkPullRequestError);
  });

  it("throws when the head repo is null (deleted fork)", () => {
    const pr = {
      head: { repo: null, ref: "gone-branch" },
      base: { repo: { full_name: "skurusamy/pr-review-agent" } },
    };

    expect(() => assertSameRepoPullRequest(pr)).toThrow(ForkPullRequestError);
  });
});
