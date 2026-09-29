import { describe, expect, it } from "vitest";
import { buildBriefingPrompt } from "./generateBriefing.js";
import type { PrContext } from "./fetchPrContext.js";

function makeContext(overrides: Partial<PrContext> = {}): PrContext {
  return {
    title: "Fix off-by-one in pagination",
    description: "Adjusts the loop bound so the last page isn't dropped.",
    comments: [],
    diff: "diff --git a/src/page.ts b/src/page.ts\n+const x = 1;\n",
    ...overrides,
  };
}

describe("buildBriefingPrompt", () => {
  it("includes the PR title and description", () => {
    const prompt = buildBriefingPrompt(makeContext(), []);
    expect(prompt).toContain("Fix off-by-one in pagination");
    expect(prompt).toContain("Adjusts the loop bound");
  });

  it("includes the raw diff", () => {
    const prompt = buildBriefingPrompt(makeContext(), []);
    expect(prompt).toContain("const x = 1;");
  });

  it("includes existing conversation when present", () => {
    const context = makeContext({
      comments: [{ author: "teammate", body: "Why not just clamp the index?" }],
    });
    expect(buildBriefingPrompt(context, [])).toContain(
      "Why not just clamp the index?",
    );
  });

  it("notes when there is no description", () => {
    const prompt = buildBriefingPrompt(makeContext({ description: null }), []);
    expect(prompt).toContain("no description provided");
  });

  it("includes the mechanical changed-files tree", () => {
    const files = [
      {
        path: "src/page.ts",
        status: "modified" as const,
        additions: 1,
        deletions: 0,
      },
    ];
    const prompt = buildBriefingPrompt(makeContext(), files);
    expect(prompt).toContain("src/page.ts");
  });
});
