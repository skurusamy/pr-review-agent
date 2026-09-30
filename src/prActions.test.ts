import { describe, expect, it } from "vitest";
import { describePostedReview, markdownFileName } from "./prActions.js";

describe("describePostedReview", () => {
  it("links the pending review when one was created", () => {
    expect(
      describePostedReview({
        created: true,
        reviewId: 5,
        url: "https://github.com/o/r/pull/1#pullrequestreview-5",
        commentCount: 2,
        alreadyPosted: 0,
      }),
    ).toContain("2 comment(s)");
  });

  it("says when findings were left out because an earlier run posted them", () => {
    expect(
      describePostedReview({
        created: true,
        reviewId: 5,
        url: "https://github.com/o/r/pull/1#pullrequestreview-5",
        commentCount: 1,
        alreadyPosted: 2,
      }),
    ).toContain("2 finding(s) left out because an earlier run already posted");
  });

  it("tells the person to submit or dismiss the existing one", () => {
    expect(
      describePostedReview({ created: false, reason: "pending-review-exists" }),
    ).toMatch(/Submit or dismiss/);
  });
});

describe("markdownFileName", () => {
  it("names the file after the PR", () => {
    expect(
      markdownFileName("code-review", { owner: "o", repo: "r", prNumber: 3 }),
    ).toBe("code-review-o-r-3.md");
  });
});
