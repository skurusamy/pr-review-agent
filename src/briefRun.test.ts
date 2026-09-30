import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBrief } from "./briefRun.js";
import { fetchPrContext } from "./briefing/fetchPrContext.js";
import { fetchLinkedIssuesOfPr } from "./briefing/linkedIssues.js";
import { generateBriefing } from "./briefing/generateBriefing.js";
import { checkoutPullRequestHead } from "./github/checkout.js";

vi.mock("./github/client.js", () => ({ createOctokit: () => ({}) }));
vi.mock("./briefing/fetchPrContext.js", () => ({ fetchPrContext: vi.fn() }));
vi.mock("./briefing/linkedIssues.js", () => ({
  fetchLinkedIssuesOfPr: vi.fn(),
}));
vi.mock("./briefing/generateBriefing.js", () => ({
  generateBriefing: vi.fn(),
}));
vi.mock("./github/checkout.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github/checkout.js")>()),
  checkoutPullRequestHead: vi.fn(),
}));

const cleanup = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchPrContext).mockResolvedValue({
    title: "T",
    description: "D",
    comments: [],
    diff: "",
    headSha: "abc",
  });
  vi.mocked(fetchLinkedIssuesOfPr).mockResolvedValue([]);
  vi.mocked(generateBriefing).mockResolvedValue({
    summary: "s",
    mermaidDiagram: "flowchart LR\n A --> B",
    risks: [],
    changedFiles: [],
    linkedIssues: [],
  });
  cleanup.mockResolvedValue(undefined);
  vi.mocked(checkoutPullRequestHead).mockResolvedValue({
    dir: "/tmp/co",
    headRef: "x",
    headSha: "abc",
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

describe("runBrief", () => {
  it("a quick briefing never checks anything out", async () => {
    await runBrief(options);
    expect(checkoutPullRequestHead).not.toHaveBeenCalled();
    expect(vi.mocked(generateBriefing).mock.calls[0]![3]).toBeUndefined();
  });

  it("a deeper briefing takes a read-only checkout, hands its dir to the model, and cleans up", async () => {
    const steps: string[] = [];
    await runBrief({
      ...options,
      mode: "deeper",
      onStep: (s) => steps.push(s),
    });
    expect(vi.mocked(checkoutPullRequestHead).mock.calls[0]![5]).toEqual({
      readOnly: true,
    });
    expect(vi.mocked(generateBriefing).mock.calls[0]![3]).toEqual({
      checkoutDir: "/tmp/co",
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(steps).toEqual([
      "Fetching pull request",
      "Checking out the branch",
      "Generating briefing",
    ]);
  });

  it("cleans the checkout up even when the briefing fails", async () => {
    vi.mocked(generateBriefing).mockRejectedValue(new Error("boom"));
    await expect(runBrief({ ...options, mode: "deeper" })).rejects.toThrow(
      "boom",
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
