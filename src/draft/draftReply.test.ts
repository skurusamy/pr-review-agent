import { describe, expect, it } from "vitest";
import { buildDraftReply, hasMarkerForComment } from "./draftReply.js";
import type { ReviewThread } from "../github/types.js";
import type { Verdict } from "../verdict/reachVerdict.js";

function makeThread(
  overrides: Partial<ReviewThread["rootComment"]> = {},
): ReviewThread {
  return {
    rootComment: {
      id: 42,
      path: "src/index.ts",
      line: 10,
      originalLine: 10,
      diffHunk: "@@ -1,3 +1,3 @@",
      body: "Is this off by one?",
      author: "reviewer",
      createdAt: "2026-01-01T00:00:00Z",
      htmlUrl: "https://github.com/o/r/pull/1#discussion_r1",
      outdated: false,
      ...overrides,
    },
    replies: [],
  };
}

describe("buildDraftReply", () => {
  it("uses the verdict's reasoning for a not-a-bug outcome", () => {
    const verdict: Verdict = {
      verdict: "not-a-bug",
      reasoning: "This is intentional.",
    };
    const entry = buildDraftReply(makeThread(), { kind: "not-a-bug", verdict });

    expect(entry.body).toContain("This is intentional.");
    expect(entry.rootCommentId).toBe(42);
    expect(entry.path).toBe("src/index.ts");
    expect(entry.line).toBe(10);
  });

  it("explains which gate failed for an exhausted outcome", () => {
    const entry = buildDraftReply(makeThread(), {
      kind: "exhausted",
      failedGate: "test",
    });
    expect(entry.body).toContain("`test`");
    expect(entry.body).toContain("3 times");
  });

  it("embeds a marker naming the specific root comment id", () => {
    const entry = buildDraftReply(makeThread({ id: 999 }), {
      kind: "not-a-bug",
      verdict: { verdict: "not-a-bug", reasoning: "ok" },
    });
    expect(hasMarkerForComment(entry.body, 999)).toBe(true);
    expect(hasMarkerForComment(entry.body, 1000)).toBe(false);
  });

  it("falls back to originalLine when line is null (outdated comment)", () => {
    const entry = buildDraftReply(
      makeThread({ line: null, originalLine: 55, outdated: true }),
      {
        kind: "not-a-bug",
        verdict: { verdict: "not-a-bug", reasoning: "ok" },
      },
    );
    expect(entry.line).toBe(55);
  });
});
