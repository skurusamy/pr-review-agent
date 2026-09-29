import { describe, expect, it } from "vitest";
import {
  MAX_COMMENT_CHARS,
  MAX_CONVERSATION_COMMENTS,
  MAX_THREADS_SHOWN,
  describeAuthor,
  describeRootAuthor,
  formatConversationForPrompt,
  formatExistingThreadsForPrompt,
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

describe("formatConversationForPrompt", () => {
  it("is empty when there is no discussion", () => {
    expect(formatConversationForPrompt([])).toBe("");
  });

  it("lists comments oldest first and labels the PR author", () => {
    const out = formatConversationForPrompt(
      [
        { author: "pat", body: "Not touching the parser here." },
        { author: "sam", body: "Fine by me." },
      ],
      "PAT",
    );
    expect(out).toContain("Discussion on the PR as a whole, oldest first:");
    expect(out).toContain("- pat (PR author): Not touching the parser here.");
    expect(out).toContain("- sam: Fine by me.");
  });

  it("keeps only the most recent comments and says how many were left out", () => {
    const comments = Array.from(
      { length: MAX_CONVERSATION_COMMENTS + 3 },
      (_, i) => ({ author: "u", body: `comment ${i}` }),
    );
    const out = formatConversationForPrompt(comments);
    expect(out).toContain("(3 earlier comment(s) not shown)");
    expect(out).not.toContain("comment 2\n");
    expect(out).toContain(`comment ${MAX_CONVERSATION_COMMENTS + 2}`);
  });

  it("clips a very long comment", () => {
    const out = formatConversationForPrompt([
      { author: "u", body: "x".repeat(MAX_COMMENT_CHARS + 500) },
    ]);
    expect(out).toContain("...(truncated)");
    expect(out.length).toBeLessThan(MAX_COMMENT_CHARS + 200);
  });
});

describe("formatExistingThreadsForPrompt", () => {
  const at = (
    id: number,
    extra: Partial<ReviewThread> = {},
    rootExtra: Partial<ReviewComment> = {},
  ): ReviewThread => ({
    rootComment: comment({
      id,
      path: `src/f${id}.ts`,
      line: id,
      author: "rita",
      body: `concern ${id}`,
      ...rootExtra,
    }),
    replies: [],
    prAuthor: "pat",
    ...extra,
  });

  it("is empty when there are no threads", () => {
    expect(formatExistingThreadsForPrompt([])).toBe("");
  });

  it("shows where each thread is, its state, and what was said", () => {
    const out = formatExistingThreadsForPrompt([
      at(1, {
        replies: [comment({ id: 9, author: "pat", body: "Will fix." })],
      }),
      at(2, { resolved: true }),
      at(3, {}, { line: null, originalLine: 30, outdated: true }),
    ]);
    expect(out).toContain("- src/f1.ts:1 [open]");
    expect(out).toContain("  rita (reviewer): concern 1");
    expect(out).toContain("  pat (PR author): Will fix.");
    expect(out).toContain("- src/f2.ts:2 [resolved]");
    expect(out).toContain("- src/f3.ts:30 [outdated]");
  });

  it("puts open threads ahead of resolved ones when it has to cut", () => {
    const threads = [
      ...Array.from({ length: MAX_THREADS_SHOWN }, (_, i) =>
        at(100 + i, { resolved: true }),
      ),
      at(1),
    ];
    const out = formatExistingThreadsForPrompt(threads);
    expect(out).toContain("src/f1.ts:1 [open]");
    expect(out).toContain("(1 more thread(s) not shown)");
  });

  it("does not show our hidden Agent Marker", () => {
    const out = formatExistingThreadsForPrompt([
      at(
        1,
        {},
        {
          body: "Fixed.\n\n<!-- pr-review-agent:comment-1 -->",
        },
      ),
    ]);
    expect(out).toContain("Fixed.");
    expect(out).not.toContain("pr-review-agent:comment");
  });
});
