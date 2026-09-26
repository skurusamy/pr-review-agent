export interface ReviewCommandArgs {
  command: "review";
  owner: string;
  repo: string;
  prNumber: number;
  dryRun: boolean;
}

const USAGE =
  "Usage: pr-review-agent review <owner/repo> <pr-number> [--dry-run]";

export function parseArgs(argv: string[]): ReviewCommandArgs {
  const [command, ownerRepo, prNumberRaw, ...rest] = argv;

  if (command !== "review") {
    throw new Error(`Unknown command "${command ?? ""}". ${USAGE}`);
  }
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

  return {
    command: "review",
    owner,
    repo,
    prNumber,
    dryRun: rest.includes("--dry-run"),
  };
}
