import { formatChangedFilesTree } from "../briefing/changedFilesTree.js";
import type { CodeReview, Finding } from "./generateReview.js";
import { describeVerification, isDismissed } from "./verification.js";
import { formatSuggestionBlock, suggestionRange } from "./suggestion.js";

function formatFinding(f: Finding): string {
  const { start, end } = suggestionRange(f);
  const suggestion = f.suggestion
    ? `\n\nSuggested change (${start === end ? `line ${end}` : `lines ${start}-${end}`}):\n\n${formatSuggestionBlock(f.suggestion.replacement, "")}`
    : "";
  const check = f.verification
    ? `\n\n_${describeVerification(f.verification)}_`
    : "";
  return `### [${f.severity.toUpperCase()}] ${f.title}

\`${f.path}:${f.line}\` · ${f.category}

${f.explanation}${suggestion}${check}`;
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
  const standing = review.findings.filter((f) => !isDismissed(f));
  const standingOffDiff = review.unanchored.filter((f) => !isDismissed(f));
  const dismissed = [...review.findings, ...review.unanchored].filter(
    isDismissed,
  );

  const findings =
    standing.length > 0
      ? standing.map(formatFinding).join("\n\n")
      : "_No findings the reviewer would stand behind._";

  const unanchored =
    standingOffDiff.length > 0
      ? `\n\n## Findings not anchored to the diff\n\nThese name a line that is not part of the diff, so they can't be posted as inline comments.\n\n${standingOffDiff.map(formatFinding).join("\n\n")}`
      : "";

  const dismissedSection =
    dismissed.length > 0
      ? `\n\n## Checked and dismissed (${dismissed.length})\n\nThe review raised these, but a second check found they do not hold. They are listed so nothing is hidden.\n\n${dismissed.map(formatFinding).join("\n\n")}`
      : "";

  const skipped =
    review.skippedFiles.length > 0
      ? `\n\n## Not reviewed\n\nThe model was not shown a diff for these files:\n\n${review.skippedFiles.map((s) => `- \`${s.path}\` (${s.reason})`).join("\n")}`
      : "";

  const linked =
    review.linkedIssues.length > 0
      ? `\n\n## Linked issues\n\n${review.linkedIssues.map((i) => `- #${i.number} ${i.title} (${i.kind}, ${i.state})`).join("\n")}`
      : "";

  return `# Code Review: ${prTitle}

${prUrl}

## Assessment

${review.assessment}${linked}

## Changed files

\`\`\`
${formatChangedFilesTree(review.changedFiles)}
\`\`\`

## Findings (${standing.length})

${findings}${unanchored}${dismissedSection}${skipped}
`;
}
