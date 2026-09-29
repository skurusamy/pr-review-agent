import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type Response } from "express";
import { loadSecrets } from "./secrets.js";
import { parsePrUrl, type PrReference } from "./prUrl.js";
import { runFix } from "./fixRun.js";
import { runBrief } from "./briefRun.js";
import { z } from "zod";
import { runCodeReview } from "./codeReviewRun.js";
import { postableReviewSchema } from "./codeReview/postReview.js";
import { createOctokit } from "./github/client.js";
import { postBriefing, postReview } from "./prActions.js";
import { fetchPrSummary } from "./prSummary.js";
import { startNdjson, streamRun } from "./streamRun.js";
import { classifyLogLine } from "./logFormat.js";
import { formatError } from "./errorLog.js";
import { FileRunStore, isRunId } from "./runRecord/runStore.js";
import {
  ApplyNotAllowedError,
  applyRun,
  assertApplicable,
  githubApplyDeps,
} from "./applyRun.js";
import {
  DEFAULT_RUNS_MAX,
  pruneRuns,
  sweepOrphanedRuns,
} from "./runRecord/maintenance.js";

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

const runsMax = Number(process.env.RUNS_MAX) || DEFAULT_RUNS_MAX;

// One JSON file per run. Ephemeral on Cloud Run's disk until a real backend
// replaces FileRunStore behind the RunStore interface.
const runStore = new FileRunStore(
  process.env.RUNS_DIR ?? join(__dirname, "..", "data", "runs"),
);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

// Parses the pasted PR link, or answers 400 and returns undefined.
function parseOrReject(res: Response, prUrl: string): PrReference | undefined {
  try {
    return parsePrUrl(prUrl);
  } catch (error) {
    res.status(400).json({ error: formatError(error) });
    return undefined;
  }
}

// One run's full record. The results view refetches it after a dry run, to
// get what only the server holds (the PR, patches, any earlier apply).
app.get("/runs/:id", async (req, res) => {
  const record = isRunId(req.params.id)
    ? await runStore.get(req.params.id)
    : undefined;
  if (!record) {
    res.status(404).json({ error: "No such run." });
    return;
  }
  res.json(record);
});

// Runs being applied right now, so two people (or two clicks) can't apply the
// same dry run at once. In-process: fine for one server instance.
const applying = new Set<string>();

// Replays a dry run's saved results onto the PR (see applyRun). Streams the
// same NDJSON log lines as the other endpoints, ending in a {kind: "result"}
// line with the AppliedInfo, and writes that back onto the original record.
// Deliberately not tied to the client staying connected: aborting half way
// through a push would be worse than finishing.
app.post("/runs/:id/apply", async (req, res) => {
  const id = req.params.id;
  const record = isRunId(id) ? await runStore.get(id) : undefined;
  if (!record) {
    res.status(404).json({ error: "No such run." });
    return;
  }
  try {
    assertApplicable(record);
  } catch (error) {
    const status =
      error instanceof ApplyNotAllowedError && error.code === "already-applied"
        ? 409
        : 400;
    res.status(status).json({ error: formatError(error) });
    return;
  }
  if (applying.has(id)) {
    res.status(409).json({ error: "This run is already being applied." });
    return;
  }
  applying.add(id);

  const send = startNdjson(res);

  const label = `[apply ${id} ${record.pr.owner}/${record.pr.repo}#${record.pr.prNumber}]`;
  console.log(`${label} started`);
  const rawLog = [...record.rawLog];
  const log = (line: string): void => {
    const entry = { kind: classifyLogLine(line), text: line.trim() };
    rawLog.push(entry);
    send(entry);
  };

  try {
    const octokit = createOctokit(secrets.githubToken);
    const applied = await applyRun({
      record,
      deps: githubApplyDeps(octokit, record.pr, secrets.githubToken),
      log,
      // Saved as it goes, so a crash after the push still remembers it.
      onProgress: (progress) =>
        runStore.save({ ...record, rawLog, applied: progress }),
    });
    await runStore.save({ ...record, rawLog, applied });
    send({ kind: "result", text: JSON.stringify(applied) });
    send({ kind: "done", text: "" });
    console.log(`${label} finished (complete=${applied.complete})`);
  } catch (error) {
    send({ kind: "error", text: formatError(error) });
    console.log(`${label} failed: ${formatError(error)}`);
  } finally {
    applying.delete(id);
    res.end();
  }
});

// The PR card's data, for "Load PR": what the PR is, before any action runs.
app.get("/pr", async (req, res) => {
  const pr = parseOrReject(res, String(req.query.prUrl ?? ""));
  if (!pr) return;
  try {
    res.json(await fetchPrSummary(createOctokit(secrets.githubToken), pr));
  } catch (error) {
    const status = (error as { status?: number }).status === 404 ? 404 : 502;
    res.status(status).json({ error: formatError(error) });
  }
});

