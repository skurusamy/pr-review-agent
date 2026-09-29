export type DiffLineKind = "hunk" | "add" | "context" | "delete";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line's number in the PR's head version of the file; null for hunk headers and deletions. */
  newLine: number | null;
  /** The text without its leading +/-/space marker (a hunk header keeps its own text). */
  text: string;
}

export interface DiffFile {
  path: string;
  lines: DiffLine[];
}

/**
 * Parses a unified diff into per-file lines with their NEW-side line numbers.
 * Purely mechanical, like parseChangedFiles. It exists for two reasons: the
 * model is shown line numbers it can copy rather than being asked to derive
 * them from hunk headers (which models get wrong), and every Finding's
 * path:line is later checked against exactly this parse to know whether it
 * can be posted as an inline comment.
 *
 * Lines outside a hunk (file markers, mode/rename/binary notices) are
 * ignored, and blank lines inside a hunk are skipped: GitHub keeps the
 * leading space on an empty context line, so a truly empty line is only the
 * split's trailing artifact.
 */
export function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunk = false;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2] as string, lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;

    if (!inHunk && line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length);
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      newLine = Number(hunk[1]);
      current.lines.push({ kind: "hunk", newLine: null, text: line });
      continue;
    }
    if (!inHunk || line === "" || line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      current.lines.push({ kind: "add", newLine, text });
      newLine++;
    } else if (marker === "-") {
      current.lines.push({ kind: "delete", newLine: null, text });
    } else {
      current.lines.push({ kind: "context", newLine, text });
      newLine++;
    }
  }
  return files;
}

/** path -> the new-side line numbers a comment can be anchored to (added or context lines). */
export type AnchorIndex = Map<string, Set<number>>;

export function buildAnchorIndex(files: DiffFile[]): AnchorIndex {
  const index: AnchorIndex = new Map();
  for (const file of files) {
    const lines = new Set<number>();
    for (const l of file.lines) {
      if (l.newLine !== null) lines.add(l.newLine);
    }
    index.set(file.path, lines);
  }
  return index;
}

export function isAnchorable(
  index: AnchorIndex,
  path: string,
  line: number,
): boolean {
  return index.get(path)?.has(line) ?? false;
}

const GUTTER_WIDTH = 5;

/**
 * Renders one file's diff with the new-side line number printed on every
 * line the model may anchor a Finding to, e.g. `   42| +const x = 1;`.
 * Deleted lines get a blank gutter -- they no longer exist in the checkout,
 * so there is nothing to anchor to.
 */
export function annotateDiffFile(file: DiffFile): string {
  const body = file.lines.map((l) => {
    if (l.kind === "hunk") return l.text;
    const gutter =
      l.newLine === null
        ? " ".repeat(GUTTER_WIDTH)
        : String(l.newLine).padStart(GUTTER_WIDTH);
    const marker = l.kind === "add" ? "+" : l.kind === "delete" ? "-" : " ";
    return `${gutter}| ${marker}${l.text}`;
  });
  return [`=== ${file.path} ===`, ...body].join("\n");
}
