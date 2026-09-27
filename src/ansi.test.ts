import { describe, expect, it } from "vitest";
import { paint } from "./ansi.js";

describe("paint", () => {
  // Test runners aren't a TTY, so `paint` should be a passthrough here --
  // this doubles as coverage for the NO_COLOR/non-interactive escape hatch,
  // since that's exactly the environment this test runs in.
  it("returns the text unchanged when not running in an interactive terminal", () => {
    expect(paint("hello", "red", "bold")).toBe("hello");
  });

  it("returns the text unchanged when given no styles", () => {
    expect(paint("hello")).toBe("hello");
  });
});
