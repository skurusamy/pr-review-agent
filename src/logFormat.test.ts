import { describe, expect, it } from "vitest";
import { classifyLogLine } from "./logFormat.js";

describe("classifyLogLine", () => {
  it("classifies a thinking line", () => {
    expect(classifyLogLine("  [thinking] Checking the file for context.")).toBe(
      "thinking",
    );
  });

  it("classifies a tool line", () => {
    expect(classifyLogLine('  [tool] Read {"file_path":"README.md"}')).toBe(
      "tool",
    );
  });

  it("classifies a bug verdict", () => {
    expect(
      classifyLogLine("Verdict: bug -- off-by-one in the loop bound."),
    ).toBe("verdict-bug");
  });

  it("classifies a not-a-bug verdict", () => {
    expect(classifyLogLine("Verdict: not-a-bug -- this is a style nit.")).toBe(
      "verdict-not-bug",
    );
  });

  it("classifies a thread section header", () => {
    expect(
      classifyLogLine("\n--- README.md:24 (https://github.com/...) ---"),
    ).toBe("section");
  });

  it("classifies a pushed commit as success", () => {
    expect(classifyLogLine("Pushed commit abc123: fixed the bug")).toBe(
      "success",
    );
  });

  it("classifies a dry-run push as success", () => {
    expect(
      classifyLogLine("[dry-run] Would push commit abc123: fixed the bug"),
    ).toBe("success");
  });

  it("classifies a created pending review as success", () => {
    expect(
      classifyLogLine("\nCreated a pending review (id 1) with 2 comment(s)."),
    ).toBe("success");
  });

  it("classifies an exhausted fix attempt as a warning", () => {
    expect(
      classifyLogLine(
        "Fix Attempt exhausted after 3 attempts (lint); falling back to a draft reply.",
      ),
    ).toBe("warn");
  });

  it("classifies an incomplete verdict as a warning", () => {
    expect(
      classifyLogLine(
        "Could not reach a verdict: exhausted 8 turns. Skipping.",
      ),
    ).toBe("warn");
  });

  it("classifies an existing pending review conflict as a warning", () => {
    expect(
      classifyLogLine(
        "\nCould not create a pending review: one already exists.",
      ),
    ).toBe("warn");
  });

  it("classifies everything else as info", () => {
    expect(
      classifyLogLine("Fetching review comments for owner/repo#1..."),
    ).toBe("info");
    expect(classifyLogLine("Not a bug; drafting a reply.")).toBe("info");
    expect(classifyLogLine("  - README.md:24")).toBe("info");
  });
});
