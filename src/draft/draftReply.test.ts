import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  buildDraftReply,
  createPendingReview,
  hasMarkerForComment,
  type DraftReplyEntry,
} from "./draftReply.js";
import type { ReviewThread } from "../github/types.js";
import type { Verdict } from "../verdict/reachVerdict.js";

function makeThread(
  overrides: Partial<ReviewThread["rootComment"]> = {},
): ReviewThread {
  return {
    rootComment: {
      id: 42,
      path: "src/index.ts",
      line: 10,
      originalLine: 10,
      diffHunk: "@@ -1,3 +1,3 @@",
      body: "Is this off by one?",
      author: "reviewer",
      createdAt: "2026-01-01T00:00:00Z",
      htmlUrl: "https://github.com/o/r/pull/1#discussion_r1",
      outdated: false,
      ...overrides,
    },
    replies: [],
  };
}

describe("buildDraftReply", () => {
  it("uses the verdict's reasoning for a not-a-bug outcome", () => {
    const verdict: Verdict = {
      verdict: "not-a-bug",
      reasoning: "This is intentional.",
    };
    const entry = buildDraftReply(makeThread(), { kind: "not-a-bug", verdict });

    expect(entry.body).toContain("This is intentional.");
    expect(entry.rootCommentId).toBe(42);
    expect(entry.path).toBe("src/index.ts");
    expect(entry.line).toBe(10);
  });

  it("explains which gate failed for an exhausted outcome", () => {
    const entry = buildDraftReply(makeThread(), {
      kind: "exhausted",
      failedGate: "test",
    });
    expect(entry.body).toContain("`test`");
    expect(entry.body).toContain("3 times");
  });

  it("embeds a marker naming the specific root comment id", () => {
    const entry = buildDraftReply(makeThread({ id: 999 }), {
      kind: "not-a-bug",
      verdict: { verdict: "not-a-bug", reasoning: "ok" },
    });
    expect(hasMarkerForComment(entry.body, 999)).toBe(true);
    expect(hasMarkerForComment(entry.body, 1000)).toBe(false);
  });

  it("falls back to originalLine when line is null (outdated comment)", () => {
    const entry = buildDraftReply(
      makeThread({ line: null, originalLine: 55, outdated: true }),
      {
        kind: "not-a-bug",
        verdict: { verdict: "not-a-bug", reasoning: "ok" },
      },
    );
    expect(entry.line).toBe(55);
  });
});

describe("createPendingReview", () => {
  const entry = (rootCommentId: number): DraftReplyEntry => ({
    rootCommentId,
    path: `src/f${rootCommentId}.ts`,
    line: 3,
    body: `reply ${rootCommentId}`,
  });

  /** A fake GitHub with `threads` (root comment id -> thread node id). */
  function fakeOctokit(opts: {
    threads: Record<number, string>;
    pending?: boolean;
    failReplyFor?: string;
  }) {
    const createReview = vi.fn(async () => ({
      data: { id: 900, node_id: "PRR_node" },
    }));
    const deletePendingReview = vi.fn(async () => ({}));
    const replies: { review: string; thread: string; body: string }[] = [];
    const graphql = vi.fn(
      async (query: string, vars: Record<string, unknown>) => {
        if (query.includes("reviewThreads")) {
          return {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: Object.entries(opts.threads).map(([id, node]) => ({
                    id: node,
                    comments: { nodes: [{ databaseId: Number(id) }] },
                  })),
                },
              },
            },
          };
        }
        if (vars.thread === opts.failReplyFor) throw new Error("boom");
        replies.push({
          review: vars.review as string,
          thread: vars.thread as string,
          body: vars.body as string,
        });
        return {};
      },
    );
    const octokit = {
      paginate: vi.fn(async () =>
        opts.pending
          ? [{ id: 5, state: "PENDING", user: { login: "me" } }]
          : [],
      ),
      graphql,
      rest: { pulls: { listReviews: {}, createReview, deletePendingReview } },
    } as unknown as Octokit;
    return { octokit, createReview, deletePendingReview, replies, graphql };
  }

  it("adds each draft as a reply inside its own review thread", async () => {
    const f = fakeOctokit({ threads: { 1: "T1", 2: "T2" } });

    const result = await createPendingReview(
      f.octokit,
      "o",
      "r",
      7,
      [entry(1), entry(2)],
      "me",
    );

    expect(result).toEqual({ created: true, reviewId: 900 });
    expect(f.replies).toEqual([
      { review: "PRR_node", thread: "T1", body: "reply 1" },
      { review: "PRR_node", thread: "T2", body: "reply 2" },
    ]);
    // The review itself carries no line comments: those would be new
    // comments beside the thread, not replies in it.
    const call = f.createReview.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(call[0]).not.toHaveProperty("comments");
    expect(call[0]).not.toHaveProperty("event");
  });

  it("falls back to a line comment when a thread can't be found", async () => {
    const f = fakeOctokit({ threads: { 1: "T1" } });

    await createPendingReview(
      f.octokit,
      "o",
      "r",
      7,
      [entry(1), entry(2)],
      "me",
    );

    const call = f.createReview.mock.calls[0] as unknown as [
      { comments: unknown[] },
    ];
    expect(call[0].comments).toEqual([
      { path: "src/f2.ts", line: 3, body: "reply 2" },
    ]);
    expect(f.replies.map((r) => r.thread)).toEqual(["T1"]);
  });

  it("refuses without touching anything when a pending review exists", async () => {
    const f = fakeOctokit({ threads: { 1: "T1" }, pending: true });

    const result = await createPendingReview(
      f.octokit,
      "o",
      "r",
      7,
      [entry(1)],
      "me",
    );

    expect(result).toEqual({ created: false, reason: "pending-review-exists" });
    expect(f.createReview).not.toHaveBeenCalled();
  });

  it("deletes the half-built pending review when a reply fails, so a retry isn't blocked", async () => {
    const f = fakeOctokit({
      threads: { 1: "T1", 2: "T2" },
      failReplyFor: "T2",
    });

    await expect(
      createPendingReview(f.octokit, "o", "r", 7, [entry(1), entry(2)], "me"),
    ).rejects.toThrow("boom");

    expect(f.deletePendingReview).toHaveBeenCalledWith(
      expect.objectContaining({ review_id: 900, pull_number: 7 }),
    );
  });
});
