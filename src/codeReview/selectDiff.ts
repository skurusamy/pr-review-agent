import { annotateDiffFile, type DiffFile } from "./diffLines.js";

export interface SkippedFile {
  path: string;
  reason: "lockfile" | "too-large";
}

export interface SelectedDiff {
  /** Files whose diff the model is shown. */
  included: DiffFile[];
  /** Files it was not shown -- reported, so a partial review never reads as a full one. */
  skipped: SkippedFile[];
}

// Roughly 40k tokens of diff: enough for a normal PR, small enough to leave
// the session room to Read surrounding code. A PR beyond this is reviewed
// partially and says so, rather than silently truncated or failing.
export const MAX_DIFF_CHARS = 150_000;

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
]);

function isLockfile(path: string): boolean {
  return LOCKFILES.has(path.split("/").pop() ?? path);
}

/**
 * Picks which files' diffs go into the prompt. Lockfiles are machine output
 * nobody reviews line by line; anything else that doesn't fit the budget is
 * skipped whole (never cut mid-file, which would leave half a hunk).
 * Greedy in diff order, so one huge file doesn't crowd out the small ones
 * after it.
 */
export function selectDiffForReview(
  files: DiffFile[],
  maxChars: number = MAX_DIFF_CHARS,
): SelectedDiff {
  const included: DiffFile[] = [];
  const skipped: SkippedFile[] = [];
  let used = 0;

  for (const file of files) {
    if (isLockfile(file.path)) {
      skipped.push({ path: file.path, reason: "lockfile" });
      continue;
    }
    const size = annotateDiffFile(file).length;
    if (used + size > maxChars) {
      skipped.push({ path: file.path, reason: "too-large" });
      continue;
    }
    used += size;
    included.push(file);
  }
  return { included, skipped };
}
