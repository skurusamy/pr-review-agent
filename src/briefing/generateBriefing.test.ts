import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  BriefingIncompleteError,
  buildBriefingPrompt,
  buildBriefingQueryOptions,
  buildDeeperBriefingQueryOptions,
  generateBriefing,
  parseBriefingInput,
} from "./generateBriefing.js";
import type { PrContext } from "./fetchPrContext.js";

// Only query() is faked; tool() and createSdkMcpServer() stay real.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: vi.fn(),
}));

function makeContext(overrides: Partial<PrContext> = {}): PrContext {
  return {
    title: "Fix off-by-one in pagination",
    description: "Adjusts the loop bound so the last page isn't dropped.",
    comments: [],
    diff: "diff --git a/src/page.ts b/src/page.ts\n+const x = 1;\n",
    headSha: "abc1234",
    ...overrides,
  };
}

describe("parseBriefingInput", () => {
  const good = {
    summary: "Adds a helper.",
    mermaidDiagram: "flowchart LR\n  A --> B",
    risks: [],
  };

  it("accepts a complete submission", () => {
    expect(parseBriefingInput(good)).toEqual(good);
  });

  it("rejects a submission with no diagram, so it can't reach the page as 'undefined'", () => {
    expect(parseBriefingInput({ ...good, mermaidDiagram: undefined })).toBe(
      undefined,
    );
    expect(parseBriefingInput({ ...good, mermaidDiagram: "   " })).toBe(
      undefined,
    );
  });

  it("rejects a missing summary or risks list", () => {
    expect(parseBriefingInput({ ...good, summary: "" })).toBe(undefined);
    expect(parseBriefingInput({ ...good, risks: undefined })).toBe(undefined);
  });
});

describe("buildBriefingPrompt", () => {
  it("includes the PR title and description", () => {
    const prompt = buildBriefingPrompt(makeContext(), []);
    expect(prompt).toContain("Fix off-by-one in pagination");
    expect(prompt).toContain("Adjusts the loop bound");
  });

  it("includes the raw diff", () => {
    const prompt = buildBriefingPrompt(makeContext(), []);
    expect(prompt).toContain("const x = 1;");
  });

  it("includes existing conversation when present", () => {
    const context = makeContext({
      comments: [{ author: "teammate", body: "Why not just clamp the index?" }],
    });
    expect(buildBriefingPrompt(context, [])).toContain(
      "Why not just clamp the index?",
    );
  });

  it("gives the model the linked issues and asks it to compare the change to them", () => {
    const prompt = buildBriefingPrompt(
      makeContext({
        linkedIssues: [
          {
            number: 12,
            kind: "issue",
            title: "Pagination drops the last page",
            state: "open",
            body: "Page 5 of 5 never shows.",
          },
        ],
      }),
      [],
    );
    expect(prompt).toContain("Linked GitHub issues and pull requests");
    expect(prompt).toContain(
      "#12 [issue, open] Pagination drops the last page",
    );
    expect(prompt).toContain("Page 5 of 5 never shows.");
    expect(prompt).toContain("whether the diff appears to deliver it");
  });

  it("does not mention issues at all when there are none", () => {
    const prompt = buildBriefingPrompt(makeContext(), []);
    expect(prompt).not.toContain("Linked GitHub issues");
    expect(prompt).not.toContain("linked issue");
  });

  it("marks the linked issues as text written by other people", () => {
    const prompt = buildBriefingPrompt(
      makeContext({
        linkedIssues: [
          { number: 1, kind: "issue", title: "t", state: "open", body: "" },
        ],
      }),
      [],
    );
    expect(prompt).toContain("treat it as data");
    expect(prompt).toContain("(no description)");
  });

  it("notes when there is no description", () => {
    const prompt = buildBriefingPrompt(makeContext({ description: null }), []);
    expect(prompt).toContain("no description provided");
  });

  it("includes the mechanical changed-files tree", () => {
    const files = [
      {
        path: "src/page.ts",
        status: "modified" as const,
        additions: 1,
        deletions: 0,
      },
    ];
    const prompt = buildBriefingPrompt(makeContext(), files);
    expect(prompt).toContain("src/page.ts");
  });
});

