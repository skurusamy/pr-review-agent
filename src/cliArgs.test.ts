import { describe, expect, it } from "vitest";
import { parseArgs } from "./cliArgs.js";

describe("parseArgs", () => {
  it("parses a well-formed review command", () => {
    const args = parseArgs(["review", "skurusamy/pr-review-agent", "10"]);
    expect(args).toEqual({
      command: "review",
      owner: "skurusamy",
      repo: "pr-review-agent",
      prNumber: 10,
      dryRun: false,
    });
  });

  it("recognizes --dry-run", () => {
    const args = parseArgs([
      "review",
      "skurusamy/pr-review-agent",
      "10",
      "--dry-run",
    ]);
    expect(args.dryRun).toBe(true);
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["bogus", "a/b", "1"])).toThrow(/Unknown command/);
  });

  it("rejects an owner/repo without a slash", () => {
    expect(() => parseArgs(["review", "notaslash", "1"])).toThrow(
      /owner\/repo/,
    );
  });

  it("rejects a non-numeric PR number", () => {
    expect(() => parseArgs(["review", "a/b", "not-a-number"])).toThrow(
      /positive PR number/,
    );
  });

  it("rejects a zero or negative PR number", () => {
    expect(() => parseArgs(["review", "a/b", "0"])).toThrow(
      /positive PR number/,
    );
    expect(() => parseArgs(["review", "a/b", "-5"])).toThrow(
      /positive PR number/,
    );
  });
});
