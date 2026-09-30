import { describe, expect, it } from "vitest";
import { buildAnchorIndex, parseDiffFiles } from "./diffLines.js";
import type { Finding } from "./generateReview.js";
import {
  findingMarker,
  formatSuggestionBlock,
  MAX_SUGGESTION_LINES,
  sanitizeSuggestion,
} from "./suggestion.js";

// Head-version lines 10..12 are in the diff; 11 is added.
const DIFF = `diff --git a/src/page.ts b/src/page.ts
--- a/src/page.ts
+++ b/src/page.ts
@@ -10,2 +10,3 @@
 a
+b
 c
`;
const index = buildAnchorIndex(parseDiffFiles(DIFF));

const finding = (over: Partial<Finding> = {}): Finding => ({
  path: "src/page.ts",
  line: 11,
  severity: "medium",
  category: "correctness",
  title: "T",
  explanation: "E",
  ...over,
});

describe("sanitizeSuggestion", () => {
  it("keeps a one-line suggestion on a line of the diff", () => {
    const f = finding({ suggestion: { replacement: "x" } });
    expect(sanitizeSuggestion(f, index)).toBe(f);
  });

  it("keeps a multi-line suggestion when every line is in the diff", () => {
    const f = finding({
      line: 12,
      suggestion: { startLine: 10, replacement: "x" },
    });
    expect(sanitizeSuggestion(f, index)).toBe(f);
  });

  it("drops the suggestion, not the finding, when a line is outside the diff", () => {
    const f = finding({
      line: 12,
      suggestion: { startLine: 8, replacement: "x" },
    });
    const out = sanitizeSuggestion(f, index);
    expect(out.suggestion).toBeUndefined();
    expect(out.title).toBe("T");
  });

  it("drops a suggestion whose start is after its end", () => {
    const f = finding({
      line: 10,
      suggestion: { startLine: 12, replacement: "x" },
    });
    expect(sanitizeSuggestion(f, index).suggestion).toBeUndefined();
  });

  it(`drops a suggestion longer than ${MAX_SUGGESTION_LINES} lines`, () => {
    const big = new Map([
      ["src/page.ts", new Set(Array.from({ length: 40 }, (_, i) => i + 1))],
    ]);
    const f = finding({
      line: 30,
      suggestion: { startLine: 10, replacement: "x" },
    });
    expect(sanitizeSuggestion(f, big).suggestion).toBeUndefined();
  });

  it("returns a finding without a suggestion untouched", () => {
    const f = finding();
    expect(sanitizeSuggestion(f, index)).toBe(f);
  });
});

describe("formatSuggestionBlock", () => {
  it("wraps the text in a suggestion fence", () => {
    expect(formatSuggestionBlock("a\nb")).toBe("```suggestion\na\nb\n```");
  });

  it("drops one trailing newline", () => {
    expect(formatSuggestionBlock("a\n")).toBe("```suggestion\na\n```");
  });

  it("uses a longer fence when the text itself contains a fence", () => {
    const block = formatSuggestionBlock("x\n```js\ny\n```");
    expect(block.startsWith("````suggestion\n")).toBe(true);
    expect(block.endsWith("\n````")).toBe(true);
  });
});

describe("findingMarker", () => {
  it("is stable for the same file and title, whatever the line or wording of the explanation", () => {
    expect(findingMarker(finding({ line: 5 }))).toBe(
      findingMarker(finding({ line: 99, explanation: "other" })),
    );
  });

  it("differs by file and by title, and ignores case and padding in the title", () => {
    expect(findingMarker(finding({ path: "b.ts" }))).not.toBe(
      findingMarker(finding()),
    );
    expect(findingMarker(finding({ title: "Other" }))).not.toBe(
      findingMarker(finding()),
    );
    expect(findingMarker(finding({ title: "  t " }))).toBe(
      findingMarker(finding()),
    );
  });

  it("is a hidden HTML comment", () => {
    expect(findingMarker(finding())).toMatch(
      /^<!-- pr-review-agent:finding-[0-9a-f]{12} -->$/,
    );
  });
});