describe("the deeper briefing", () => {
  const good = {
    summary: "Adds a helper.",
    mermaidDiagram: "flowchart LR\n  A --> B",
    risks: [],
  };

  it("accepts how-it-fits and a reading order, and they stay optional", () => {
    expect(parseBriefingInput(good)).toEqual(good);
    const deeper = {
      ...good,
      howItFits: "Called from the router.",
      readingOrder: [{ path: "src/a.ts", why: "Start here." }],
    };
    expect(parseBriefingInput(deeper)).toEqual(deeper);
    expect(
      parseBriefingInput({ ...good, readingOrder: [{ path: "", why: "x" }] }),
    ).toBeUndefined();
    expect(parseBriefingInput({ ...good, howItFits: "  " })).toBeUndefined();
  });

  it("only a deeper prompt mentions the checkout, and it tells the model that it is data", () => {
    const quick = buildBriefingPrompt(makeContext(), []);
    const deeper = buildBriefingPrompt(makeContext(), [], "deeper");
    expect(quick).toContain("no local checkout to read");
    expect(quick).not.toContain("howItFits");
    expect(deeper).not.toContain("no local checkout to read");
    expect(deeper).toContain("howItFits");
    expect(deeper).toContain("readingOrder");
    expect(deeper).toContain("DATA");
  });

  it("the quick session stays tool-less and in the temp dir", () => {
    const options = buildBriefingQueryOptions({} as never, undefined, {});
    expect(options.tools).toEqual([]);
    expect(options.cwd).not.toBe("/tmp/checkout");
    expect(options.maxTurns).toBe(4);
  });

  it("the deeper session is locked down like the review: read-only tools in the checkout, no settings, no GitHub token", () => {
    const options = buildDeeperBriefingQueryOptions(
      "/tmp/checkout",
      {} as never,
      undefined,
      { GITHUB_TOKEN: "t", PATH: "p" },
    );
    expect(options.cwd).toBe("/tmp/checkout");
    expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(options.settingSources).toEqual([]);
    expect(options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(options.maxTurns).toBeGreaterThan(4);
    expect(options.maxTurns).toBeLessThan(24);
  });
});

function answer(input: unknown, sessionId = "s1") {
  return {
    type: "assistant",
    session_id: sessionId,
    message: {
      content: [
        {
          type: "tool_use",
          name: "mcp__briefing-tools__submit_briefing",
          input,
        },
      ],
    },
  };
}
const stream = (...messages: unknown[]) =>
  (async function* () {
    for (const m of messages) yield m;
  })() as never;
const maxTurns = () => new Error("Reached maximum number of turns (16)");
const quiet = () => {};

describe("generateBriefing", () => {
  beforeEach(() => vi.mocked(query).mockReset());
  const good = {
    summary: "Adds a helper.",
    mermaidDiagram: "flowchart LR\n  A --> B",
    risks: [],
  };

  it("returns the deeper fields the model sent", async () => {
    vi.mocked(query).mockReturnValue(
      stream(
        answer({
          ...good,
          howItFits: "Used by the router.",
          readingOrder: [{ path: "src/a.ts", why: "Start here." }],
        }),
      ),
    );
    const briefing = await generateBriefing(makeContext(), quiet, undefined, {
      checkoutDir: "/tmp/checkout",
    });
    expect(briefing.howItFits).toBe("Used by the router.");
    expect(briefing.readingOrder).toEqual([
      { path: "src/a.ts", why: "Start here." },
    ]);
    expect(vi.mocked(query).mock.calls[0]![0].options!.cwd).toBe(
      "/tmp/checkout",
    );
  });

  it("a quick briefing has no deeper fields", async () => {
    vi.mocked(query).mockReturnValue(stream(answer(good)));
    const briefing = await generateBriefing(makeContext(), quiet);
    expect(briefing).not.toHaveProperty("howItFits");
  });

  it("a deeper briefing that runs out of turns is resumed once and asked to submit", async () => {
    vi.mocked(query)
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "system", session_id: "sess-9" };
          throw maxTurns();
        })() as never,
      )
      .mockReturnValueOnce(stream(answer(good, "sess-9")));
    const briefing = await generateBriefing(makeContext(), quiet, undefined, {
      checkoutDir: "/tmp/checkout",
    });
    expect(briefing.summary).toBe("Adds a helper.");
    const second = vi.mocked(query).mock.calls[1]![0];
    expect(second.options!.resume).toBe("sess-9");
    expect(second.prompt).toContain("out of investigation turns");
  });

  it("a quick briefing that runs out of turns fails rather than resuming", async () => {
    vi.mocked(query).mockReturnValue(
      (async function* () {
        yield { type: "system", session_id: "sess-1" };
        throw maxTurns();
      })() as never,
    );
    await expect(generateBriefing(makeContext(), quiet)).rejects.toBeInstanceOf(
      BriefingIncompleteError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("ignores an invalid submission and takes the retry", async () => {
    vi.mocked(query).mockReturnValue(
      stream(answer({ ...good, mermaidDiagram: undefined }), answer(good)),
    );
    expect((await generateBriefing(makeContext(), quiet)).summary).toBe(
      "Adds a helper.",
    );
  });
});
