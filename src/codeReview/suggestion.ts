import { createHash } from "node:crypto";
import { z } from "zod";
import { isAnchorable, type AnchorIndex } from "./diffLines.js";
import type { Finding } from "./generateReview.js";

/** A suggested change stays small: a bigger rewrite belongs in the explanation. */
export const MAX_SUGGESTION_LINES = 10;

export const suggestionSchema = z.object({
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Only when the fix spans several lines: the first line it replaces. The finding's own line is then the last line replaced. Leave out for a one-line fix.",
    ),
  replacement: z
    .string()
    .refine((text) => text.trim().length > 0, "replacement must not be blank")
    .describe(
      "The exact text that should replace those line(s), as it should read in the file: no line numbers, no diff markers (+ or -), no code fences.",
    ),
});

export type Suggestion = z.infer<typeof suggestionSchema>;

/** The first and last line a suggestion would replace. */
export function suggestionRange(f: Finding): { start: number; end: number } {
  return { start: f.suggestion?.startLine ?? f.line, end: f.line };
}

/**
 * Drops a suggestion that could not be applied as written, keeping the
 * finding itself: every line it replaces must be a line of the diff (an added
 * or unchanged line of the head version), in order, and at most
 * MAX_SUGGESTION_LINES long. Deterministic, like anchoring: whether GitHub
 * can offer the change is a fact about the diff.
 */
export function sanitizeSuggestion(f: Finding, index: AnchorIndex): Finding {
  if (!f.suggestion) return f;
  const { start, end } = suggestionRange(f);
  const fits = start <= end && end - start + 1 <= MAX_SUGGESTION_LINES;
  let anchored = fits;
  for (let line = start; anchored && line <= end; line++) {
    anchored = isAnchorable(index, f.path, line);
  }
  if (anchored) return f;
  const rest = { ...f };
  delete rest.suggestion;
  return rest;
}

/**
 * A GitHub "suggested change" block. The fence is longer than any run of
 * backticks inside the text, so a replacement that contains a code fence
 * cannot end the block early and leak into the comment around it.
 */
export function formatSuggestionBlock(
  replacement: string,
  info = "suggestion",
): string {
  const text = replacement.replace(/\r?\n$/, "");
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

/**
 * The hidden marker on a posted finding, so a later run can tell it was
 * already posted (same idea as the Agent Marker on a Draft Reply). Built from
 * the file and the title, not the line, because a push can move the line.
 */
export function findingMarker(f: Pick<Finding, "path" | "title">): string {
  const digest = createHash("sha1")
    .update(`${f.path}\n${f.title.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
  return `<!-- pr-review-agent:finding-${digest} -->`;
}
