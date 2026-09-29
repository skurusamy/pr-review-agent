import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "./cliArgs.js";
import { loadSecrets } from "./secrets.js";
import { runFix } from "./fixRun.js";
import { runBrief } from "./briefRun.js";
import { runCodeReview } from "./codeReviewRun.js";
import {
  describePostedReview,
  markdownFileName,
  postBriefing,
  postReview,
} from "./prActions.js";
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

  if (args.command === "fix") {
    await runFix({
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      dryRun: args.dryRun,
      githubToken,
      log,
    });
    return;
  }

  const pr = { owner: args.owner, repo: args.repo, prNumber: args.prNumber };

  if (args.command === "review") {
    const { markdown, review, headSha } = await runCodeReview({
      ...pr,
      githubToken,
      log,
    });
    console.log(`\n${markdown}`);

    // The file is written for the human to keep or share; nothing is posted
    // to GitHub by this command unless --post says so.
    const fileName = markdownFileName("code-review", pr);
    await writeFile(fileName, markdown, "utf-8");
    log(`\nWrote ${fileName}`);

    if (args.post) {
      log(
        describePostedReview(
          await postReview(githubToken, pr, review, headSha),
        ),
      );
    }
    return;
  }

  const markdown = await runBrief({ ...pr, githubToken, log });
  console.log(`\n${markdown}`);

  const fileName = markdownFileName("pr-briefing", pr);
  await writeFile(fileName, markdown, "utf-8");
  log(`\nWrote ${fileName}`);

  if (args.post) {
    const { url } = await postBriefing(githubToken, pr, markdown);
    log(`Posted: ${url}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(paint(formatError(error), "bold", "red"));
    process.exit(1);
  });
}
