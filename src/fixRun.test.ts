import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "./github/types.js";

const reachVerdict = vi.fn();
const hasExistingReply = vi.fn();

vi.mock("./github/client.js", () => ({ createOctokit: () => ({}) }));
vi.mock("./github/reviewComments.js", () => ({
  fetchReviewThreads: vi.fn(),
}));
vi.mock("./github/checkout.js", () => ({
  checkoutPullRequestHead: vi.fn(),
  // Hand the callback a fake checkout; there is nothing to clone.
  withCheckout: async (
    _open: unknown,
    use: (c: unknown) => Promise<void>,
  ): Promise<void> =>
    use({ dir: "/tmp/checkout", headSha: "abc1234", push: vi.fn() }),
}));
vi.mock("./verdict/reachVerdict.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./verdict/reachVerdict.js")>()),
  reachVerdict: (...args: unknown[]) => reachVerdict(...args),
}));
vi.mock("./draft/replyLedger.js", () => ({
  PENDING_REVIEW_EXISTS_MESSAGE: "exists",
  githubReplyLedger: () => ({
    hasExistingReply: (...args: unknown[]) => hasExistingReply(...args),
    postFixConfirmation: vi.fn(),
    createPendingReview: vi.fn(async () => ({ created: false, reason: "x" })),
  }),
  dryRunReplyLedger: (inner: unknown) => inner,
}));

const { runFix } = await import("./fixRun.js");
const { fetchReviewThreads } = await import("./github/reviewComments.js");

function thread(id: number, resolved: boolean): ReviewThread {
  return {
    rootComment: {
      id,
      path: `src/f${id}.ts`,
      line: 3,
      originalLine: 3,
      diffHunk: "@@",
      body: "Is this right?",
      author: "rita",
      createdAt: "2026-01-01T00:00:00Z",
      htmlUrl: `https://github.com/o/r/pull/1#r${id}`,
      outdated: false,
    },
    replies: [],
    resolved,
  };
}

const base = {
  owner: "o",
  repo: "r",
  prNumber: 1,
  dryRun: true,
  githubToken: "t",
};

describe("runFix and resolved threads", () => {
  beforeEach(() => {
    reachVerdict.mockReset();
    hasExistingReply.mockReset();
    hasExistingReply.mockResolvedValue(false);
    reachVerdict.mockResolvedValue({
      verdict: "not-a-bug",
      reasoning: "Fine as is.",
    });
    vi.mocked(fetchReviewThreads).mockResolvedValue([
      thread(1, true),
      thread(2, false),
    ]);
  });

  it("skips a resolved thread without spending any model time on it", async () => {
    const outcomes: unknown[] = [];
    const lines: string[] = [];

    await runFix({
      ...base,
      log: (l) => lines.push(l),
      onEvent: (e) => {
        if (e.type === "thread-outcome") outcomes.push(e);
      },
    });

    expect(reachVerdict).toHaveBeenCalledTimes(1);
    expect(
      (reachVerdict.mock.calls[0] as [string, ReviewThread])[1].rootComment.id,
    ).toBe(2);
    expect(outcomes).toContainEqual({
      type: "thread-outcome",
      threadId: 1,
      outcome: { kind: "skipped", reason: "resolved" },
    });
    expect(lines.join("\n")).toContain(
      "Found 2 comment thread(s), 1 resolved.",
    );
    expect(lines.join("\n")).toContain("Already resolved on GitHub");
  });

  it("judges resolved threads too when asked to", async () => {
    await runFix({ ...base, includeResolved: true, log: () => {} });

    expect(reachVerdict).toHaveBeenCalledTimes(2);
  });
});
