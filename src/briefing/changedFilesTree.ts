export type ChangedFileStatus = "added" | "removed" | "modified" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  renamedFrom?: string;
}

/**
 * Parses a unified diff into a per-file change list -- purely mechanical
 * (file paths, +/- line counts, add/remove/rename), so this never touches
 * the model. The Mermaid diagram is the part of a Briefing that actually
 * needs LLM judgment; this is the cheap half.
 */
export function parseChangedFiles(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;

  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      if (current) files.push(current);
      // Both capture groups are mandatory in the pattern, so a match
      // guarantees they're present -- the cast just states that to TS.
      current = {
        path: header[2] as string,
        status: "modified",
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith("new file mode")) {
      current.status = "added";
    } else if (line.startsWith("deleted file mode")) {
      current.status = "removed";
    } else if (line.startsWith("rename from ")) {
      current.renamedFrom = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = line.slice("rename to ".length);
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      // File-marker lines, not content -- must be checked before the bare
      // +/- content counters below, since they also start with +/-.
      continue;
    } else if (line.startsWith("+")) {
      current.additions++;
    } else if (line.startsWith("-")) {
      current.deletions++;
    }
  }
  if (current) files.push(current);

  return files;
}

const STATUS_MARKER: Record<ChangedFileStatus, string> = {
  added: "+",
  removed: "-",
  modified: "~",
  renamed: "→",
};

export function formatChangedFilesTree(files: ChangedFile[]): string {
  if (files.length === 0) {
    return "(no files changed)";
  }
  return files
    .map((f) => {
      const label =
        f.status === "renamed" && f.renamedFrom
          ? `${f.renamedFrom} → ${f.path}`
          : f.path;
      return `${STATUS_MARKER[f.status]} ${label} (+${f.additions} -${f.deletions})`;
    })
    .join("\n");
}
