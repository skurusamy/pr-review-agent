import "dotenv/config";
import { parseArgs } from "./cliArgs.js";
import { loadSecrets } from "./secrets.js";
import { runReview } from "./reviewRun.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Fails fast here if either secret is missing; the Claude Agent SDK reads
  // ANTHROPIC_API_KEY directly from process.env in its own subprocess, so
  // dotenv/config having already loaded .env is all that's needed for it.
  const { githubToken } = loadSecrets();

  await runReview({
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    dryRun: args.dryRun,
    githubToken,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
