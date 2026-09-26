import { describe, expect, it } from "vitest";
import { loadSecrets } from "./secrets.js";

describe("loadSecrets", () => {
  it("returns both secrets when present", () => {
    const secrets = loadSecrets({
      ANTHROPIC_API_KEY: "sk-ant-test",
      GITHUB_TOKEN: "gho_test",
    });
    expect(secrets).toEqual({
      anthropicApiKey: "sk-ant-test",
      githubToken: "gho_test",
    });
  });

  it("fails fast naming exactly which variable is missing", () => {
    expect(() => loadSecrets({ GITHUB_TOKEN: "gho_test" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => loadSecrets({ ANTHROPIC_API_KEY: "sk-ant-test" })).toThrow(
      /GITHUB_TOKEN/,
    );
  });

  it("names both when both are missing", () => {
    expect(() => loadSecrets({})).toThrow(/ANTHROPIC_API_KEY.*GITHUB_TOKEN/s);
  });
});
