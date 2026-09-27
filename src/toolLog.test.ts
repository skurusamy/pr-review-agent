import { describe, expect, it } from "vitest";
import { formatToolUse, formatThinking, isNoiseTool } from "./toolLog.js";

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

  it("strips the checkout dir prefix from a path, given one", () => {
    const line = formatToolUse(
      "Read",
      {
        file_path: "/private/var/folders/xyz/pr-review-agent-abc123/README.md",
      },
      "/private/var/folders/xyz/pr-review-agent-abc123",
    );
    expect(line).toContain("README.md");
    expect(line).not.toContain("/private/var/folders");
  });

  it("leaves the path untouched when no checkoutDir is given", () => {
    const line = formatToolUse("Read", {
      file_path: "/tmp/somewhere/README.md",
    });
    expect(line).toContain("/tmp/somewhere/README.md");
  });

  it("does not mangle a path where checkoutDir is only a substring, not a prefix (macOS /var -> /private/var)", () => {
    // Reproduces a real bug: os.tmpdir() on macOS returns an unresolved
    // /var/... path, but a tool reports the resolved /private/var/...
    // form. A naive global-substring strip found checkoutDir sitting in
    // the MIDDLE of the real path and cut it out, leaving "/privateREADME.md".
    const checkoutDir = "/var/folders/xyz/pr-review-agent-abc123";
    const line = formatToolUse(
      "Read",
      {
        file_path: "/private/var/folders/xyz/pr-review-agent-abc123/README.md",
      },
      checkoutDir,
    );
    expect(line).not.toContain("/privateREADME.md");
    expect(line).toContain(
      "/private/var/folders/xyz/pr-review-agent-abc123/README.md",
    );
  });
});

describe("isNoiseTool", () => {
  it("flags ToolSearch as noise", () => {
    expect(isNoiseTool("ToolSearch")).toBe(true);
  });

  it("does not flag real investigation tools", () => {
    expect(isNoiseTool("Read")).toBe(false);
    expect(isNoiseTool("Edit")).toBe(false);
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
