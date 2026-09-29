import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "./cliArgs.js";
import { loadSecrets } from "./secrets.js";
import { runFix } from "./fixRun.js";
import { runBrief } from "./briefRun.js";
import { runCodeReview } from "./codeReviewRun.js";
import { postCodeReviewAsPending } from "./codeReview/postReview.js";
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

  if (args.command === "review") {
    const { markdown, review, headSha } = await runCodeReview({
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      githubToken,
      log,
    });
    console.log(`\n${markdown}`);

    // Same as brief: the file is written for the human to keep or share;
    // nothing is posted to GitHub by this command.
    const fileName = `code-review-${args.owner}-${args.repo}-${args.prNumber}.md`;
    await writeFile(fileName, markdown, "utf-8");
    log(`\nWrote ${fileName}`);

    if (args.post) {
      // A separate, explicit step, like brief's --post. What it creates is a
      // PENDING review: private to you until you submit it on GitHub.
      const result = await postCodeReviewAsPending(
        createOctokit(githubToken),
        args.owner,
        args.repo,
        args.prNumber,
        review,
        headSha,
      );
      log(
        result.created
          ? `Created a pending review (id ${result.reviewId}) with ${result.commentCount} comment(s): ${result.url}\nSubmit it on GitHub when ready.`
          : "Could not create a pending review: one already exists. Submit or dismiss it on GitHub first.",
      );
    }
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
