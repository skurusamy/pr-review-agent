import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { loadSecrets } from "./secrets.js";
import { parsePrUrl } from "./prUrl.js";
import { runReview } from "./reviewRun.js";
import { classifyLogLine } from "./logFormat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Reading PORT (defaulting locally to 3000) is what makes this the same
// code Cloud Run would run later, not just similar to it -- Cloud Run
// injects PORT and expects the container to listen on it.
const PORT = Number(process.env.PORT ?? 3000);

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

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`pr-review-agent UI listening on http://localhost:${PORT}`);
  });
}

export { app };
