import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PrContext } from "../briefing/fetchPrContext.js";
import type { CodeReview, Finding } from "./generateReview.js";
import {
  buildCheckPrompt,
  buildCheckQueryOptions,
  markUnchecked,
  parseCheckInput,
  verifyFinding,
  verifyFindings,
} from "./verifyFindings.js";
import { postsInline, type Verification } from "./verification.js";

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
  title: "Add page",
  description: "Adds the page.",
  comments: [],
  diff: DIFF,
  headSha: "abc1234",
};

const finding = (over: Partial<Finding> = {}): Finding => ({
  path: "src/page.ts",
  line: 11,
  severity: "medium",
  category: "correctness",
  title: "Missing guard",
  explanation: "Crashes on an empty list.",
  ...over,
});

const review = (
  findings: Finding[],
  unanchored: Finding[] = [],
): CodeReview => ({
  assessment: "ok",
  findings,
  unanchored,
  skippedFiles: [],
  changedFiles: [],
  linkedIssues: [],
});

const quiet = () => {};

describe("verifyFindings", () => {
  it("attaches the check's answer to every finding", async () => {
    const out = await verifyFindings(
      review([finding({ title: "A" })], [finding({ title: "B", line: 99 })]),
      async (f) => ({ status: "confirmed", evidence: `ok ${f.title}` }),
      { log: quiet },
    );
    expect(out.findings[0]?.verification).toEqual({
      status: "confirmed",
      evidence: "ok A",
    });
    expect(out.unanchored[0]?.verification?.evidence).toBe("ok B");
  });

  it("checks the most severe findings first and leaves the rest unchecked, none dropped", async () => {
    const seen: string[] = [];
    const out = await verifyFindings(
      review([
        finding({ title: "low", severity: "low" }),
        finding({ title: "high", severity: "high" }),
        finding({ title: "medium", severity: "medium" }),
      ]),
      async (f) => {
        seen.push(f.title);
        return { status: "confirmed", evidence: "x" };
      },
      { limit: 2, concurrency: 1, log: quiet },
    );
    expect(seen).toEqual(["high", "medium"]);
    expect(out.findings).toHaveLength(3);
    expect(out.findings.map((f) => f.verification?.status)).toEqual([
      "unchecked",
      "confirmed",
      "confirmed",
    ]);
  });

  it("does not run more checks at once than the concurrency limit", async () => {
    let running = 0;
    let peak = 0;
    await verifyFindings(
      review(Array.from({ length: 6 }, (_, i) => finding({ line: i + 1 }))),
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return { status: "unsure", evidence: "x" };
      },
      { concurrency: 2, log: quiet },
    );
    expect(peak).toBe(2);
  });

  it("starts no sessions when there is nothing to check", async () => {
    const check = vi.fn();
    const r = review([]);
    expect(await verifyFindings(r, check, { log: quiet })).toBe(r);
    expect(check).not.toHaveBeenCalled();
  });

  it("propagates a failure and stops starting new checks", async () => {
    const check = vi
      .fn<(f: Finding) => Promise<Verification>>()
      .mockRejectedValue(new Error("key rejected"));
    await expect(
      verifyFindings(
        review(Array.from({ length: 5 }, (_, i) => finding({ line: i + 1 }))),
        check,
        { concurrency: 1, log: quiet },
      ),
    ).rejects.toThrow("key rejected");
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("parseCheckInput", () => {
  it("accepts a known outcome with evidence", () => {
    expect(
      parseCheckInput({ outcome: "refuted", evidence: "guard at x.ts:3" }),
    ).toEqual({
      outcome: "refuted",
      evidence: "guard at x.ts:3",
    });
  });
  it.each([
    [{ evidence: "e" }],
    [{ outcome: "Confirmed", evidence: "e" }],
    [{ outcome: "unchecked", evidence: "e" }],
    [{ outcome: "confirmed", evidence: "   " }],
    [{ outcome: "confirmed" }],
    [undefined],
  ])("rejects %j", (input) => {
    expect(parseCheckInput(input)).toBeUndefined();
  });
});

describe("buildCheckPrompt", () => {
  it("gives the claim, the PR text and only that file's diff, and tells the model to try to disprove", () => {
    const prompt = buildCheckPrompt(context, finding());
    expect(prompt).toContain("Try to DISPROVE");
    expect(prompt).toContain("src/page.ts:11");
    expect(prompt).toContain("Crashes on an empty list.");
    expect(prompt).toContain("Adds the page.");
    expect(prompt).toContain("=== src/page.ts ===");
    expect(prompt).toContain("DATA");
  });

  it("shows the proposed replacement and asks whether it holds", () => {
    const prompt = buildCheckPrompt(
      context,
      finding({ suggestion: { startLine: 10, replacement: "const y = 2;" } }),
    );
    expect(prompt).toContain("const y = 2;");
    expect(prompt).toContain("lines 10-11");
    expect(prompt).toContain("suggestionHolds");
  });

  it("says so when the finding's file is not in the diff", () => {
    expect(
      buildCheckPrompt(context, finding({ path: "src/other.ts" })),
    ).toContain("this file is not part of the diff");
  });
});

describe("buildCheckQueryOptions", () => {
  it("is locked down like the review: read-only tools, no settings, no GitHub token", () => {
    const options = buildCheckQueryOptions("/tmp/x", {} as never, undefined, {
      GITHUB_TOKEN: "t",
      PATH: "p",
    });
    expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(options.settingSources).toEqual([]);
    expect(options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(options.maxTurns).toBeLessThan(24);
  });
});

function answer(input: unknown) {
  return {
    type: "assistant",
    session_id: "s",
    message: {
      content: [
        { type: "tool_use", name: "mcp__check-tools__submit_check", input },
      ],
    },
  };
}

function stream(...messages: unknown[]) {
  return (async function* () {
    for (const m of messages) yield m;
  })() as never;
}

describe("verifyFinding", () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it("returns the session's answer", async () => {
    vi.mocked(query).mockReturnValue(
      stream(
        answer({ outcome: "confirmed", evidence: "page.ts:11 has no guard" }),
      ),
    );
    expect(await verifyFinding(context, "/tmp/x", finding(), quiet)).toEqual({
      status: "confirmed",
      evidence: "page.ts:11 has no guard",
    });
  });

  it("records whether the proposed change holds, only for a finding that has one", async () => {
    vi.mocked(query).mockReturnValue(
      stream(
        answer({ outcome: "confirmed", evidence: "e", suggestionHolds: true }),
      ),
    );
    const withFix = finding({ suggestion: { replacement: "x" } });
    expect(
      await verifyFinding(context, "/tmp/x", withFix, quiet),
    ).toMatchObject({
      suggestionOk: true,
    });

    vi.mocked(query).mockReturnValue(
      stream(
        answer({ outcome: "confirmed", evidence: "e", suggestionHolds: true }),
      ),
    );
    expect(
      await verifyFinding(context, "/tmp/x", finding(), quiet),
    ).not.toHaveProperty("suggestionOk");
  });

  it("treats a missing answer about the proposed change as not ok", async () => {
    vi.mocked(query).mockReturnValue(
      stream(answer({ outcome: "confirmed", evidence: "e" })),
    );
    const v = await verifyFinding(
      context,
      "/tmp/x",
      finding({ suggestion: { replacement: "x" } }),
      quiet,
    );
    expect(v.suggestionOk).toBe(false);
  });

  it("ignores an invalid answer, warns, and takes the retry", async () => {
    const lines: string[] = [];
    vi.mocked(query).mockReturnValue(
      stream(
        answer({ outcome: "yes", evidence: "x" }),
        answer({ outcome: "refuted", evidence: "guard exists" }),
      ),
    );
    const v = await verifyFinding(context, "/tmp/x", finding(), (l) =>
      lines.push(l),
    );
    expect(v.status).toBe("refuted");
    expect(lines.some((l) => l.includes("invalid shape"))).toBe(true);
  });

  it("gives unsure, not confirmed, when the stream ends without an answer", async () => {
    vi.mocked(query).mockReturnValue(
      stream({ type: "result", subtype: "success" }),
    );
    expect(
      (await verifyFinding(context, "/tmp/x", finding(), quiet)).status,
    ).toBe("unsure");
  });

  it("gives unsure when the session runs out of turns", async () => {
    vi.mocked(query).mockReturnValue(
      (async function* () {
        yield* [];
        throw new Error("Reached maximum number of turns (10)");
      })() as never,
    );
    expect(
      (await verifyFinding(context, "/tmp/x", finding(), quiet)).status,
    ).toBe("unsure");
  });

  it("does not swallow other errors", async () => {
    vi.mocked(query).mockReturnValue(
      (async function* () {
        yield* [];
        throw new Error("network down");
      })() as never,
    );
    await expect(
      verifyFinding(context, "/tmp/x", finding(), quiet),
    ).rejects.toThrow("network down");
  });
});

describe("markUnchecked", () => {
  it("marks every Finding unchecked, anchored or not, and drops none", () => {
    const marked = markUnchecked(
      review([finding(), finding({ line: 12 })], [finding({ line: 99 })]),
    );
    expect(marked.findings).toHaveLength(2);
    expect(marked.unanchored).toHaveLength(1);
    for (const f of [...marked.findings, ...marked.unanchored]) {
      expect(f.verification?.status).toBe("unchecked");
    }
  });

  it("leaves nothing that would go inline in a posted review", () => {
    const marked = markUnchecked(review([finding()]));
    expect(postsInline(marked.findings[0]!)).toBe(false);
  });

  it("does not change the review it is given", () => {
    const original = review([finding()]);
    markUnchecked(original);
    expect(original.findings[0]!.verification).toBeUndefined();
  });
});
