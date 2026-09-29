import { formatChangedFilesTree } from "../briefing/changedFilesTree.js";
import type { CodeReview, Finding } from "./generateReview.js";

function formatFinding(f: Finding): string {
  return `### [${f.severity.toUpperCase()}] ${f.title}

\`${f.path}:${f.line}\` · ${f.category}

${f.explanation}`;
}

/**
 * Renders a Code Review as Markdown -- what the CLI prints, and what the
 * downloadable file will reuse verbatim, so there is exactly one place that
 * decides what a Code Review looks like (same rule as formatBriefingMarkdown).
 */
export function formatCodeReviewMarkdown(
  prTitle: string,
  prUrl: string,
  review: CodeReview,
): string {
  const findings =
    review.findings.length > 0
      ? review.findings.map(formatFinding).join("\n\n")
      : "_No findings the reviewer would stand behind._";

  const unanchored =
    review.unanchored.length > 0
      ? `\n\n## Findings not anchored to the diff\n\nThese name a line that is not part of the diff, so they can't be posted as inline comments.\n\n${review.unanchored.map(formatFinding).join("\n\n")}`
      : "";

  const skipped =
    review.skippedFiles.length > 0
      ? `\n\n## Not reviewed\n\nThe model was not shown a diff for these files:\n\n${review.skippedFiles.map((s) => `- \`${s.path}\` (${s.reason})`).join("\n")}`
      : "";

  return `# Code Review: ${prTitle}

${prUrl}

## Assessment

${review.assessment}

## Changed files

\`\`\`
${formatChangedFilesTree(review.changedFiles)}
\`\`\`

## Findings (${review.findings.length})

${findings}${unanchored}${skipped}
`;
}
