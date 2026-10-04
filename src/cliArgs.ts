export interface FixCommandArgs {
  command: "fix";
  owner: string;
  repo: string;
  prNumber: number;
  dryRun: boolean;
  includeResolved: boolean;
}

export interface BriefCommandArgs {
  command: "brief";
  owner: string;
  repo: string;
  prNumber: number;
  /** Also read the code in a read-only checkout (slower, costs more). */
  deeper: boolean;
}

export interface ReviewCommandArgs {
  command: "review";
  owner: string;
  repo: string;
  prNumber: number;
  post: boolean;
}

export type CliArgs = FixCommandArgs | BriefCommandArgs | ReviewCommandArgs;

const USAGE = [
  "Usage: pr-review-agent brief <owner/repo> <pr-number> [--deeper]",
  "   or: pr-review-agent review <owner/repo> <pr-number> [--post]",
  "   or: pr-review-agent fix <owner/repo> <pr-number> [--dry-run] [--include-resolved]",
].join("\n");

function parseOwnerRepoAndPr(
  ownerRepo: string | undefined,
  prNumberRaw: string | undefined,
): { owner: string; repo: string; prNumber: number } {
  if (!ownerRepo || !ownerRepo.includes("/")) {
    throw new Error(
      `Expected <owner/repo>, e.g. "skurusamy/pr-review-agent". ${USAGE}`,
    );
  }

  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) {
    throw new Error(
      `Expected <owner/repo>, e.g. "skurusamy/pr-review-agent". ${USAGE}`,
    );
  }

  const prNumber = Number(prNumberRaw);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(
      `Expected a positive PR number, got "${prNumberRaw ?? ""}". ${USAGE}`,
    );
  }

  return { owner, repo, prNumber };
}

export function parseArgs(argv: string[]): CliArgs {
  const [command, ownerRepo, prNumberRaw, ...rest] = argv;

  if (command === "fix") {
    const { owner, repo, prNumber } = parseOwnerRepoAndPr(
      ownerRepo,
      prNumberRaw,
    );
    return {
      command: "fix",
      owner,
      repo,
      prNumber,
      dryRun: rest.includes("--dry-run"),
      includeResolved: rest.includes("--include-resolved"),
    };
  }

  if (command === "brief") {
    const { owner, repo, prNumber } = parseOwnerRepoAndPr(
      ownerRepo,
      prNumberRaw,
    );
    // Refused rather than ignored: a person who passes it expects a post.
    if (rest.includes("--post")) {
      throw new Error(
        `A briefing is never posted to GitHub (only a review is). Drop --post to write the briefing to a file. ${USAGE}`,
      );
    }
    return {
      command: "brief",
      owner,
      repo,
      prNumber,
      deeper: rest.includes("--deeper"),
    };
  }

  if (command === "review") {
    const { owner, repo, prNumber } = parseOwnerRepoAndPr(
      ownerRepo,
      prNumberRaw,
    );
    return {
      command: "review",
      owner,
      repo,
      prNumber,
      post: rest.includes("--post"),
    };
  }

  throw new Error(`Unknown command "${command ?? ""}". ${USAGE}`);
}
