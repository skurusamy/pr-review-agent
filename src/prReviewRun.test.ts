import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPrReview } from "./prReviewRun.js";
import { gatherReviewContext, verifyReview } from "./codeReviewRun.js";
import { generateBriefing } from "./briefing/generateBriefing.js";
import { generateCodeReview } from "./codeReview/generateReview.js";
import type { CodeReview, Finding } from "./codeReview/generateReview.js";
import { checkoutPullRequestHead } from "./github/checkout.js";
import { ApiKeyRejectedError } from "./agentSession.js";

vi.mock("./github/client.js", () => ({ createOctokit: () => ({}) }));
vi.mock("./codeReviewRun.js", () => ({
  gatherReviewContext: vi.fn(),
  verifyReview: vi.fn(),
}));
vi.mock("./briefing/generateBriefing.js", () => ({
  generateBriefing: vi.fn(),
}));
vi.mock("./codeReview/generateReview.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./codeReview/generateReview.js")>()),
  generateCodeReview: vi.fn(),
}));
vi.mock("./github/checkout.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github/checkout.js")>()),
  checkoutPullRequestHead: vi.fn(),
}));

const cleanup = vi.fn();

const finding: Finding = {
  path: "src/page.ts",
  line: 11,
  severity: "high",
  category: "correctness",
  title: "Missing guard",
  explanation: "Crashes on an empty list.",
};

const reviewed: CodeReview = {
  assessment: "ok",
  findings: [finding],
  unanchored: [],
  skippedFiles: [],
  changedFiles: [],
  linkedIssues: [],
};

const checked: CodeReview = {
  ...reviewed,
  findings: [
    {
      ...finding,
      verification: { status: "confirmed", evidence: "src/page.ts:11" },
    },
  ],
};

const briefing = {
  summary: "Adds the guard.",
  mermaidDiagram: "flowchart LR\n A --> B",
  risks: ["Empty list"],
  howItFits: "Called by the list view.",
  readingOrder: [{ path: "src/page.ts", why: "the change" }],
  changedFiles: [],
  linkedIssues: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(gatherReviewContext).mockResolvedValue({
    title: "My PR",
    description: "D",
    comments: [],
    diff: "",
    headSha: "abc1234",
  });
  vi.mocked(generateBriefing).mockResolvedValue(briefing);
  vi.mocked(generateCodeReview).mockResolvedValue(reviewed);
  vi.mocked(verifyReview).mockResolvedValue(checked);
  cleanup.mockResolvedValue(undefined);
  vi.mocked(checkoutPullRequestHead).mockResolvedValue({
    dir: "/tmp/co",
    headRef: "x",
    headSha: "abc1234",
    push: vi.fn(),
    cleanup,
  });
});

const options = {
  owner: "o",
  repo: "r",
  prNumber: 1,
  githubToken: "t",
  log: () => {},
};

describe("runPrReview", () => {
  it("writes the briefing first, shows it, then reviews with it as background", async () => {
    const events: string[] = [];
    vi.mocked(generateCodeReview).mockImplementation(async () => {
      events.push("review");
      return reviewed;
    });
    const result = await runPrReview({
      ...options,
      onBriefing: () => events.push("briefing shown"),
    });

    // The page has the briefing before the review's session even starts.
    expect(events).toEqual(["briefing shown", "review"]);
    const handedToReview = vi.mocked(generateCodeReview).mock.calls[0]![4];
    expect(handedToReview).toContain("Adds the guard.");
    expect(handedToReview).toContain("Called by the list view.");
    expect(result.briefingMarkdown).toContain("# PR Briefing: My PR");
    expect(result.review).toBe(checked);
  });

  it("takes the briefing deeper, on the one checkout the review also reads", async () => {
    await runPrReview(options);
    expect(checkoutPullRequestHead).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkoutPullRequestHead).mock.calls[0]![5]).toEqual({
      readOnly: true,
    });
    expect(vi.mocked(generateBriefing).mock.calls[0]![3]).toEqual({
      checkoutDir: "/tmp/co",
    });
    expect(vi.mocked(generateCodeReview).mock.calls[0]![1]).toBe("/tmp/co");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("reports the steps in order", async () => {
    const steps: string[] = [];
    await runPrReview({ ...options, onStep: (s) => steps.push(s) });
    // "Checking the findings" is the verify step's own, started by verifyReview.
    expect(steps).toEqual([
      "Fetching pull request",
      "Checking out the branch",
      "Writing the briefing",
      "Reviewing the code",
    ]);
  });

  it("sends the Findings marked unchecked before the check starts", async () => {
    const events: string[] = [];
    vi.mocked(verifyReview).mockImplementation(async () => {
      events.push("verify");
      return checked;
    });
    await runPrReview({
      ...options,
      onDraft: (draft) => {
        events.push("draft");
        expect(draft.headSha).toBe("abc1234");
        expect(draft.review.findings[0]!.verification?.status).toBe(
          "unchecked",
        );
      },
    });
    expect(events).toEqual(["draft", "verify"]);
  });

  it("never gives the check the briefing", async () => {
    await runPrReview(options);
    // verifyReview(context, dir, reviewed, log, abort, onStep): nothing in it
    // carries the briefing, and it is handed the review as the model returned it.
    const args = vi.mocked(verifyReview).mock.calls[0]!;
    expect(JSON.stringify(args)).not.toContain("Adds the guard.");
    expect(args[2]).toBe(reviewed);
  });

  it("tries the briefing once more when it fails", async () => {
    vi.mocked(generateBriefing)
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockResolvedValueOnce(briefing);
    const failed = vi.fn();
    const result = await runPrReview({ ...options, onBriefingFailed: failed });
    expect(generateBriefing).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
    expect(result.briefingMarkdown).toBeDefined();
  });

  it("reviews without the briefing when it fails twice, and says so", async () => {
    vi.mocked(generateBriefing).mockRejectedValue(new Error("overloaded"));
    const failed = vi.fn();
    const shown = vi.fn();
    const result = await runPrReview({
      ...options,
      onBriefing: shown,
      onBriefingFailed: failed,
    });
    expect(generateBriefing).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledWith("overloaded");
    expect(shown).not.toHaveBeenCalled();
    expect(vi.mocked(generateCodeReview).mock.calls[0]![4]).toBeUndefined();
    expect(result.briefingMarkdown).toBeUndefined();
    expect(result.review).toBe(checked);
  });

  it("does not retry a stopped briefing, and does not start the review", async () => {
    const abortController = new AbortController();
    vi.mocked(generateBriefing).mockImplementation(async () => {
      abortController.abort();
      throw new Error("aborted");
    });
    await expect(runPrReview({ ...options, abortController })).rejects.toThrow(
      "aborted",
    );
    expect(generateBriefing).toHaveBeenCalledTimes(1);
    expect(generateCodeReview).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("stops the whole run on a rejected API key instead of retrying", async () => {
    vi.mocked(generateBriefing).mockRejectedValue(new ApiKeyRejectedError());
    await expect(runPrReview(options)).rejects.toThrow(/API key was rejected/);
    expect(generateBriefing).toHaveBeenCalledTimes(1);
    expect(generateCodeReview).not.toHaveBeenCalled();
  });

  it("cleans the checkout up even when the review fails", async () => {
    vi.mocked(generateCodeReview).mockRejectedValue(new Error("boom"));
    await expect(runPrReview(options)).rejects.toThrow("boom");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
