import { describe, expect, it } from "vitest";
import { parsePrUrl } from "./prUrl.js";

describe("parsePrUrl", () => {
  it("parses a standard PR URL", () => {
    expect(
      parsePrUrl("https://github.com/skurusamy/pr-review-agent/pull/10"),
    ).toEqual({
      owner: "skurusamy",
      repo: "pr-review-agent",
      prNumber: 10,
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(
      parsePrUrl("  https://github.com/skurusamy/pr-review-agent/pull/10  "),
    ).toEqual({ owner: "skurusamy", repo: "pr-review-agent", prNumber: 10 });
  });

  it("ignores a trailing path like /files", () => {
    expect(
      parsePrUrl("https://github.com/skurusamy/pr-review-agent/pull/10/files"),
    ).toEqual({ owner: "skurusamy", repo: "pr-review-agent", prNumber: 10 });
  });

  it("rejects a non-PR URL", () => {
    expect(() =>
      parsePrUrl("https://github.com/skurusamy/pr-review-agent"),
    ).toThrow(/Couldn't find a PR reference/);
  });

  it("rejects garbage input", () => {
    expect(() => parsePrUrl("not a url at all")).toThrow(
      /Couldn't find a PR reference/,
    );
  });
});
