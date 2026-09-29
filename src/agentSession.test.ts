import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  ApiKeyRejectedError,
  isMaxTurnsError,
  lockedDown,
  sessionEnv,
  watchApiHealth,
} from "./agentSession.js";

describe("sessionEnv", () => {
  it("removes the GitHub token and keeps everything else", () => {
    const env = sessionEnv({
      GITHUB_TOKEN: "ghp_secret",
      ANTHROPIC_API_KEY: "sk-ant-x",
      PATH: "/usr/bin",
    });
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-x", PATH: "/usr/bin" });
  });

  it("does not mutate the environment it was given", () => {
    const original = { GITHUB_TOKEN: "ghp_secret", PATH: "/usr/bin" };
    sessionEnv(original);
    expect(original.GITHUB_TOKEN).toBe("ghp_secret");
  });
});

describe("lockedDown", () => {
  const opts = lockedDown(["Read", "Grep"], {
    GITHUB_TOKEN: "ghp_secret",
    PATH: "/usr/bin",
  });

  it("lists exactly the given built-in tools", () => {
    expect(opts.tools).toEqual(["Read", "Grep"]);
  });

  it("loads no settings from anywhere", () => {
    expect(opts.settingSources).toEqual([]);
  });

  it("scrubs the token from the session environment", () => {
    expect(opts.env).toEqual({ PATH: "/usr/bin" });
  });

  it("an empty tool list means no built-in tools at all", () => {
    expect(lockedDown([], {}).tools).toEqual([]);
  });
});

describe("isMaxTurnsError", () => {
  it("recognises the SDK's turn-limit error and nothing else", () => {
    expect(
      isMaxTurnsError(
        new Error(
          "Claude Code returned an error result: Reached maximum number of turns (24)",
        ),
      ),
    ).toBe(true);
    expect(isMaxTurnsError(new Error("network down"))).toBe(false);
    expect(isMaxTurnsError("Reached maximum number of turns")).toBe(false);
  });
});

describe("watchApiHealth", () => {
  const retry = (over: Record<string, unknown> = {}) =>
    ({
      type: "system",
      subtype: "api_retry",
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 8000,
      error_status: 529,
      error: "overloaded",
      ...over,
    }) as unknown as SDKMessage;

  it("turns a retry into a visible warning line", () => {
    const lines: string[] = [];
    watchApiHealth(retry(), (l) => lines.push(l));
    expect(lines).toEqual([
      "Warning: API error 529 (overloaded); retry 3 of 10 in 8s",
    ]);
  });

  it("stops at once when the API key is rejected", () => {
    expect(() =>
      watchApiHealth(
        retry({ error: "authentication_failed", error_status: 401 }),
        () => {},
      ),
    ).toThrow(ApiKeyRejectedError);
    expect(() =>
      watchApiHealth(
        {
          type: "assistant",
          error: "authentication_failed",
        } as unknown as SDKMessage,
        () => {},
      ),
    ).toThrow(/API key was rejected/);
  });

  it("ignores every other message", () => {
    const lines: string[] = [];
    watchApiHealth({ type: "user" } as unknown as SDKMessage, (l) =>
      lines.push(l),
    );
    expect(lines).toEqual([]);
  });
});
