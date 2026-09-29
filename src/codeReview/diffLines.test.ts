import { describe, expect, it } from "vitest";
import {
  annotateDiffFile,
  buildAnchorIndex,
  isAnchorable,
  parseDiffFiles,
} from "./diffLines.js";

// Two hunks in one file: the first adds and deletes, the second starts far
// below, so new-side numbering has to restart from the hunk header.
const DIFF = `diff --git a/src/page.ts b/src/page.ts
index 111..222 100644
--- a/src/page.ts
+++ b/src/page.ts
@@ -10,4 +10,5 @@ export function page() {
   const a = 1;
-  const b = 2;
+  const b = 3;
+  const c = 4;
   return a;
@@ -40,3 +41,3 @@ function other() {
   x();
-  y();
+  z();
   w();
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const n = 1;
+export const m = 2;
`;

describe("parseDiffFiles", () => {
  const files = parseDiffFiles(DIFF);

  it("finds each file", () => {
    expect(files.map((f) => f.path)).toEqual(["src/page.ts", "src/new.ts"]);
  });

  it("numbers added and context lines from the hunk header, skipping deletions", () => {
    const numbered = files[0]!.lines
      .filter((l) => l.kind !== "hunk")
      .map((l) => [l.kind, l.newLine, l.text]);
    expect(numbered).toEqual([
      ["context", 10, "  const a = 1;"],
      ["delete", null, "  const b = 2;"],
      ["add", 11, "  const b = 3;"],
      ["add", 12, "  const c = 4;"],
      ["context", 13, "  return a;"],
      ["context", 41, "  x();"],
      ["delete", null, "  y();"],
      ["add", 42, "  z();"],
      ["context", 43, "  w();"],
    ]);
  });

  it("numbers a new file from 1", () => {
    const adds = files[1]!.lines.filter((l) => l.kind === "add");
    expect(adds.map((l) => l.newLine)).toEqual([1, 2]);
  });

  it("does not count the +++/--- file markers as content", () => {
    const all = files.flatMap((f) => f.lines.map((l) => l.text));
    expect(
      all.some((t) => t.startsWith("++ b/") || t === "-- a/src/page.ts"),
    ).toBe(false);
  });

  it("keeps a content line that itself starts with +++ inside a hunk", () => {
    const diff = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,2 @@
 keep
+++ not a marker
`;
    const lines = parseDiffFiles(diff)[0]!.lines.filter(
      (l) => l.kind === "add",
    );
    expect(lines).toEqual([
      { kind: "add", newLine: 2, text: "++ not a marker" },
    ]);
  });

  it("ignores the no-newline notice", () => {
    const diff = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const kinds = parseDiffFiles(diff)[0]!.lines.map((l) => l.kind);
    expect(kinds).toEqual(["hunk", "delete", "add"]);
  });

  it("uses the new path for a rename", () => {
    const diff = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,1 +1,1 @@
-a
+b
`;
    expect(parseDiffFiles(diff)[0]!.path).toBe("new.ts");
  });

  it("returns nothing for an empty diff", () => {
    expect(parseDiffFiles("")).toEqual([]);
  });
});

describe("anchor index", () => {
  const index = buildAnchorIndex(parseDiffFiles(DIFF));

  it("accepts added and context lines", () => {
    expect(isAnchorable(index, "src/page.ts", 10)).toBe(true);
    expect(isAnchorable(index, "src/page.ts", 12)).toBe(true);
    expect(isAnchorable(index, "src/page.ts", 43)).toBe(true);
  });

  it("rejects a line between hunks, past the last hunk, and in an unknown file", () => {
    expect(isAnchorable(index, "src/page.ts", 20)).toBe(false);
    expect(isAnchorable(index, "src/page.ts", 44)).toBe(false);
    expect(isAnchorable(index, "src/nope.ts", 1)).toBe(false);
  });
});

describe("annotateDiffFile", () => {
  it("prints the new-side number on kept lines and a blank gutter on deletions", () => {
    const text = annotateDiffFile(parseDiffFiles(DIFF)[0]!);
    expect(text).toContain("=== src/page.ts ===");
    expect(text).toContain("   11| +  const b = 3;");
    expect(text).toContain("   10|    const a = 1;");
    expect(text).toContain("     | -  const b = 2;");
    expect(text).toContain("@@ -40,3 +41,3 @@ function other() {");
  });
});
