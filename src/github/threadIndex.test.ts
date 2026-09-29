import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import { fetchThreadIndex } from "./threadIndex.js";

const node = (id: string, root: number | null, isResolved?: boolean) => ({
  id,
  ...(isResolved === undefined ? {} : { isResolved }),
  comments: { nodes: [{ databaseId: root }] },
});

function pageOf(
  nodes: ReturnType<typeof node>[],
  next: string | null,
): unknown {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: next !== null, endCursor: next },
          nodes,
        },
      },
    },
  };
}

describe("fetchThreadIndex", () => {
  it("maps root comment ids to node ids and the resolved flag, across pages", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(pageOf([node("T1", 11, true)], "cursor-1"))
      .mockResolvedValueOnce(
        pageOf([node("T2", 22, false), node("T3", 33)], null),
      );

    const index = await fetchThreadIndex(
      { graphql } as unknown as Octokit,
      "o",
      "r",
      7,
    );

    expect(index.get(11)).toEqual({ nodeId: "T1", resolved: true });
    expect(index.get(22)).toEqual({ nodeId: "T2", resolved: false });
    // Missing flag counts as not resolved: never silently skip a thread.
    expect(index.get(33)).toEqual({ nodeId: "T3", resolved: false });
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1]?.[1]).toMatchObject({ after: "cursor-1" });
  });

  it("ignores a thread whose root comment has no database id", async () => {
    const graphql = vi.fn().mockResolvedValue(pageOf([node("T9", null)], null));
    const index = await fetchThreadIndex(
      { graphql } as unknown as Octokit,
      "o",
      "r",
      7,
    );
    expect(index.size).toBe(0);
  });
});
