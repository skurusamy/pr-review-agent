import { formatChangedFilesTree } from "./changedFilesTree.js";
import type { Briefing } from "./generateBriefing.js";

/**
 * Renders a Briefing as Markdown -- what the CLI prints, and (per the map's
 * next ticket) what the downloadable file and "post to GitHub" comment will
 * both reuse verbatim, so there's exactly one place that decides what a
 * Briefing looks like.
 */
export function formatBriefingMarkdown(
  prTitle: string,
  prUrl: string,
  briefing: Briefing,
): string {
  const risks =
    briefing.risks.length > 0
      ? briefing.risks.map((r) => `- ${r}`).join("\n")
      : "_Nothing in particular stood out._";

  const linked =
    briefing.linkedIssues.length > 0
      ? `\n## Linked issues\n\n${briefing.linkedIssues.map((i) => `- #${i.number} ${i.title} (${i.kind}, ${i.state})`).join("\n")}\n`
      : "";

  const fits = briefing.howItFits
    ? `\n## How it fits in\n\n${briefing.howItFits}\n`
    : "";
  const reading =
    briefing.readingOrder && briefing.readingOrder.length > 0
      ? `\n## Where to start reading\n\n${briefing.readingOrder.map((r, i) => `${i + 1}. \`${r.path}\`: ${r.why}`).join("\n")}\n`
      : "";

  return `# PR Briefing: ${prTitle}

${prUrl}

## Summary

${briefing.summary}
${fits}${reading}
## Changed files

\`\`\`
${formatChangedFilesTree(briefing.changedFiles)}
\`\`\`
${linked}
## Diagram

\`\`\`mermaid
${briefing.mermaidDiagram}
\`\`\`

## Risks to check

${risks}
`;
}

/**
 * A Briefing as the Code Review is shown it: only what the briefing judged
 * (summary, how it fits in, reading order, risks). The changed files and the
 * diagram are left out, since the review already has the files and a diagram
 * would only cost tokens.
 */
export function formatBriefingForReview(briefing: Briefing): string {
  const fits = briefing.howItFits
    ? `\n\nHow it fits in:\n${briefing.howItFits}`
    : "";
  const reading =
    briefing.readingOrder && briefing.readingOrder.length > 0
      ? `\n\nWhere to start reading:\n${briefing.readingOrder.map((r, i) => `${i + 1}. ${r.path}: ${r.why}`).join("\n")}`
      : "";
  const risks =
    briefing.risks.length > 0
      ? `\n\nRisks it named:\n${briefing.risks.map((r) => `- ${r}`).join("\n")}`
      : "";
  return `Summary:\n${briefing.summary}${fits}${reading}${risks}`;
}
