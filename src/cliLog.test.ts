import { describe, expect, it } from "vitest";
import { colorizeLine } from "./cliLog.js";

describe("colorizeLine", () => {
  // Not a TTY in the test runner, so `paint` is a passthrough (see
  // ansi.test.ts) -- this test is really about colorizeLine covering every
  // LogLineKind without throwing, not about the escape codes themselves.
  it("returns each kind of line unchanged", () => {
    const lines = [
      "  [thinking] reasoning",
      '  [tool] Read {"file_path":"x"}',
      "Verdict: bug -- reason",
      "Verdict: not-a-bug -- reason",
      "\n--- README.md:1 (url) ---",
      "Pushed commit abc: summary",
      "Fix Attempt exhausted after 3 attempts (lint); falling back.",
      "Fetching review comments for owner/repo#1...",
    ];

    for (const line of lines) {
      expect(colorizeLine(line)).toBe(line);
    }
  });
});
