import { describe, expect, it } from "vitest";
import { buildFixPrompt, parseFixInput } from "./attemptFix.js";
import type { ReviewThread } from "../github/types.js";
import type { Verdict } from "../verdict/reachVerdict.js";

const comment = (id: number, author: string, body: string) => ({
  id,
  path: "src/a.ts",
  line: 5,
  originalLine: 5,
  diffHunk: "@@ -1 +1 @@",
  body,
  author,
  createdAt: "2026-01-01T00:00:00Z",
  htmlUrl: "https://github.com/o/r/pull/1#r1",
  outdated: false,
});

const verdict: Verdict = { verdict: "bug", reasoning: "Off by one." };

describe("buildFixPrompt", () => {
  const thread: ReviewThread = {
    rootComment: comment(1, "rita", "This loses the last item."),
    replies: [
      comment(2, "pat", "Which one do you mean?"),
      comment(3, "rita", "The one in loadPage, not loadAll."),
    ],
    prAuthor: "pat",
  };
  const prompt = buildFixPrompt(thread, verdict);

  it("includes the whole thread, so a reply that narrows the ask reaches the editing session", () => {
    expect(prompt).toContain("This loses the last item.");
    expect(prompt).toContain("- pat (PR author): Which one do you mean?");
    expect(prompt).toContain(
      "- rita (reviewer): The one in loadPage, not loadAll.",
    );
  });

  it("still carries the verdict's reasoning", () => {
    expect(prompt).toContain("Why this is a bug: Off by one.");
  });

  it("has no replies section for a thread nobody replied to", () => {
    const alone = buildFixPrompt({ ...thread, replies: [] }, verdict);
    expect(alone).not.toContain("Replies in this thread");
  });
});

describe("parseFixInput", () => {
  it("accepts a summary", () => {
    expect(parseFixInput({ summary: "Use <= in the loop bound" })).toEqual({
      summary: "Use <= in the loop bound",
    });
  });

  it("rejects a missing or blank summary, so the commit message can't be 'undefined'", () => {
    expect(parseFixInput({})).toBeUndefined();
    expect(parseFixInput({ summary: "   " })).toBeUndefined();
  });
});
