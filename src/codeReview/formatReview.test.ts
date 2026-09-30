import { describe, expect, it } from "vitest";
import { formatCodeReviewMarkdown } from "./formatReview.js";
import type { CodeReview, Finding } from "./generateReview.js";

const finding: Finding = {
  path: "src/page.ts",
  line: 11,
  severity: "high",
  category: "correctness",
  title: "Drops the last page",
  explanation: "The loop bound is exclusive.",
};

function makeReview(overrides: Partial<CodeReview> = {}): CodeReview {
  return {
    assessment: "Small and focused.",
    findings: [],
    unanchored: [],
    skippedFiles: [],
    changedFiles: [
      { path: "src/page.ts", status: "modified", additions: 2, deletions: 1 },
    ],
    linkedIssues: [],
    ...overrides,
  };
}

const render = (review: CodeReview): string =>
  formatCodeReviewMarkdown("My PR", "https://github.com/o/r/pull/1", review);

describe("formatCodeReviewMarkdown", () => {
  it("renders the title, url, assessment and changed files", () => {
    const md = render(makeReview());
    expect(md).toContain("# Code Review: My PR");
    expect(md).toContain("https://github.com/o/r/pull/1");
    expect(md).toContain("Small and focused.");
    expect(md).toContain("~ src/page.ts (+2 -1)");
  });

  it("lists the linked issues it read, and omits the section when there are none", () => {
    expect(render(makeReview())).not.toContain("## Linked issues");
    const md = render(
      makeReview({
        linkedIssues: [
          {
            number: 12,
            kind: "issue",
            title: "Last page is dropped",
            state: "open",
            body: "",
          },
        ],
      }),
    );
    expect(md).toContain("## Linked issues");
    expect(md).toContain("- #12 Last page is dropped (issue, open)");
  });

  it("says so when there are no findings", () => {
    const md = render(makeReview());
    expect(md).toContain("## Findings (0)");
    expect(md).toContain("No findings");
  });

  it("renders a finding with severity, location, category and explanation", () => {
    const md = render(makeReview({ findings: [finding] }));
    expect(md).toContain("## Findings (1)");
    expect(md).toContain("### [HIGH] Drops the last page");
    expect(md).toContain("`src/page.ts:11` · correctness");
    expect(md).toContain("The loop bound is exclusive.");
  });

  it("puts unanchored findings in their own section", () => {
    const md = render(makeReview({ unanchored: [finding] }));
    expect(md).toContain("## Findings not anchored to the diff");
    expect(md).toContain("### [HIGH] Drops the last page");
  });

  it("omits the unanchored and not-reviewed sections when empty", () => {
    const md = render(makeReview());
    expect(md).not.toContain("not anchored");
    expect(md).not.toContain("Not reviewed");
  });

  it("lists files that were not reviewed", () => {
    const md = render(
      makeReview({
        skippedFiles: [{ path: "package-lock.json", reason: "lockfile" }],
      }),
    );
    expect(md).toContain("## Not reviewed");
    expect(md).toContain("`package-lock.json` (lockfile)");
  });
});

describe("formatCodeReviewMarkdown after the verify pass", () => {
  const checked = (
    status: "confirmed" | "refuted" | "unsure",
    title: string,
  ) => ({
    ...finding,
    title,
    verification: { status, evidence: `evidence for ${title}` },
  });

  it("says what the second check found under each finding", () => {
    const md = render(makeReview({ findings: [checked("confirmed", "Real")] }));
    expect(md).toContain("Confirmed by a second check: evidence for Real");
  });

  it("moves dismissed findings to their own section and leaves them out of the count", () => {
    const md = render(
      makeReview({
        findings: [checked("confirmed", "Real"), checked("refuted", "Wrong")],
      }),
    );
    expect(md).toContain("## Findings (1)");
    expect(md).toContain("## Checked and dismissed (1)");
    expect(md.indexOf("Wrong")).toBeGreaterThan(
      md.indexOf("## Checked and dismissed"),
    );
  });

  it("keeps a not-confirmed finding visible and says so", () => {
    const md = render(makeReview({ findings: [checked("unsure", "Maybe")] }));
    expect(md).toContain("## Findings (1)");
    expect(md).toContain("Not confirmed: the second check could not decide");
  });

  it("shows no dismissed section when nothing was dismissed", () => {
    expect(render(makeReview({ findings: [finding] }))).not.toContain(
      "Checked and dismissed",
    );
  });
});
