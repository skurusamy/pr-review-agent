import { describe, expect, it } from "vitest";
import { formatToolUse, formatThinking } from "./toolLog.js";

describe("formatToolUse", () => {
  it("includes the tool name and its input", () => {
    const line = formatToolUse("Read", { file_path: "src/index.ts" });
    expect(line).toContain("Read");
    expect(line).toContain("src/index.ts");
  });

  it("truncates a very long input", () => {
    const longInput = { old_string: "x".repeat(500), new_string: "y" };
    const line = formatToolUse("Edit", longInput);
    expect(line.length).toBeLessThan(250);
    expect(line).toContain("...");
  });
});

describe("formatThinking", () => {
  it("includes the reasoning text", () => {
    expect(formatThinking("This looks like a real off-by-one bug.")).toContain(
      "off-by-one",
    );
  });

  it("truncates very long reasoning", () => {
    const line = formatThinking("x".repeat(1000));
    expect(line.length).toBeLessThan(450);
    expect(line).toContain("...");
  });

  it("does not truncate short reasoning", () => {
    const line = formatThinking("short thought");
    expect(line).not.toContain("...");
  });
});
