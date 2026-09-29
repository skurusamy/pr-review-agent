import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "./cliArgs.js";
import { loadSecrets } from "./secrets.js";
import { runReview } from "./reviewRun.js";
import { runBrief } from "./briefRun.js";
import { createOctokit } from "./github/client.js";
import { postBriefingComment } from "./briefing/postBriefingComment.js";
import { colorizeLine } from "./cliLog.js";
import { paint } from "./ansi.js";
import { formatError } from "./errorLog.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Fails fast here if either secret is missing; the Claude Agent SDK reads
  // ANTHROPIC_API_KEY directly from process.env in its own subprocess, so
  // dotenv/config having already loaded .env is all that's needed for it.
  const { githubToken } = loadSecrets();
  const log = (line: string): void => console.log(colorizeLine(line));

  if (args.command === "review") {
    await runReview({
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      dryRun: args.dryRun,
      githubToken,
      log,
    });
    return;
  }

  const markdown = await runBrief({
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    githubToken,
    log,
  });
  console.log(`\n${markdown}`);

  const fileName = `pr-briefing-${args.owner}-${args.repo}-${args.prNumber}.md`;
  await writeFile(fileName, markdown, "utf-8");
  log(`\nWrote ${fileName}`);

  if (args.post) {
    // Posting is always a separate, explicit step from generating -- here,
    // that's the human having typed --post, not something the brief command
    // does by default.
    const octokit = createOctokit(githubToken);
    const { url } = await postBriefingComment(
      octokit,
      args.owner,
      args.repo,
      args.prNumber,
      markdown,
    );
    log(`Posted: ${url}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(paint(formatError(error), "bold", "red"));
    process.exit(1);
  });
}
