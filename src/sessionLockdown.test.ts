import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import {
  BriefingIncompleteError,
  buildBriefingQueryOptions,
  generateBriefing,
} from "./briefing/generateBriefing.js";
import {
  buildVerdictQueryOptions,
  reachVerdict,
  VerdictIncompleteError,
} from "./verdict/reachVerdict.js";
import { attemptFix, buildFixQueryOptions } from "./fix/attemptFix.js";
import type { PrContext } from "./briefing/fetchPrContext.js";
import type { ReviewThread } from "./github/types.js";

// Only query() is faked; tool() and createSdkMcpServer() stay real so each
// module builds its tools exactly as in production.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: vi.fn(),
}));

const ENV = { GITHUB_TOKEN: "ghp_secret", ANTHROPIC_API_KEY: "sk-ant-x" };
const server = createSdkMcpServer({ name: "s", tools: [] });

const maxTurns = () =>
  new Error(
    "Claude Code returned an error result: Reached maximum number of turns (4)",
  );

/** A fake SDK stream: yields each item, and throws any Error it meets. */
async function* stream(items: unknown[]) {
  for (const item of items) {
    if (item instanceof Error) throw item;
    yield item;
  }
}

function fakeQueries(...streams: unknown[][]): void {
  const mock = vi.mocked(query);
  mock.mockReset();
  for (const items of streams) {
    mock.mockImplementationOnce((() => stream(items)) as never);
  }
}

const toolUse = (name: string, input: unknown, sessionId = "sess-1") => ({
  type: "assistant",
  session_id: sessionId,
  message: { content: [{ type: "tool_use", name, input }] },
});

beforeEach(() => vi.mocked(query).mockReset());

