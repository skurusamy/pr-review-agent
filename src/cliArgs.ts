export interface FixCommandArgs {
  command: "fix";
  owner: string;
  repo: string;
  prNumber: number;
  dryRun: boolean;
}

export interface BriefCommandArgs {
  command: "brief";
  owner: string;
  repo: string;
  prNumber: number;
  post: boolean;
}

export type CliArgs = FixCommandArgs | BriefCommandArgs;

const USAGE =
  "Usage: pr-review-agent fix <owner/repo> <pr-number> [--dry-run]\n   or: pr-review-agent brief <owner/repo> <pr-number> [--post]";

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
    };
  }

  if (command === "brief") {
    const { owner, repo, prNumber } = parseOwnerRepoAndPr(
      ownerRepo,
      prNumberRaw,
    );
    return {
      command: "brief",
      owner,
      repo,
      prNumber,
      post: rest.includes("--post"),
    };
  }

  throw new Error(`Unknown command "${command ?? ""}". ${USAGE}`);
}
