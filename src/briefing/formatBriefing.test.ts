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
