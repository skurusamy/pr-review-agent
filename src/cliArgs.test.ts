import { describe, expect, it } from "vitest";
import { parseArgs } from "./cliArgs.js";

describe("parseArgs", () => {
  it("parses a well-formed review command", () => {
    const args = parseArgs(["fix", "skurusamy/pr-review-agent", "10"]);
    expect(args).toEqual({
      command: "fix",
      owner: "skurusamy",
      repo: "pr-review-agent",
      prNumber: 10,
      dryRun: false,
    });
  });

  it("recognizes --dry-run", () => {
    const args = parseArgs([
      "fix",
      "skurusamy/pr-review-agent",
      "10",
      "--dry-run",
    ]);
    expect(args.command).toBe("fix");
    expect(args.command === "fix" && args.dryRun).toBe(true);
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["bogus", "a/b", "1"])).toThrow(/Unknown command/);
  });

  it("parses a well-formed brief command", () => {
    const args = parseArgs(["brief", "skurusamy/pr-review-agent", "10"]);
    expect(args).toEqual({
      command: "brief",
      owner: "skurusamy",
      repo: "pr-review-agent",
      prNumber: 10,
      post: false,
    });
  });

  it("recognizes --post on the brief command", () => {
    const args = parseArgs([
      "brief",
      "skurusamy/pr-review-agent",
      "10",
      "--post",
    ]);
    expect(args.command).toBe("brief");
    expect(args.command === "brief" && args.post).toBe(true);
  });

  it("parses a review command", () => {
    expect(parseArgs(["review", "skurusamy/pr-review-agent", "10"])).toEqual({
      command: "review",
      owner: "skurusamy",
      repo: "pr-review-agent",
      prNumber: 10,
      post: false,
    });
  });

  it("parses --post on a review command", () => {
    const args = parseArgs(["review", "a/b", "3", "--post"]);
    expect(args.command === "review" && args.post).toBe(true);
  });

  it("rejects a review command with a bad owner/repo or PR number", () => {
    expect(() => parseArgs(["review", "notaslash", "1"])).toThrow(
      /owner\/repo/,
    );
    expect(() => parseArgs(["review", "a/b", "0"])).toThrow(
      /positive PR number/,
    );
  });

  it("lists all three commands in the usage text", () => {
    expect(() => parseArgs(["nope"])).toThrow(/brief .*\n.*review .*\n.*fix /);
  });

  it("rejects a brief command with a bad owner/repo", () => {
    expect(() => parseArgs(["brief", "notaslash", "1"])).toThrow(/owner\/repo/);
  });

  it("rejects an owner/repo without a slash", () => {
    expect(() => parseArgs(["fix", "notaslash", "1"])).toThrow(/owner\/repo/);
  });

  it("rejects a non-numeric PR number", () => {
    expect(() => parseArgs(["fix", "a/b", "not-a-number"])).toThrow(
      /positive PR number/,
    );
  });

  it("rejects a zero or negative PR number", () => {
    expect(() => parseArgs(["fix", "a/b", "0"])).toThrow(/positive PR number/);
    expect(() => parseArgs(["fix", "a/b", "-5"])).toThrow(/positive PR number/);
  });
});