app.post("/fix", async (req, res) => {
  const { prUrl, dryRun } = req.body as { prUrl?: string; dryRun?: boolean };
  const pr = parseOrReject(res, prUrl ?? "");
  if (!pr) return;

  // A run with a few comments can take a couple of minutes, so it streams.
  await streamRun({
    res,
    action: "fix",
    pr,
    // Saved as it progresses, so a dry run can still be applied to the PR
    // after a crash or Stop.
    record: { kind: "fix", store: runStore, runsMax },
    run: async ({ log, step, send, recorder, abortController }) => {
      await runFix({
        ...pr,
        onStep: step,
        dryRun: dryRun ?? true,
        githubToken: secrets.githubToken,
        log,
        onEvent: (event) => {
          recorder?.event(event);
          send({ kind: "event", event });
        },
        abortController,
      });
    },
  });
});

// A Code Review. The Markdown rides as the {kind: "result"} line, for the
// download; the structured review rides as one {kind: "data"} line, which is
// what the Findings panel renders from (and what posting needs), rather than
// the UI re-parsing Markdown. Not saved as a run record yet -- see the map's
// note on Findings joining the run record.
app.post("/review", async (req, res) => {
  const { prUrl } = req.body as { prUrl?: string };
  const pr = parseOrReject(res, prUrl ?? "");
  if (!pr) return;

  await streamRun({
    res,
    action: "review",
    pr,
    run: async ({ log, step, send, abortController }) => {
      const result = await runCodeReview({
        ...pr,
        onStep: step,
        githubToken: secrets.githubToken,
        log,
        abortController,
      });
      send({
        kind: "data",
        data: {
          title: result.title,
          prUrl: result.prUrl,
          headSha: result.headSha,
          review: result.review,
        },
      });
      send({ kind: "result", text: result.markdown });
    },
  });
});

const postReviewRequestSchema = z.object({
  prUrl: z.string(),
  headSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  review: postableReviewSchema,
});

// Posting a Code Review is a separate, explicit step from generating it. The
// review comes back from the browser, so its shape is validated here rather
// than trusted.
app.post("/review/post", async (req, res) => {
  const parsed = postReviewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    res.status(400).json({ error: `Invalid review to post (${problems}).` });
    return;
  }
  const pr = parseOrReject(res, parsed.data.prUrl);
  if (!pr) return;

  try {
    const result = await postReview(
      secrets.githubToken,
      pr,
      parsed.data.review,
      parsed.data.headSha,
    );
    if (!result.created) {
      res.status(409).json({
        error:
          "You already have a pending review on this PR. Submit or dismiss it on GitHub first.",
      });
      return;
    }
    res.json({
      url: result.url,
      reviewId: result.reviewId,
      commentCount: result.commentCount,
    });
  } catch (error) {
    res.status(500).json({ error: formatError(error) });
  }
});

app.post("/brief", async (req, res) => {
  const { prUrl } = req.body as { prUrl?: string };
  const pr = parseOrReject(res, prUrl ?? "");
  if (!pr) return;

  // The rendered Markdown rides as one {kind: "result"} line rather than a
  // separate response, so this stays a single request like the others.
  await streamRun({
    res,
    action: "brief",
    pr,
    record: { kind: "briefing", store: runStore, runsMax },
    run: async ({ log, step, send, recorder, abortController }) => {
      const markdown = await runBrief({
        ...pr,
        onStep: step,
        githubToken: secrets.githubToken,
        log,
        abortController,
      });
      recorder?.setBriefing(markdown);
      send({ kind: "result", text: markdown });
    },
  });
});

app.post("/brief/post", async (req, res) => {
  const { prUrl, markdown } = req.body as { prUrl?: string; markdown?: string };
  const pr = parseOrReject(res, prUrl ?? "");
  if (!pr) return;
  if (!markdown) {
    res.status(400).json({ error: "Missing markdown to post." });
    return;
  }

  try {
    res.json(await postBriefing(secrets.githubToken, pr, markdown));
  } catch (error) {
    res.status(500).json({ error: formatError(error) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  // Anything still "running" at startup belonged to a process that is gone.
  void sweepOrphanedRuns(runStore)
    .then(() => pruneRuns(runStore, runsMax))
    .catch((error) => console.error("Run store maintenance failed:", error));
  app.listen(PORT, () => {
    console.log(`pr-review-agent UI listening on http://localhost:${PORT}`);
  });
}

export { app };
