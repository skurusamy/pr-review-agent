import { describe, expect, it } from "vitest";
import { formatToolUse } from "./toolLog.js";

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
