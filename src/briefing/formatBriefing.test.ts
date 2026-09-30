import { describe, expect, it } from "vitest";
import { formatBriefingMarkdown } from "./formatBriefing.js";
import type { Briefing } from "./generateBriefing.js";

function makeBriefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    summary: "Adjusts the pagination loop bound.",
    mermaidDiagram: "flowchart TD\n  A --> B",
    risks: ["Check the last-page edge case"],
    changedFiles: [
      { path: "src/page.ts", status: "modified", additions: 2, deletions: 1 },
    ],
    linkedIssues: [],
    ...overrides,
  };
}

describe("formatBriefingMarkdown", () => {
  it("includes the PR title and url", () => {
    const md = formatBriefingMarkdown(
      "Fix pagination",
      "https://github.com/o/r/pull/1",
      makeBriefing(),
    );
    expect(md).toContain("Fix pagination");
    expect(md).toContain("https://github.com/o/r/pull/1");
  });

  it("includes the summary and risks", () => {
    const md = formatBriefingMarkdown("t", "u", makeBriefing());
    expect(md).toContain("Adjusts the pagination loop bound.");
    expect(md).toContain("Check the last-page edge case");
  });

  it("wraps the diagram in a mermaid code fence", () => {
    const md = formatBriefingMarkdown("t", "u", makeBriefing());
    expect(md).toContain("```mermaid\nflowchart TD\n  A --> B\n```");
  });

  it("includes the changed-files tree", () => {
    const md = formatBriefingMarkdown("t", "u", makeBriefing());
    expect(md).toContain("src/page.ts");
  });

  it("lists linked issues under their own heading", () => {
    const md = formatBriefingMarkdown(
      "t",
      "u",
      makeBriefing({
        linkedIssues: [
          {
            number: 12,
            kind: "issue",
            title: "Pagination drops the last page",
            state: "open",
            body: "b",
          },
        ],
      }),
    );
    expect(md).toContain("## Linked issues");
    expect(md).toContain("- #12 Pagination drops the last page (issue, open)");
  });

  it("leaves out the linked-issues section when there are none", () => {
    expect(formatBriefingMarkdown("t", "u", makeBriefing())).not.toContain(
      "Linked issues",
    );
  });

  it("shows a fallback when there are no risks", () => {
    const md = formatBriefingMarkdown("t", "u", makeBriefing({ risks: [] }));
    expect(md).toContain("Nothing in particular stood out.");
  });
});

describe("formatBriefingMarkdown for a deeper briefing", () => {
  it("adds how-it-fits and a numbered reading order right after the summary", () => {
    const md = formatBriefingMarkdown(
      "t",
      "u",
      makeBriefing({
        howItFits: "Called from the router.",
        readingOrder: [
          { path: "src/a.ts", why: "Start here." },
          { path: "src/b.ts", why: "The caller." },
        ],
      }),
    );
    expect(md).toContain("## How it fits in\n\nCalled from the router.");
    expect(md).toContain(
      "## Where to start reading\n\n1. `src/a.ts`: Start here.\n2. `src/b.ts`: The caller.",
    );
    expect(md.indexOf("## Summary")).toBeLessThan(
      md.indexOf("## How it fits in"),
    );
    expect(md.indexOf("## Where to start reading")).toBeLessThan(
      md.indexOf("## Changed files"),
    );
  });

  it("a quick briefing has neither section", () => {
    const md = formatBriefingMarkdown("t", "u", makeBriefing());
    expect(md).not.toContain("How it fits in");
    expect(md).not.toContain("Where to start reading");
  });

  it("an empty reading order adds no section", () => {
    expect(
      formatBriefingMarkdown("t", "u", makeBriefing({ readingOrder: [] })),
    ).not.toContain("Where to start reading");
  });
});
