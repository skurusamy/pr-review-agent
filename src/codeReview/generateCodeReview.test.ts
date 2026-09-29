import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  CodeReviewIncompleteError,
  generateCodeReview,
  isMaxTurnsError,
} from "./generateReview.js";
import type { PrContext } from "../briefing/fetchPrContext.js";

// Only query() is faked; tool() and createSdkMcpServer() stay real so the
// module under test builds its tools exactly as it does in production.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: vi.fn(),
}));

const DIFF = `diff --git a/src/page.ts b/src/page.ts
--- a/src/page.ts
+++ b/src/page.ts
@@ -10,2 +10,3 @@
 a
+b
 c
`;

const context: PrContext = {
  title: "T",
  description: "D",
  comments: [],
  diff: DIFF,
};

const maxTurns = () =>
  new Error(
    "Claude Code returned an error result: Reached maximum number of turns (24)",
  );

function submit(input: unknown, sessionId = "sess-1") {
  return {
    type: "assistant",
    session_id: sessionId,
    message: {
      content: [
        {
          type: "tool_use",
          name: "mcp__review-tools__submit_review",
          input,
        },
      ],
    },
  };
}

const investigate = (sessionId = "sess-1") => ({
  type: "assistant",
  session_id: sessionId,
  message: {
    content: [
      { type: "tool_use", name: "Read", input: { file_path: "src/page.ts" } },
    ],
  },
});

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

const goodReview = {
  assessment: "Looks fine.",
  findings: [
    {
      path: "src/page.ts",
      line: 11,
      severity: "high",
      category: "correctness",
      title: "Bug",
      explanation: "Because.",
    },
    {
      path: "src/page.ts",
      line: 99,
      severity: "low",
      category: "tests",
      title: "Elsewhere",
      explanation: "Off the diff.",
    },
  ],
};

const run = () => generateCodeReview(context, "/tmp/checkout", () => {});

beforeEach(() => vi.mocked(query).mockReset());

describe("isMaxTurnsError", () => {
  it("recognises the SDK's turn-limit error and nothing else", () => {
    expect(isMaxTurnsError(maxTurns())).toBe(true);
    expect(isMaxTurnsError(new Error("network down"))).toBe(false);
    expect(isMaxTurnsError("Reached maximum number of turns")).toBe(false);
  });
});

describe("generateCodeReview", () => {
  it("returns the submitted review, split into anchored and unanchored findings", async () => {
    fakeQueries([investigate(), submit(goodReview)]);
    const review = await run();
    expect(review.assessment).toBe("Looks fine.");
    expect(review.findings.map((f) => f.title)).toEqual(["Bug"]);
    expect(review.unanchored.map((f) => f.title)).toEqual(["Elsewhere"]);
    expect(review.changedFiles.map((f) => f.path)).toEqual(["src/page.ts"]);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed submission and accepts a later valid one", async () => {
    fakeQueries([submit({ assessment: 5 }), submit(goodReview)]);
    const review = await run();
    expect(review.assessment).toBe("Looks fine.");
  });

  it("on running out of turns, resumes the same session and returns what it submits", async () => {
    fakeQueries(
      [investigate("sess-9"), maxTurns()],
      [submit(goodReview, "sess-9")],
    );
    const review = await run();
    expect(review.findings).toHaveLength(1);

    const calls = vi.mocked(query).mock.calls;
    expect(calls).toHaveLength(2);
    const resumed = calls[1]![0] as {
      prompt: string;
      options: { resume?: string; maxTurns?: number };
    };
    expect(resumed.options.resume).toBe("sess-9");
    expect(resumed.options.maxTurns).toBe(3);
    expect(resumed.prompt).toContain("submit_review");
  });

  it("gives up with CodeReviewIncompleteError if it still won't submit when asked", async () => {
    fakeQueries([investigate(), maxTurns()], [investigate(), maxTurns()]);
    await expect(run()).rejects.toBeInstanceOf(CodeReviewIncompleteError);
  });

  it("gives up if the stream ends without ever submitting", async () => {
    fakeQueries([investigate()], [investigate()]);
    await expect(run()).rejects.toBeInstanceOf(CodeReviewIncompleteError);
  });

  it("does not swallow an unrelated error, and does not resume", async () => {
    fakeQueries([investigate(), new Error("network down")]);
    await expect(run()).rejects.toThrow("network down");
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });

  it("does not resume when no session was ever started", async () => {
    fakeQueries([maxTurns()]);
    await expect(run()).rejects.toThrow("maximum number of turns");
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });
});
