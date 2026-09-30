import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  appliesToAny,
  fetchRepoRules,
  formatRepoRulesForPrompt,
  globToRegExp,
  parseInstructionsFile,
} from "./repoRules.js";
import { MAX_SMELL_FINDINGS, standardsBullet } from "./standardsPrompt.js";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("globToRegExp", () => {
  const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

  it("** crosses folders, * does not", () => {
    expect(matches("**/*.ts", "src/deep/a.ts")).toBe(true);
    expect(matches("**/*.ts", "a.ts")).toBe(true);
    expect(matches("src/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "src/deep/a.ts")).toBe(false);
    expect(matches("src/**", "src/deep/a.ts")).toBe(true);
  });
  it("supports ? and {a,b}", () => {
    expect(matches("src/?.ts", "src/a.ts")).toBe(true);
    expect(matches("src/?.ts", "src/ab.ts")).toBe(false);
    expect(matches("**/*.{ts,tsx}", "a/b.tsx")).toBe(true);
    expect(matches("**/*.{ts,tsx}", "a/b.js")).toBe(false);
  });
  it("treats dots and other regex characters literally", () => {
    expect(matches("a.ts", "aXts")).toBe(false);
    expect(matches("a+b.ts", "a+b.ts")).toBe(true);
  });
});

describe("parseInstructionsFile", () => {
  it("reads applyTo from the frontmatter, quoted or not, comma separated", () => {
    expect(
      parseInstructionsFile('---\napplyTo: "**/*.ts,src/**"\n---\nUse strict.'),
    ).toEqual({ applyTo: ["**/*.ts", "src/**"], body: "Use strict." });
    expect(
      parseInstructionsFile("---\napplyTo: **/*.py\n---\nx").applyTo,
    ).toEqual(["**/*.py"]);
  });
  it("does not split a comma inside braces", () => {
    expect(
      parseInstructionsFile('---\napplyTo: "**/*.{ts,tsx},docs/**"\n---\nx')
        .applyTo,
    ).toEqual(["**/*.{ts,tsx}", "docs/**"]);
  });
  it("gives no globs to a file without applyTo, which therefore applies to nothing", () => {
    expect(parseInstructionsFile("just text").applyTo).toEqual([]);
    expect(appliesToAny([], ["a.ts"])).toBe(false);
  });
});

/** A fake repo: path -> text, or a directory listing. Records every ref it was asked for. */
function fakeRepo(
  files: Record<string, string>,
  dirs: Record<string, string[]> = {},
) {
  const refs: string[] = [];
  const getContent = vi.fn(
    async ({ path, ref }: { path: string; ref: string }) => {
      refs.push(ref);
      if (dirs[path]) {
        return {
          data: dirs[path]!.map((name) => ({
            type: "file",
            name,
            path: `${path}/${name}`,
          })),
        };
      }
      if (files[path] !== undefined) {
        return {
          data: {
            type: "file",
            content: b64(files[path]!),
            size: files[path]!.length,
          },
        };
      }
      throw Object.assign(new Error("Not Found"), { status: 404 });
    },
  );
  return {
    octokit: { rest: { repos: { getContent } } } as unknown as Octokit,
    getContent,
    refs,
  };
}

const opts = (changedPaths = ["src/a.ts"]) => ({
  owner: "o",
  repo: "r",
  baseSha: "base123",
  changedPaths,
});
const quiet = () => {};

describe("fetchRepoRules", () => {
  it("reads every rule file only at the base commit", async () => {
    const { octokit, refs } = fakeRepo({ "CONTRIBUTING.md": "Write tests." });
    const rules = await fetchRepoRules(octokit, opts(), quiet);
    expect(rules).toEqual([
      { path: "CONTRIBUTING.md", content: "Write tests." },
    ]);
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["base123"]));
  });

  it("returns nothing for a repo with no rule files, without failing", async () => {
    const { octokit } = fakeRepo({});
    expect(await fetchRepoRules(octokit, opts(), quiet)).toEqual([]);
  });

  it("skips a blank file", async () => {
    const { octokit } = fakeRepo({ "CONTRIBUTING.md": "  \n" });
    expect(await fetchRepoRules(octokit, opts(), quiet)).toEqual([]);
  });

  it("includes a path-specific file only when one of its globs matches a changed file", async () => {
    const { octokit } = fakeRepo(
      {
        ".github/instructions/ts.instructions.md":
          '---\napplyTo: "**/*.ts"\n---\nNo any.',
        ".github/instructions/py.instructions.md":
          '---\napplyTo: "**/*.py"\n---\nUse typing.',
        ".github/instructions/none.instructions.md": "no frontmatter",
      },
      {
        ".github/instructions": [
          "ts.instructions.md",
          "py.instructions.md",
          "none.instructions.md",
          "README.md",
        ],
      },
    );
    const rules = await fetchRepoRules(octokit, opts(["src/a.ts"]), quiet);
    expect(rules).toEqual([
      {
        path: ".github/instructions/ts.instructions.md",
        content: "No any.",
        appliesTo: ["**/*.ts"],
      },
    ]);
  });

  it("cuts a long file and stops at the total cap", async () => {
    const big = "x".repeat(9_000);
    const { octokit } = fakeRepo({
      ".github/copilot-instructions.md": big,
      "CONTRIBUTING.md": big,
      "CODING_STANDARDS.md": big,
      "docs/CODING_STANDARDS.md": big,
    });
    const rules = await fetchRepoRules(octokit, opts(), quiet);
    expect(rules[0]!.content.endsWith("[cut]")).toBe(true);
    expect(rules.reduce((n, r) => n + r.content.length, 0)).toBeLessThanOrEqual(
      20_100,
    );
    // Two full files, a third cut to what is left, and nothing after that.
    expect(rules).toHaveLength(3);
  });

  it("warns and reviews without rules when GitHub fails, instead of failing the review", async () => {
    const lines: string[] = [];
    const octokit = {
      rest: {
        repos: {
          getContent: vi
            .fn()
            .mockRejectedValue(
              Object.assign(new Error("rate limited"), { status: 403 }),
            ),
        },
      },
    } as unknown as Octokit;
    expect(await fetchRepoRules(octokit, opts(), (l) => lines.push(l))).toEqual(
      [],
    );
    expect(lines[0]).toMatch(
      /could not read the repo's rules \(rate limited\)/,
    );
  });
});

