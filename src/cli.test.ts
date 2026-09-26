import { describe, expect, it } from "vitest";
import { placeholder } from "./cli.js";

describe("scaffold", () => {
  it("proves the toolchain (tsc, vitest, eslint) runs end to end", () => {
    expect(placeholder()).toBe("pr-review-agent scaffold is wired up");
  });
});
