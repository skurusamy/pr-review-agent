import { describe, expect, it } from "vitest";
import {
  parseChangedFiles,
  formatChangedFilesTree,
} from "./changedFilesTree.js";

const MODIFIED_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
-const c = 3;
 export { a };
`;

const ADDED_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

const REMOVED_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc123..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1;
-export const y = 2;
`;

const RENAMED_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
`;

describe("parseChangedFiles", () => {
  it("parses a modified file with correct add/delete counts", () => {
    const files = parseChangedFiles(MODIFIED_DIFF);
    expect(files).toEqual([
      { path: "src/foo.ts", status: "modified", additions: 1, deletions: 1 },
    ]);
  });

  it("does not count the +++/--- file marker lines as content changes", () => {
    const files = parseChangedFiles(MODIFIED_DIFF);
    expect(files[0]?.additions).toBe(1);
    expect(files[0]?.deletions).toBe(1);
  });

  it("marks a new file as added", () => {
    const files = parseChangedFiles(ADDED_DIFF);
    expect(files).toEqual([
      { path: "src/new.ts", status: "added", additions: 2, deletions: 0 },
    ]);
  });

  it("marks a deleted file as removed", () => {
    const files = parseChangedFiles(REMOVED_DIFF);
    expect(files).toEqual([
      { path: "src/old.ts", status: "removed", additions: 0, deletions: 2 },
    ]);
  });

  it("tracks a rename with its original path", () => {
    const files = parseChangedFiles(RENAMED_DIFF);
    expect(files).toEqual([
      {
        path: "src/new-name.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        renamedFrom: "src/old-name.ts",
      },
    ]);
  });

  it("parses multiple files in one diff", () => {
    const files = parseChangedFiles(MODIFIED_DIFF + ADDED_DIFF);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toEqual(["src/foo.ts", "src/new.ts"]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(parseChangedFiles("")).toEqual([]);
  });
});

describe("formatChangedFilesTree", () => {
  it("formats a modified file with its stats", () => {
    const tree = formatChangedFilesTree(parseChangedFiles(MODIFIED_DIFF));
    expect(tree).toBe("~ src/foo.ts (+1 -1)");
  });

  it("formats an added file", () => {
    const tree = formatChangedFilesTree(parseChangedFiles(ADDED_DIFF));
    expect(tree).toBe("+ src/new.ts (+2 -0)");
  });

  it("formats a removed file", () => {
    const tree = formatChangedFilesTree(parseChangedFiles(REMOVED_DIFF));
    expect(tree).toBe("- src/old.ts (+0 -2)");
  });

  it("formats a rename showing old and new paths", () => {
    const tree = formatChangedFilesTree(parseChangedFiles(RENAMED_DIFF));
    expect(tree).toBe("→ src/old-name.ts → src/new-name.ts (+0 -0)");
  });

  it("reports no files changed for an empty list", () => {
    expect(formatChangedFilesTree([])).toBe("(no files changed)");
  });
});
