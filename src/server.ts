import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { loadSecrets } from "./secrets.js";
import { parsePrUrl } from "./prUrl.js";
import { runReview } from "./reviewRun.js";
import { runBrief } from "./briefRun.js";
import { createOctokit } from "./github/client.js";
import { postBriefingComment } from "./briefing/postBriefingComment.js";
import { classifyLogLine } from "./logFormat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Reading PORT (defaulting locally to 4127, deliberately not 3000 -- that's
// the first port half of all local dev tooling reaches for, so it's the one
// most likely to already be taken by something else) is what makes this the
// same code Cloud Run would run later, not just similar to it -- Cloud Run
// injects PORT and expects the container to listen on it.
const PORT = Number(process.env.PORT ?? 4127);

// Fails fast here, before the server ever starts accepting requests --
// same philosophy as the CLI, just moved from "before running the command"
// to "before listening" since there's no per-invocation moment to check.
const secrets = loadSecrets();

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

app.post("/review", async (req, res) => {
  const { prUrl, dryRun } = req.body as { prUrl?: string; dryRun?: boolean };

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : String(error) });
    return;
  }

  // Streamed as newline-delimited JSON, one object per log line, instead of
  // one blob returned at the end -- a run with a few comments can take a
  // couple of minutes, and the browser renders each line as it arrives.
  // Headers are sent 200 immediately, before we know whether the run will
  // succeed, so failure is reported as an in-band {kind: "error"} line
  // rather than an HTTP error status (which can't change after the body has
  // started streaming).
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();

  const send = (entry: { kind: string; text: string }): void => {
    res.write(`${JSON.stringify(entry)}\n`);
  };

  try {
    await runReview({
      owner: reference.owner,
      repo: reference.repo,
      prNumber: reference.prNumber,
      dryRun: dryRun ?? true,
      githubToken: secrets.githubToken,
      log: (line) => send({ kind: classifyLogLine(line), text: line.trim() }),
    });
    send({ kind: "done", text: "" });
  } catch (error) {
    send({
      kind: "error",
      text: error instanceof Error ? error.message : String(error),
    });
  } finally {
    res.end();
  }
});

app.post("/brief", async (req, res) => {
  const { prUrl } = req.body as { prUrl?: string };

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : String(error) });
    return;
  }

  // Same streamed-NDJSON shape as /review (see the comment there); the
  // final rendered Markdown rides as one {kind: "result"} line rather than
  // a separate response, so this endpoint stays a single request/response
  // like /review instead of needing a second round trip to fetch the result.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();

  const send = (entry: { kind: string; text: string }): void => {
    res.write(`${JSON.stringify(entry)}\n`);
  };

  try {
    const markdown = await runBrief({
      owner: reference.owner,
      repo: reference.repo,
      prNumber: reference.prNumber,
      githubToken: secrets.githubToken,
      log: (line) => send({ kind: classifyLogLine(line), text: line.trim() }),
    });
    send({ kind: "result", text: markdown });
    send({ kind: "done", text: "" });
  } catch (error) {
    send({
      kind: "error",
      text: error instanceof Error ? error.message : String(error),
    });
  } finally {
    res.end();
  }
});

app.post("/brief/post", async (req, res) => {
  const { prUrl, markdown } = req.body as { prUrl?: string; markdown?: string };

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (!markdown) {
    res.status(400).json({ error: "Missing markdown to post." });
    return;
  }

  try {
    const octokit = createOctokit(secrets.githubToken);
    const { url } = await postBriefingComment(
      octokit,
      reference.owner,
      reference.repo,
      reference.prNumber,
      markdown,
    );
    res.json({ url });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`pr-review-agent UI listening on http://localhost:${PORT}`);
  });
}

export { app };
