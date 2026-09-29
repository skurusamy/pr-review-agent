import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { fetchPrSummary } from "./prSummary.js";

function octokitReturning(data: Record<string, unknown>): Octokit {
  return {
    rest: { pulls: { get: async () => ({ data }) } },
  } as unknown as Octokit;
}

const base = {
  html_url: "https://github.com/o/r/pull/3",
  title: "Add thing",
  body: "Does the thing.",
  state: "open",
  merged: false,
  draft: false,
  head: { ref: "feature/x" },
  base: { ref: "main" },
  user: { login: "maria" },
  created_at: "2026-09-27T10:00:00Z",
  comments: 1,
  review_comments: 3,
  changed_files: 12,
  additions: 284,
  deletions: 91,
};
const pr = { owner: "o", repo: "r", prNumber: 3 };

describe("fetchPrSummary", () => {
  it("maps the GitHub PR onto the card's fields", async () => {
    const summary = await fetchPrSummary(octokitReturning(base), pr);
    expect(summary).toMatchObject({
      title: "Add thing",
      state: "open",
      headRef: "feature/x",
      baseRef: "main",
      author: "maria",
      comments: 4,
      changedFiles: 12,
      additions: 284,
      deletions: 91,
    });
  });

  it("reports a merged PR as merged, not just closed", async () => {
    const summary = await fetchPrSummary(
      octokitReturning({ ...base, state: "closed", merged: true }),
      pr,
    );
    expect(summary.state).toBe("merged");
  });

  it("shortens a long description and returns null for an empty one", async () => {
    const long = await fetchPrSummary(
      octokitReturning({ ...base, body: "x".repeat(500) }),
      pr,
    );
    expect(long.description!.length).toBeLessThan(300);
    const none = await fetchPrSummary(
      octokitReturning({ ...base, body: "  " }),
      pr,
    );
    expect(none.description).toBeNull();
  });
});
