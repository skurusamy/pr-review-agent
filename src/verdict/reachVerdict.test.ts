import { describe, expect, it } from "vitest";
import { buildPrompt, decideAction, type Verdict } from "./reachVerdict.js";
import type { ReviewThread } from "../github/types.js";

function makeThread(
  overrides: Partial<ReviewThread["rootComment"]> = {},
): ReviewThread {
  return {
    rootComment: {
      id: 1,
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

describe("buildPrompt", () => {
  it("includes the comment body and diff hunk", () => {
    const prompt = buildPrompt(makeThread());
    expect(prompt).toContain("Is this off by one?");
    expect(prompt).toContain("@@ -1,3 +1,3 @@");
    expect(prompt).toContain("src/index.ts");
  });

  it("includes existing replies as context when present", () => {
    const thread = makeThread();
    thread.replies.push({
      id: 2,
      path: "src/index.ts",
      line: 10,
      originalLine: 10,
      diffHunk: "@@ -1,3 +1,3 @@",
      body: "This is intentional, see line 40.",
      author: "author",
      createdAt: "2026-01-01T01:00:00Z",
      htmlUrl: "https://github.com/o/r/pull/1#discussion_r2",
      outdated: false,
    });

    expect(buildPrompt(thread)).toContain("This is intentional, see line 40.");
  });

  it("says who wrote the comment and each reply, so the model can tell intent from concern", () => {
    const thread = {
      ...makeThread(),
      prAuthor: "pat",
    };
    thread.replies.push({
      ...thread.rootComment,
      id: 2,
      author: "pat",
      body: "Intentional.",
    });

    const prompt = buildPrompt(thread);
    expect(prompt).toContain("Comment from reviewer (reviewer)");
    expect(prompt).toContain("- pat (PR author): Intentional.");
    expect(prompt).toContain("not proof");
  });

  it("includes the PR's general discussion when given, labelled, and says it is not proof", () => {
    const prompt = buildPrompt({ ...makeThread(), prAuthor: "pat" }, [
      { author: "pat", body: "We are not touching the parser in this PR." },
    ]);
    expect(prompt).toContain("Discussion on the PR as a whole");
    expect(prompt).toContain(
      "- pat (PR author): We are not touching the parser in this PR.",
    );
    expect(prompt).toContain("not proof");
  });

  it("has no discussion section when there is none", () => {
    expect(buildPrompt(makeThread())).not.toContain("Discussion on the PR");
  });

  it("notes when a comment is outdated", () => {
    const prompt = buildPrompt(makeThread({ outdated: true, line: null }));
    expect(prompt).toContain("outdated");
  });
});

describe("decideAction", () => {
  const bug: Verdict = { verdict: "bug", reasoning: "..." };
  const notABug: Verdict = { verdict: "not-a-bug", reasoning: "..." };

  it("routes a bug verdict to fix when the comment is current", () => {
    expect(decideAction(makeThread(), bug)).toBe("fix");
  });

  it("routes a not-a-bug verdict to draft-reply", () => {
    expect(decideAction(makeThread(), notABug)).toBe("draft-reply");
  });

  it("routes to draft-reply for an outdated comment even with a bug verdict", () => {
    expect(decideAction(makeThread({ outdated: true }), bug)).toBe(
      "draft-reply",
    );
  });
});