// ---------------------------------------------------------------- Briefing --
describe("Briefing session", () => {
  const options = buildBriefingQueryOptions(server, undefined, ENV);

  it("has no built-in tools at all, only its answer tool", () => {
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual([
      "mcp__briefing-tools__submit_briefing",
    ]);
  });

  it("loads no settings and keeps the GitHub token out of its environment", () => {
    expect(options.settingSources).toEqual([]);
    expect(options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(options.env).toMatchObject({ ANTHROPIC_API_KEY: "sk-ant-x" });
  });

  it("runs in the temp directory, not the app's own working directory", () => {
    expect(options.cwd).toBe(tmpdir());
    expect(options.cwd).not.toBe(process.cwd());
  });

  it("passes an abort controller through when given", () => {
    const controller = new AbortController();
    expect(buildBriefingQueryOptions(server, controller).abortController).toBe(
      controller,
    );
    expect(options.abortController).toBeUndefined();
  });

  const context: PrContext = {
    title: "T",
    description: "D",
    comments: [],
    diff: "diff --git a/a b/a\n+x\n",
    headSha: "abc1234",
  };
  const submit = {
    summary: "s",
    mermaidDiagram: "flowchart TB\nA-->B",
    risks: ["r"],
  };

  it("returns the submitted briefing", async () => {
    fakeQueries([toolUse("mcp__briefing-tools__submit_briefing", submit)]);
    const briefing = await generateBriefing(context, () => {});
    expect(briefing.summary).toBe("s");
  });

  it("turns the SDK's turn-limit error into BriefingIncompleteError", async () => {
    fakeQueries([maxTurns()]);
    await expect(generateBriefing(context, () => {})).rejects.toBeInstanceOf(
      BriefingIncompleteError,
    );
  });

  it("does not swallow an unrelated error", async () => {
    fakeQueries([new Error("network down")]);
    await expect(generateBriefing(context, () => {})).rejects.toThrow(
      "network down",
    );
  });
});

// ----------------------------------------------------------------- Verdict --
const thread: ReviewThread = {
  rootComment: {
    id: 7,
    path: "src/a.ts",
    line: 3,
    originalLine: 3,
    diffHunk: "@@",
    body: "this looks wrong",
    author: "sam",
    createdAt: "2026-01-01",
    htmlUrl: "https://github.com/a/b/pull/1#discussion_r7",
    outdated: false,
  },
  replies: [],
};

describe("Verdict session", () => {
  const options = buildVerdictQueryOptions("/tmp/co", server, undefined, ENV);

  it("may only read: Read, Grep and Glob exist, nothing else", () => {
    expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(options.allowedTools).toEqual([
      "Read",
      "Grep",
      "Glob",
      "mcp__verdict-tools__submit_verdict",
    ]);
    expect(options.tools).not.toContain("Bash");
    expect(options.tools).not.toContain("Edit");
  });

  it("loads no settings from the checkout and scrubs the token", () => {
    expect(options.settingSources).toEqual([]);
    expect(options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(options.cwd).toBe("/tmp/co");
  });

  it("returns the submitted verdict", async () => {
    fakeQueries([
      toolUse("mcp__verdict-tools__submit_verdict", {
        verdict: "bug",
        reasoning: "because",
      }),
    ]);
    expect(await reachVerdict("/tmp/co", thread, () => {})).toEqual({
      verdict: "bug",
      reasoning: "because",
    });
  });

  it("turns the SDK's turn-limit error into VerdictIncompleteError, so the run skips the comment", async () => {
    fakeQueries([maxTurns()]);
    await expect(
      reachVerdict("/tmp/co", thread, () => {}),
    ).rejects.toBeInstanceOf(VerdictIncompleteError);
  });

  it("does not swallow an unrelated error", async () => {
    fakeQueries([new Error("network down")]);
    await expect(reachVerdict("/tmp/co", thread, () => {})).rejects.toThrow(
      "network down",
    );
  });
});

// ------------------------------------------------------------- Fix Attempt --
describe("Fix Attempt session", () => {
  it("may read and make targeted edits: no Write, no Bash", () => {
    const options = buildFixQueryOptions(
      "/tmp/co",
      server,
      undefined,
      undefined,
      ENV,
    );
    expect(options.tools).toEqual(["Read", "Grep", "Glob", "Edit"]);
    expect(options.allowedTools).toEqual([
      "Read",
      "Grep",
      "Glob",
      "Edit",
      "mcp__fix-tools__submit_fix",
    ]);
    expect(options.tools).not.toContain("Bash");
    expect(options.tools).not.toContain("Write");
    expect(options.permissionMode).toBe("acceptEdits");
  });

  it("loads no settings from the checkout and scrubs the token", () => {
    const options = buildFixQueryOptions(
      "/tmp/co",
      server,
      undefined,
      undefined,
      ENV,
    );
    expect(options.settingSources).toEqual([]);
    expect(options.env).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("resumes a session when given one", () => {
    expect(
      buildFixQueryOptions("/tmp/co", server, "sess-9", undefined, ENV).resume,
    ).toBe("sess-9");
    expect(
      buildFixQueryOptions("/tmp/co", server, undefined, undefined, ENV),
    ).not.toHaveProperty("resume");
  });

  // A real repo with no npm scripts (so the Validation Gate passes) in which
  // the fake model "edits" a file.
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fix-test-"));
    const git = simpleGit(dir);
    await git.init(false, ["--initial-branch=main"]);
    await git.addConfig("user.name", "t");
    await git.addConfig("user.email", "t@t");
    await writeFile(join(dir, "package.json"), '{"scripts":{}}');
    await writeFile(join(dir, "a.txt"), "one\n");
    await git.add(".");
    await git.commit("base");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const verdict = { verdict: "bug" as const, reasoning: "r" };

  it("on running out of turns, resumes the same session and asks it to wrap up", async () => {
    const mock = vi.mocked(query);
    mock.mockReset();
    // Attempt 1: some work, then the turn limit.
    mock.mockImplementationOnce((() =>
      stream([
        toolUse("Read", { file_path: "a.txt" }, "sess-9"),
        maxTurns(),
      ])) as never);
    // Attempt 2 (resumed): the model makes its edit and submits.
    mock.mockImplementationOnce((() =>
      (async function* () {
        await writeFile(join(dir, "a.txt"), "ONE\n");
        yield toolUse(
          "mcp__fix-tools__submit_fix",
          { summary: "uppercase it" },
          "sess-9",
        );
      })()) as never);

    const push = vi.fn().mockResolvedValue(undefined);
    const result = await attemptFix(
      dir,
      thread,
      verdict,
      false,
      () => {},
      undefined,
      push,
    );

    expect(result).toMatchObject({ outcome: "fixed", attempts: 2 });
    const second = mock.mock.calls[1]![0] as {
      prompt: string;
      options: { resume?: string };
    };
    expect(second.options.resume).toBe("sess-9");
    expect(second.prompt).toContain("submit_fix");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("pushes through the given function, and not at all in a dry run", async () => {
    const run = async (dryRun: boolean) => {
      await writeFile(join(dir, "a.txt"), dryRun ? "dry\n" : "wet\n");
      vi.mocked(query).mockReset();
      vi.mocked(query).mockImplementationOnce((() =>
        stream([
          toolUse("mcp__fix-tools__submit_fix", { summary: "s" }),
        ])) as never);
      const push = vi.fn().mockResolvedValue(undefined);
      await attemptFix(dir, thread, verdict, dryRun, () => {}, undefined, push);
      return push;
    };
    expect(await run(true)).not.toHaveBeenCalled();
    expect(await run(false)).toHaveBeenCalledTimes(1);
  });

  it("does not swallow an unrelated error", async () => {
    fakeQueries([new Error("network down")]);
    await expect(
      attemptFix(dir, thread, verdict, true, () => {}),
    ).rejects.toThrow("network down");
  });
});
