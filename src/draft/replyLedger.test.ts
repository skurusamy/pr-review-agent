import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import { withMarker, hasMarkerForComment, stripMarker } from "./draftReply.js";
import {
  dryRunReplyLedger,
  githubReplyLedger,
  type ReplyLedger,
} from "./replyLedger.js";

function fakeLedger(): ReplyLedger {
  return {
    hasExistingReply: vi.fn(async () => true),
    postFixConfirmation: vi.fn(async () => {}),
    createPendingReview: vi.fn(async () => ({
      created: true as const,
      reviewId: 1,
    })),
  };
}

describe("withMarker", () => {
  it("appends a marker for exactly that comment, and stripMarker undoes it", () => {
    const body = withMarker("looks fine", 7);
    expect(hasMarkerForComment(body, 7)).toBe(true);
    expect(hasMarkerForComment(body, 8)).toBe(false);
    expect(stripMarker(body)).toBe("looks fine");
  });
});

describe("dryRunReplyLedger", () => {
  it("reads through to the inner ledger but never writes", async () => {
    const inner = fakeLedger();
    const lines: string[] = [];
    const ledger = dryRunReplyLedger(inner, (l) => lines.push(l));

    expect(await ledger.hasExistingReply(1)).toBe(true);
    await ledger.postFixConfirmation(1, "abc1234", "fix");
    const result = await ledger.createPendingReview([
      { rootCommentId: 1, path: "a.ts", line: 3, body: "x" },
    ]);

    expect(result).toEqual({ created: false, reason: "dry-run" });
    expect(inner.postFixConfirmation).not.toHaveBeenCalled();
    expect(inner.createPendingReview).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("a.ts:3");
  });
});

describe("githubReplyLedger", () => {
  it("asks GitHub who we are only once across many marker checks", async () => {
    const getAuthenticated = vi.fn(async () => ({ data: { login: "bot" } }));
    const octokit = {
      rest: {
        users: { getAuthenticated },
        pulls: {
          listReviewComments: vi.fn(),
          listReviews: vi.fn(),
          listCommentsForReview: vi.fn(),
        },
      },
      paginate: vi.fn(async () => []),
    } as unknown as Octokit;

    const ledger = githubReplyLedger(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 1,
    });
    await ledger.hasExistingReply(1);
    await ledger.hasExistingReply(2);
    await ledger.hasExistingReply(3);

    expect(getAuthenticated).toHaveBeenCalledTimes(1);
  });
});