describe("formatRepoRulesForPrompt", () => {
  it("is empty without rules", () => {
    expect(formatRepoRulesForPrompt([])).toBe("");
  });
  it("names each file, says the base branch and calls them data", () => {
    const text = formatRepoRulesForPrompt([
      { path: "CONTRIBUTING.md", content: "Write tests." },
      {
        path: ".github/instructions/ts.instructions.md",
        content: "No any.",
        appliesTo: ["**/*.ts"],
      },
    ]);
    expect(text).toContain("--- CONTRIBUTING.md ---\nWrite tests.");
    expect(text).toContain("(applies to **/*.ts)");
    expect(text).toContain("base branch");
    expect(text).toContain("DATA");
  });
});

describe("standardsBullet", () => {
  it("always carries the smell baseline, capped, low severity, never overriding a documented rule", () => {
    const bullet = standardsBullet(false);
    expect(bullet).toContain(`at most ${MAX_SMELL_FINDINGS} clear code smells`);
    expect(bullet).toContain("always severity low");
    expect(bullet).toContain("Feature Envy");
    expect(bullet).toContain("already enforces");
    expect(bullet).not.toContain("written rules");
  });
  it("puts a documented rule first when the repo has rules, and says it beats the list", () => {
    const bullet = standardsBullet(true);
    expect(bullet.indexOf("written rules")).toBeLessThan(
      bullet.indexOf("smells"),
    );
    expect(bullet).toContain("always beats the smell list");
  });
});
