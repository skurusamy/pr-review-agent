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

  return `# PR Briefing: ${prTitle}

${prUrl}

## Summary

${briefing.summary}

## Changed files

\`\`\`
${formatChangedFilesTree(briefing.changedFiles)}
\`\`\`

## Diagram

\`\`\`mermaid
${briefing.mermaidDiagram}
\`\`\`

## Risks to check

${risks}
`;
}
