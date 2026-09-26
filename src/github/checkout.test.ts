import { describe, expect, it } from "vitest";
import { assertSameRepoPullRequest, ForkPullRequestError } from "./checkout.js";

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
