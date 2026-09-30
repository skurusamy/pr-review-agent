import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  buildReviewBody,
  buildReviewComments,
  postableReviewSchema,
  postCodeReviewAsPending,
  type PostableReview,
} from "./postReview.js";
import type { Finding } from "./generateReview.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    path: "src/page.ts",
    line: 11,
    severity: "high",
    category: "correctness",
    title: "Drops the last page",
    explanation: "The loop bound is exclusive.",
    ...overrides,
  };
}

const review: PostableReview = {
  assessment: "Small and focused.",
  findings: [
    finding(),
    finding({ path: "src/b.ts", line: 3, severity: "low" }),
  ],
  unanchored: [],
  skippedFiles: [],
};

/** A fake Octokit recording createReview, with configurable existing reviews. */
function fakeOctokit(existingReviews: unknown[] = []) {
  const createReview = vi.fn().mockResolvedValue({
    data: {
      id: 99,
      html_url: "https://github.com/acme/widgets/pull/7#pullrequestreview-99",
    },
  });
  const octokit = {
    paginate: vi.fn().mockResolvedValue(existingReviews),
    rest: {
      users: {
        getAuthenticated: vi.fn().mockResolvedValue({ data: { login: "me" } }),
      },
      pulls: { listReviews: vi.fn(), createReview },
    },
  };
  return { octokit: octokit as unknown as Octokit, createReview };
}

describe("buildReviewComments", () => {
  it("makes one RIGHT-side inline comment per finding, with severity, title and explanation", () => {
    const comments = buildReviewComments(review.findings);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toEqual({
      path: "src/page.ts",
      line: 11,
      side: "RIGHT",
      body: "**[HIGH] Drops the last page** · correctness\n\nThe loop bound is exclusive.",
    });
    expect(comments[1]).toMatchObject({ path: "src/b.ts", line: 3 });
  });
});

describe("buildReviewBody", () => {
  it("opens with the draft note and includes the assessment", () => {
    const body = buildReviewBody(review);
    expect(body.startsWith("_Draft from pr-review-agent")).toBe(true);
    expect(body).toContain("## Assessment\n\nSmall and focused.");
  });

  it("omits the unanchored and not-reviewed sections when empty", () => {
    const body = buildReviewBody(review);
    expect(body).not.toContain("not anchored");
    expect(body).not.toContain("Not reviewed");
  });

  it("carries unanchored findings and skipped files, since they can't go inline", () => {
    const body = buildReviewBody({
      ...review,
      unanchored: [finding({ line: 900, title: "Off the diff" })],
      skippedFiles: [{ path: "package-lock.json", reason: "lockfile" }],
    });
    expect(body).toContain("## Findings not anchored to the diff");
    expect(body).toContain("**[HIGH] Off the diff**");
    expect(body).toContain("`src/page.ts:900`");
    expect(body).toContain("- `package-lock.json` (lockfile)");
  });
});

