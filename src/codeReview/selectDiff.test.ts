import { describe, expect, it } from "vitest";
import { annotateDiffFile, type DiffFile } from "./diffLines.js";
import { selectDiffForReview } from "./selectDiff.js";

function file(path: string, lineCount = 1): DiffFile {
  return {
    path,
    lines: Array.from({ length: lineCount }, (_, i) => ({
      kind: "add" as const,
      newLine: i + 1,
      text: "x".repeat(50),
    })),
  };
}

describe("selectDiffForReview", () => {
  it("includes everything that fits", () => {
    const result = selectDiffForReview([file("a.ts"), file("b.ts")]);
    expect(result.included.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips lockfiles anywhere in the tree", () => {
    const result = selectDiffForReview([
      file("package-lock.json"),
      file("packages/x/yarn.lock"),
      file("src/a.ts"),
    ]);
    expect(result.included.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(result.skipped).toEqual([
      { path: "package-lock.json", reason: "lockfile" },
      { path: "packages/x/yarn.lock", reason: "lockfile" },
    ]);
  });

  it("skips a file that would blow the budget but keeps smaller ones after it", () => {
    const big = file("big.ts", 100);
    const small = file("small.ts");
    const budget = annotateDiffFile(small).length + 10;
    const result = selectDiffForReview([big, small], budget);
    expect(result.included.map((f) => f.path)).toEqual(["small.ts"]);
    expect(result.skipped).toEqual([{ path: "big.ts", reason: "too-large" }]);
  });
});
