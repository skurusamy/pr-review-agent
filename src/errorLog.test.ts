import { describe, expect, it } from "vitest";
import { formatError } from "./errorLog.js";

describe("formatError", () => {
  it("returns a plain Error's message", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error thrown value", () => {
    expect(formatError("just a string")).toBe("just a string");
  });

  it("includes the HTTP status when present", () => {
    const error = Object.assign(new Error("Not Found"), { status: 404 });
    expect(formatError(error)).toContain("HTTP status: 404");
  });

  it("includes the request URL when present", () => {
    const error = Object.assign(new Error("Not Found"), {
      request: { url: "https://api.github.com/repos/o/r/pulls/1" },
    });
    expect(formatError(error)).toContain(
      "https://api.github.com/repos/o/r/pulls/1",
    );
  });

  it("includes GitHub's documentation_url when present", () => {
    const error = Object.assign(new Error("Not Found"), {
      response: {
        data: {
          documentation_url:
            "https://docs.github.com/rest/pulls/pulls#get-a-pull-request",
        },
      },
    });
    expect(formatError(error)).toContain("docs.github.com/rest/pulls");
  });

  it("combines status, request url, and docs url together", () => {
    const error = Object.assign(new Error("Not Found"), {
      status: 404,
      request: { url: "https://api.github.com/repos/o/r/pulls/1" },
      response: { data: { documentation_url: "https://docs.github.com/x" } },
    });
    const formatted = formatError(error);
    expect(formatted).toContain("Not Found");
    expect(formatted).toContain("404");
    expect(formatted).toContain("api.github.com");
    expect(formatted).toContain("docs.github.com/x");
  });
});