describe("postCodeReviewAsPending", () => {
  it("creates a pending review pinned to the reviewed commit", async () => {
    const { octokit, createReview } = fakeOctokit();
    const result = await postCodeReviewAsPending(
      octokit,
      "acme",
      "widgets",
      7,
      review,
      "abc1234",
    );

    expect(result).toEqual({
      created: true,
      reviewId: 99,
      url: "https://github.com/acme/widgets/pull/7#pullrequestreview-99",
      commentCount: 2,
    });
    const args = createReview.mock.calls[0]![0];
    expect(args).toMatchObject({
      owner: "acme",
      repo: "widgets",
      pull_number: 7,
      commit_id: "abc1234",
    });
    expect(args.comments).toHaveLength(2);
    expect(args.body).toContain("Small and focused.");
  });

  it("never submits: no event is passed, which is what keeps the review pending", async () => {
    const { octokit, createReview } = fakeOctokit();
    await postCodeReviewAsPending(octokit, "a", "b", 1, review, "abc1234");
    expect(createReview.mock.calls[0]![0]).not.toHaveProperty("event");
  });

  it("refuses, without posting, when the user already has a pending review", async () => {
    const { octokit, createReview } = fakeOctokit([
      { id: 5, state: "PENDING", user: { login: "me" } },
    ]);
    const result = await postCodeReviewAsPending(
      octokit,
      "a",
      "b",
      1,
      review,
      "abc1234",
    );
    expect(result).toEqual({ created: false, reason: "pending-review-exists" });
    expect(createReview).not.toHaveBeenCalled();
  });

  it("ignores someone else's pending review and the user's own submitted ones", async () => {
    const { octokit, createReview } = fakeOctokit([
      { id: 5, state: "PENDING", user: { login: "someone-else" } },
      { id: 6, state: "COMMENTED", user: { login: "me" } },
    ]);
    const result = await postCodeReviewAsPending(
      octokit,
      "a",
      "b",
      1,
      review,
      "abc1234",
    );
    expect(result.created).toBe(true);
    expect(createReview).toHaveBeenCalledTimes(1);
  });

  it("can post a review with only an assessment (no findings)", async () => {
    const { octokit, createReview } = fakeOctokit();
    const result = await postCodeReviewAsPending(
      octokit,
      "a",
      "b",
      1,
      { ...review, findings: [] },
      "abc1234",
    );
    expect(result).toMatchObject({ created: true, commentCount: 0 });
    expect(createReview.mock.calls[0]![0].comments).toEqual([]);
  });
});

describe("postableReviewSchema", () => {
  it("accepts a well-formed review", () => {
    expect(postableReviewSchema.safeParse(review).success).toBe(true);
  });

  it("rejects a bad severity, a non-integer line, and missing fields", () => {
    const bad = (f: object) =>
      postableReviewSchema.safeParse({ ...review, findings: [f] }).success;
    expect(bad({ ...finding(), severity: "critical" })).toBe(false);
    expect(bad({ ...finding(), line: 1.5 })).toBe(false);
    expect(bad({ ...finding(), line: 0 })).toBe(false);
    expect(bad({ path: "x" })).toBe(false);
    expect(postableReviewSchema.safeParse({ assessment: "x" }).success).toBe(
      false,
    );
  });
});

describe("posting after the verify pass", () => {
  const checked = (
    status: "confirmed" | "refuted" | "unsure" | "unchecked",
    over: Partial<Finding> = {},
  ): Finding =>
    finding({ verification: { status, evidence: `e-${status}` }, ...over });

  it("posts only confirmed findings inline", () => {
    const comments = buildReviewComments([
      checked("confirmed", { title: "A" }),
      checked("refuted", { title: "B" }),
      checked("unsure", { title: "C" }),
      checked("unchecked", { title: "D" }),
    ]);
    expect(comments.map((c) => c.body)).toEqual([expect.stringContaining("A")]);
  });

  it("still posts a finding that never went through the verify pass", () => {
    expect(buildReviewComments([finding()])).toHaveLength(1);
  });

  it("lists not-confirmed findings in the body with the check's evidence, and counts dismissed ones", () => {
    const body = buildReviewBody({
      assessment: "a",
      findings: [
        checked("unsure", { title: "Maybe" }),
        checked("refuted", { title: "Wrong" }),
      ],
      unanchored: [checked("refuted", { title: "Also wrong" })],
      skippedFiles: [],
    });
    expect(body).toContain("## Not confirmed");
    expect(body).toContain("Maybe");
    expect(body).toContain("e-unsure");
    expect(body).not.toContain("Wrong**");
    expect(body).toContain(
      "2 finding(s) were checked a second time and dismissed",
    );
  });

  it("accepts a verification from the browser and rejects an unknown status", () => {
    const ok = postableReviewSchema.safeParse({
      ...review,
      findings: [checked("confirmed")],
    });
    expect(ok.success).toBe(true);
    const bad = postableReviewSchema.safeParse({
      ...review,
      findings: [
        { ...finding(), verification: { status: "great", evidence: "" } },
      ],
    });
    expect(bad.success).toBe(false);
  });
});
