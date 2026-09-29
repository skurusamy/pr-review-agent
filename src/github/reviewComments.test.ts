import { describe, expect, it } from "vitest";
import { groupIntoThreads } from "./reviewComments.js";

function comment(overrides: Record<string, unknown>) {
  return {
    id: 1,
    path: "src/index.ts",
    line: 10,
    original_line: 10,
    diff_hunk: "@@ -1,3 +1,3 @@",
    body: "some comment",
    user: { login: "reviewer" },
    created_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/o/r/pull/1#discussion_r1",
    in_reply_to_id: null,
    ...overrides,
  };
}

describe("groupIntoThreads", () => {
  it("groups replies under their root by in_reply_to_id", () => {
    const raw = [
      comment({ id: 1, body: "root", created_at: "2026-01-01T00:00:00Z" }),
      comment({
        id: 3,
        body: "second reply",
        in_reply_to_id: 1,
        created_at: "2026-01-01T02:00:00Z",
      }),
      comment({
        id: 2,
        body: "first reply",
        in_reply_to_id: 1,
        created_at: "2026-01-01T01:00:00Z",
      }),
    ];

    const threads = groupIntoThreads(raw);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.rootComment.body).toBe("root");
    expect(threads[0]?.replies.map((r) => r.body)).toEqual([
      "first reply",
      "second reply",
    ]);
  });

  it("carries the resolved flag and the PR author from GitHub's thread index", () => {
    const raw = [comment({ id: 1 }), comment({ id: 2 })];

    const threads = groupIntoThreads(raw, {
      index: new Map([[1, { nodeId: "T1", resolved: true }]]),
      prAuthor: "pat",
    });

    expect(threads.map((t) => t.resolved)).toEqual([true, false]);
    expect(threads.every((t) => t.prAuthor === "pat")).toBe(true);
  });

  it("returns a thread with no replies when nobody replied", () => {
    const raw = [comment({ id: 1, body: "root" })];

    const threads = groupIntoThreads(raw);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies).toEqual([]);
  });

  it("marks a comment outdated when its diff line is null", () => {
    const raw = [
      comment({ id: 1, line: null, original_line: 42, body: "moved" }),
    ];

    const threads = groupIntoThreads(raw);

    expect(threads[0]?.rootComment.outdated).toBe(true);
    expect(threads[0]?.rootComment.line).toBeNull();
    expect(threads[0]?.rootComment.originalLine).toBe(42);
  });

  it("handles multiple independent threads on the same PR", () => {
    const raw = [
      comment({ id: 1, path: "a.ts", body: "root a" }),
      comment({ id: 2, path: "b.ts", body: "root b" }),
      comment({ id: 3, path: "a.ts", body: "reply to a", in_reply_to_id: 1 }),
    ];

    const threads = groupIntoThreads(raw);

    expect(threads).toHaveLength(2);
    const threadA = threads.find((t) => t.rootComment.path === "a.ts");
    const threadB = threads.find((t) => t.rootComment.path === "b.ts");
    expect(threadA?.replies).toHaveLength(1);
    expect(threadB?.replies).toHaveLength(0);
  });
});
