import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { loadSecrets } from "./secrets.js";
import { parsePrUrl } from "./prUrl.js";
import { runReview } from "./reviewRun.js";

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

  const lines: string[] = [];
  try {
    await runReview({
      owner: reference.owner,
      repo: reference.repo,
      prNumber: reference.prNumber,
      dryRun: dryRun ?? true,
      githubToken: secrets.githubToken,
      log: (line) => lines.push(line),
    });
    res.json({ log: lines.join("\n") });
  } catch (error) {
    res.status(500).json({
      log: lines.join("\n"),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`pr-review-agent UI listening on http://localhost:${PORT}`);
  });
}

export { app };
