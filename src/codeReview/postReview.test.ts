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
import { findingMarker } from "./suggestion.js";

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
function fakeOctokit(
  existingReviews: unknown[] = [],
  submittedComments: { body: string }[] = [],
) {
  const createReview = vi.fn().mockResolvedValue({
    data: {
      id: 99,
      html_url: "https://github.com/acme/widgets/pull/7#pullrequestreview-99",
    },
  });
  const listReviewComments = vi.fn();
  const octokit = {
    // One mock for every paginated endpoint, told apart by which one it was asked for.
    paginate: vi.fn((endpoint: unknown) =>
      Promise.resolve(
        endpoint === listReviewComments ? submittedComments : existingReviews,
      ),
    ),
    rest: {
      users: {
        getAuthenticated: vi.fn().mockResolvedValue({ data: { login: "me" } }),
      },
      pulls: { listReviews: vi.fn(), listReviewComments, createReview },
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
      body: `**[HIGH] Drops the last page** · correctness\n\nThe loop bound is exclusive.\n\n${findingMarker(review.findings[0]!)}`,
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
      alreadyPosted: 0,
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

describe("suggested changes in posted comments", () => {
  const withSuggestion = (over: Partial<Finding> = {}): Finding =>
    finding({
      line: 12,
      suggestion: { startLine: 11, replacement: "const x = 1;\nreturn x;" },
      ...over,
    });

  it("spans the replaced lines and ends with a suggestion block, then the marker", () => {
    const [comment] = buildReviewComments([withSuggestion()]);
    expect(comment).toMatchObject({
      start_line: 11,
      start_side: "RIGHT",
      line: 12,
    });
    expect(comment?.body).toContain(
      "```suggestion\nconst x = 1;\nreturn x;\n```",
    );
    expect(comment?.body.trim().endsWith("-->")).toBe(true);
  });

  it("uses a single-line comment when the fix replaces one line", () => {
    const [comment] = buildReviewComments([
      withSuggestion({ suggestion: { replacement: "fixed();" } }),
    ]);
    expect(comment).not.toHaveProperty("start_line");
    expect(comment?.body).toContain("```suggestion\nfixed();\n```");
  });

  it("keeps a suggestion out when the check did not judge it correct, but still posts the finding", () => {
    const [bad] = buildReviewComments([
      withSuggestion({
        verification: {
          status: "confirmed",
          evidence: "e",
          suggestionOk: false,
        },
      }),
    ]);
    expect(bad?.body).not.toContain("suggestion");
    expect(bad).not.toHaveProperty("start_line");
    const [missing] = buildReviewComments([
      withSuggestion({ verification: { status: "confirmed", evidence: "e" } }),
    ]);
    expect(missing?.body).not.toContain("```suggestion");
    const [good] = buildReviewComments([
      withSuggestion({
        verification: {
          status: "confirmed",
          evidence: "e",
          suggestionOk: true,
        },
      }),
    ]);
    expect(good?.body).toContain("```suggestion");
  });

  it("accepts a suggestion from the browser and rejects a blank one", () => {
    expect(
      postableReviewSchema.safeParse({
        ...review,
        findings: [withSuggestion()],
      }).success,
    ).toBe(true);
    expect(
      postableReviewSchema.safeParse({
        ...review,
        findings: [withSuggestion({ suggestion: { replacement: "  " } })],
      }).success,
    ).toBe(false);
  });
});

describe("posting twice", () => {
  it("leaves out a finding whose marker is already on a submitted comment", async () => {
    const posted = finding({ title: "Drops the last page" });
    const other = finding({ title: "Something else", line: 30 });
    const { octokit, createReview } = fakeOctokit(
      [],
      [{ body: `earlier\n\n${findingMarker(posted)}` }],
    );

    const result = await postCodeReviewAsPending(
      octokit,
      "acme",
      "widgets",
      7,
      { ...review, findings: [posted, other] },
      "abc1234",
    );

    expect(createReview.mock.calls[0]![0].comments).toHaveLength(1);
    expect(createReview.mock.calls[0]![0].comments[0].body).toContain(
      "Something else",
    );
    expect(result).toMatchObject({ commentCount: 1, alreadyPosted: 1 });
  });

  it("does not count a not-confirmed finding as already posted", async () => {
    const maybe = finding({
      verification: { status: "unsure", evidence: "e" },
    });
    const { octokit } = fakeOctokit([], [{ body: findingMarker(maybe) }]);
    const result = await postCodeReviewAsPending(
      octokit,
      "acme",
      "widgets",
      7,
      { ...review, findings: [maybe] },
      "abc1234",
    );
    expect(result).toMatchObject({ commentCount: 0, alreadyPosted: 0 });
  });
});
