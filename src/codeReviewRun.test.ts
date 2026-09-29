import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripRemoteCredentials } from "./codeReviewRun.js";

describe("stripRemoteCredentials", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "strip-creds-"));
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote(
      "origin",
      "https://x-access-token:ghp_SECRET123@github.com/acme/widgets.git",
    );
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("removes the token from the remote URL and from .git/config", async () => {
    const before = await readFile(join(dir, ".git", "config"), "utf-8");
    expect(before).toContain("ghp_SECRET123");

    await stripRemoteCredentials(dir, "acme", "widgets");

    const after = await readFile(join(dir, ".git", "config"), "utf-8");
    expect(after).not.toContain("ghp_SECRET123");
    expect(after).not.toContain("x-access-token");
    expect((await simpleGit(dir).remote(["get-url", "origin"]))?.trim()).toBe(
      "https://github.com/acme/widgets.git",
    );
  });
});
