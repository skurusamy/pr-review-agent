import { describe, expect, it } from "vitest";
import {
  describeAuthor,
  describeRootAuthor,
  formatRepliesForPrompt,
} from "./formatThread.js";
import type { ReviewComment, ReviewThread } from "./types.js";

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: 1,
    path: "a.ts",
    line: 3,
    originalLine: 3,
    diffHunk: "@@",
    body: "text",
    author: "someone",
    createdAt: "2026-01-01T00:00:00Z",
    htmlUrl: "https://github.com/o/r/pull/1#r1",
    outdated: false,
    ...overrides,
  };
}

function thread(replies: ReviewComment[], prAuthor = "pat"): ReviewThread {
  return {
    rootComment: comment({ id: 1, author: "rita", body: "Is this safe?" }),
    replies,
    prAuthor,
  };
}

describe("describeAuthor", () => {
  it("labels the PR author, the reviewer who opened the thread, and leaves others plain", () => {
    const t = thread([]);
    expect(describeAuthor(t, comment({ id: 2, author: "pat" }))).toBe(
      "pat (PR author)",
    );
    expect(describeRootAuthor(t)).toBe("rita (reviewer)");
    expect(describeAuthor(t, comment({ id: 3, author: "rita" }))).toBe(
      "rita (reviewer)",
    );
    expect(describeAuthor(t, comment({ id: 4, author: "sam" }))).toBe("sam");
  });

  it("compares logins case-insensitively", () => {
    expect(describeAuthor(thread([]), comment({ author: "PAT" }))).toBe(
      "PAT (PR author)",
    );
  });

  it("does not guess when the PR author is unknown", () => {
    const t: ReviewThread = { ...thread([]), prAuthor: undefined };
    expect(describeAuthor(t, comment({ id: 2, author: "pat" }))).toBe("pat");
  });
});

describe("formatRepliesForPrompt", () => {
  it("is empty when there are no replies", () => {
    expect(formatRepliesForPrompt(thread([]))).toBe("");
  });

  it("lists every reply oldest first, labelled, without the hidden Agent Marker", () => {
    const out = formatRepliesForPrompt(
      thread([
        comment({ id: 2, author: "pat", body: "Intentional, see line 40." }),
        comment({
          id: 3,
          author: "rita",
          body: "I meant the other function.",
        }),
        comment({
          id: 4,
          author: "bot",
          body: "Fixed in abc1234\n\n<!-- pr-review-agent:comment-1 -->",
        }),
      ]),
    );
    expect(out).toBe(
      [
        "",
        "",
        "Replies in this thread, oldest first:",
        "- pat (PR author): Intentional, see line 40.",
        "- rita (reviewer): I meant the other function.",
        "- bot: Fixed in abc1234",
      ].join("\n"),
    );
  });
});
