import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  extractIssueReferences,
  fetchLinkedIssues,
  formatLinkedIssuesForPrompt,
  MAX_BODY_CHARS,
  MAX_LINKED_ISSUES,
} from "./linkedIssues.js";

const ref = { owner: "Acme", repo: "widgets", prNumber: 50 };
const extract = (text: string) => extractIssueReferences(text, ref);

describe("extractIssueReferences", () => {
  it("finds a bare #number", () => {
    expect(extract("Fixes #12")).toEqual([12]);
  });

  it("finds several, in order of first appearance, without duplicates", () => {
    expect(
      extract("Closes #30. Related to #12 and #30 again, plus #7"),
    ).toEqual([30, 12, 7]);
  });

  it("finds a full same-repo issue or PR link, case-insensitively", () => {
    expect(
      extract(
        "See https://github.com/acme/widgets/issues/12 and https://github.com/ACME/Widgets/pull/9#discussion_r1",
      ),
    ).toEqual([12, 9]);
  });

  it("finds an owner/repo#number reference to this repo", () => {
    expect(extract("Fixes acme/widgets#44")).toEqual([44]);
  });

  it("ignores references to other repos", () => {
    expect(
      extract(
        "Fixes other/repo#5, see https://github.com/other/repo/issues/6 and https://github.com/acme/other-repo/issues/7",
      ),
    ).toEqual([]);
  });

  it("does not count a URL as two references", () => {
    expect(extract("https://github.com/acme/widgets/issues/12")).toEqual([12]);
  });

  it("leaves out the PR itself", () => {
    expect(extract("This is #50, follow-up to #49")).toEqual([49]);
  });

  it("ignores things that only look like references", () => {
    expect(
      extract(
        [
          "Colour is &#39;red&#39;",
          "anchor: https://example.com/page#123",
          "heading ## 5 and ###",
          "a word#77 and path/file#88",
          "issue # 9",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("accepts a reference at the very start, after punctuation, and in brackets", () => {
    expect(extract('#1 is the start, (#2), [#3] and "#4"')).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("returns nothing for empty text or text without references", () => {
    expect(extract("")).toEqual([]);
    expect(extract("Just some words, no issue numbers")).toEqual([]);
  });
});

function fakeOctokit(issues: Record<number, unknown>): {
  octokit: Octokit;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async ({ issue_number }: { issue_number: number }) => {
    const data = issues[issue_number];
    if (!data) throw Object.assign(new Error("Not Found"), { status: 404 });
    return { data };
  });
  return { octokit: { rest: { issues: { get } } } as unknown as Octokit, get };
}

describe("fetchLinkedIssues", () => {
  it("reads each referenced issue and returns its title, state and description", async () => {
    const { octokit, get } = fakeOctokit({
      12: { title: "Drops the last page", state: "open", body: "Details." },
    });
    const issues = await fetchLinkedIssues(octokit, ref, "Fixes #12", () => {});
    expect(issues).toEqual([
      {
        number: 12,
        kind: "issue",
        title: "Drops the last page",
        state: "open",
        body: "Details.",
      },
    ]);
    expect(get).toHaveBeenCalledWith({
      owner: "Acme",
      repo: "widgets",
      issue_number: 12,
    });
  });

  it("labels a pull request as one", async () => {
    const { octokit } = fakeOctokit({
      9: {
        title: "Earlier work",
        state: "closed",
        body: null,
        pull_request: {},
      },
    });
    const [pr] = await fetchLinkedIssues(octokit, ref, "#9", () => {});
    expect(pr).toMatchObject({ kind: "pull request", body: "" });
  });

  it("makes no API call when the text has no references", async () => {
    const { octokit, get } = fakeOctokit({});
    expect(
      await fetchLinkedIssues(octokit, ref, "nothing here", () => {}),
    ).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("skips one it can't read, logs it, and keeps the rest", async () => {
    const { octokit } = fakeOctokit({
      2: { title: "Readable", state: "open", body: "" },
    });
    const log = vi.fn();
    const issues = await fetchLinkedIssues(octokit, ref, "#1 and #2", log);
    expect(issues.map((i) => i.number)).toEqual([2]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Could not read #1"),
    );
  });

  it(`reads at most ${MAX_LINKED_ISSUES} and says so`, async () => {
    const all = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        i + 1,
        { title: `t${i + 1}`, state: "open", body: "" },
      ]),
    );
    const { octokit, get } = fakeOctokit(all);
    const log = vi.fn();
    const issues = await fetchLinkedIssues(
      octokit,
      ref,
      "#1 #2 #3 #4 #5 #6 #7 #8 #9",
      log,
    );
    expect(issues).toHaveLength(MAX_LINKED_ISSUES);
    expect(get).toHaveBeenCalledTimes(MAX_LINKED_ISSUES);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Found 9 linked issues"),
    );
  });

  it("cuts an enormous description so it can't crowd out the diff", async () => {
    const { octokit } = fakeOctokit({
      3: {
        title: "Long",
        state: "open",
        body: "x".repeat(MAX_BODY_CHARS + 500),
      },
    });
    const [issue] = await fetchLinkedIssues(octokit, ref, "#3", () => {});
    expect(issue!.body.length).toBeLessThan(MAX_BODY_CHARS + 50);
    expect(issue!.body).toContain("(truncated)");
  });
});

describe("formatLinkedIssuesForPrompt", () => {
  it("is empty when there are no issues", () => {
    expect(formatLinkedIssuesForPrompt([])).toBe("");
  });

  it("indents each description under its heading line", () => {
    const text = formatLinkedIssuesForPrompt([
      { number: 1, kind: "issue", title: "A", state: "open", body: "l1\nl2" },
    ]);
    expect(text).toContain("- #1 [issue, open] A\n  l1\n  l2");
  });
});
