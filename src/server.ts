import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { loadSecrets } from "./secrets.js";
import { parsePrUrl } from "./prUrl.js";
import { runFix } from "./fixRun.js";
import { runBrief } from "./briefRun.js";
import { z } from "zod";
import { runCodeReview } from "./codeReviewRun.js";
import {
  postableReviewSchema,
  postCodeReviewAsPending,
} from "./codeReview/postReview.js";
import { createOctokit } from "./github/client.js";
import { postBriefingComment } from "./briefing/postBriefingComment.js";
import { classifyLogLine } from "./logFormat.js";
import { formatError } from "./errorLog.js";
import { FileRunStore, isRunId } from "./runRecord/runStore.js";
import { RunRecorder } from "./runRecord/recorder.js";
import { summarize } from "./runRecord/summary.js";
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

// A small counter, only for disambiguating overlapping requests in this
// terminal's output. A run's durable identity is its RunRecorder id.
let requestCounter = 0;

const runsMax = Number(process.env.RUNS_MAX) || DEFAULT_RUNS_MAX;

// One JSON file per run. Ephemeral on Cloud Run's disk until a real backend
// replaces FileRunStore behind the RunStore interface.
const runStore = new FileRunStore(
  process.env.RUNS_DIR ?? join(__dirname, "..", "data", "runs"),
);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

// Light summaries only (no logs, no patches), newest first -- what a history
// list needs. The full record is GET /runs/:id.
app.get("/runs", async (req, res) => {
  const requested = Number(req.query.limit);
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, 200)
      : 50;
  const ids = (await runStore.listIds()).slice(0, limit);
  const records = await Promise.all(ids.map((id) => runStore.get(id)));
  res.json(records.flatMap((record) => (record ? [summarize(record)] : [])));
});

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

  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();
  const send = (entry: { kind: string; text: string }): void => {
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(entry)}\n`);
  };

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

app.post("/fix", async (req, res) => {
  const { prUrl, dryRun } = req.body as { prUrl?: string; dryRun?: boolean };

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res.status(400).json({ error: formatError(error) });
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

  const requestId = ++requestCounter;
  const label = `[review #${requestId} ${reference.owner}/${reference.repo}#${reference.prNumber}]`;
  console.log(`${label} started`);

  // Real cancellation, not just the UI giving up: the SDK's query() takes
  // this same AbortController and tears down its subprocess when aborted,
  // instead of letting an unwanted run keep burning turns after the person
  // clicked Stop. This listens on the RESPONSE, not the request: an
  // IncomingMessage's "close" fires as soon as its body has been fully read
  // (right after express.json() consumes the POST body), long before the
  // client actually disconnects -- listening there aborted every run almost
  // instantly. The response's "close" fires when the underlying connection
  // ends, and res.writableEnded is false only if that happened before we
  // finished on our own -- i.e. a real premature disconnect (a Stop click
  // aborts the browser's fetch, which closes the connection; a closed tab
  // does the same).
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log(`${label} client disconnected -- aborting`);
      abortController.abort();
    }
  });

  const send = (entry: { kind: string; [key: string]: unknown }): void => {
    // The client may already be gone (that's exactly why we'd be aborting)
    // -- writing to an ended response throws, and that throw has nothing to
    // do with the run itself, so it shouldn't surface as this run's error.
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(entry)}\n`);
  };

  // The run's durable record: saved as it progresses, so history survives a
  // crash or Stop. Its id goes to the client first thing.
  const recorder = new RunRecorder(runStore, {
    kind: "fix",
    pr: reference,
  });
  await recorder.start();
  send({ kind: "run", text: recorder.id });

  try {
    await runFix({
      owner: reference.owner,
      repo: reference.repo,
      prNumber: reference.prNumber,
      dryRun: dryRun ?? true,
      githubToken: secrets.githubToken,
      log: (line) => {
        const entry = { kind: classifyLogLine(line), text: line.trim() };
        recorder.log(entry);
        send(entry);
      },
      onEvent: (event) => {
        recorder.event(event);
        send({ kind: "event", event });
      },
      abortController,
    });
    await recorder.finish("completed");
    send({ kind: "done", text: "" });
    console.log(`${label} finished`);
  } catch (error) {
    if (!abortController.signal.aborted) {
      await recorder.finish("failed", formatError(error));
      send({ kind: "error", text: formatError(error) });
      console.log(`${label} failed: ${formatError(error)}`);
    } else {
      await recorder.finish("stopped");
      console.log(`${label} stopped`);
    }
  } finally {
    res.end();
    // Keep the store bounded; nothing waits on this or depends on it.
    void pruneRuns(runStore, runsMax).catch(() => {});
  }
});

// A Code Review: same streamed-NDJSON shape and real-cancellation wiring as
// /brief (see the comments there and on /fix). The Markdown rides as the
// {kind: "result"} line, for the download; the structured review rides as one
// {kind: "data"} line, which is what the Findings panel renders from (and what
// posting will need), rather than the UI re-parsing Markdown. Not saved as a
// run record yet -- see the map's note on Findings joining run history.
app.post("/review", async (req, res) => {
  const { prUrl } = req.body as { prUrl?: string };

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res.status(400).json({ error: formatError(error) });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();

  const requestId = ++requestCounter;
  const label = `[review #${requestId} ${reference.owner}/${reference.repo}#${reference.prNumber}]`;
  console.log(`${label} started`);

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log(`${label} client disconnected -- aborting`);
      abortController.abort();
    }
  });

  const send = (entry: {
    kind: string;
    text?: string;
    data?: unknown;
  }): void => {
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(entry)}\n`);
  };

  try {
    const result = await runCodeReview({
      owner: reference.owner,
      repo: reference.repo,
      prNumber: reference.prNumber,
      githubToken: secrets.githubToken,
      log: (line) => send({ kind: classifyLogLine(line), text: line.trim() }),
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
    send({ kind: "done", text: "" });
    console.log(`${label} finished`);
  } catch (error) {
    if (!abortController.signal.aborted) {
      send({ kind: "error", text: formatError(error) });
      console.log(`${label} failed: ${formatError(error)}`);
    } else {
      console.log(`${label} stopped`);
    }
  } finally {
    res.end();
  }
});

const postReviewRequestSchema = z.object({
  prUrl: z.string(),
  headSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  review: postableReviewSchema,
});

// Posting a Code Review is a separate, explicit step from generating it. It
// creates a PENDING review (private to you until you submit it on GitHub),
// never a submitted one. The review comes back from the browser, so its
// shape is validated here rather than trusted.
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

  let reference;
  try {
    reference = parsePrUrl(parsed.data.prUrl);
  } catch (error) {
    res.status(400).json({ error: formatError(error) });
    return;
  }

  try {
    const result = await postCodeReviewAsPending(
      createOctokit(secrets.githubToken),
      reference.owner,
      reference.repo,
      reference.prNumber,
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

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res.status(400).json({ error: formatError(error) });
    return;
  }

  // Same streamed-NDJSON shape as /fix (see the comment there); the
  // final rendered Markdown rides as one {kind: "result"} line rather than
  // a separate response, so this endpoint stays a single request/response
  // like /fix instead of needing a second round trip to fetch the result.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();

  const requestId = ++requestCounter;
  const label = `[brief #${requestId} ${reference.owner}/${reference.repo}#${reference.prNumber}]`;
  console.log(`${label} started`);

  // Same real-cancellation wiring as /fix -- see the comment there for
  // why this listens on the response rather than the request.
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log(`${label} client disconnected -- aborting`);
      abortController.abort();
    }
  });

  const send = (entry: { kind: string; text: string }): void => {
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(entry)}\n`);
  };

  const recorder = new RunRecorder(runStore, {
    kind: "briefing",
    pr: reference,
  });
  await recorder.start();
  send({ kind: "run", text: recorder.id });

  try {
    const markdown = await runBrief({
      owner: reference.owner,
      repo: reference.repo,
      prNumber: reference.prNumber,
      githubToken: secrets.githubToken,
      log: (line) => {
        const entry = { kind: classifyLogLine(line), text: line.trim() };
        recorder.log(entry);
        send(entry);
      },
      abortController,
    });
    recorder.setBriefing(markdown);
    await recorder.finish("completed");
    send({ kind: "result", text: markdown });
    send({ kind: "done", text: "" });
    console.log(`${label} finished`);
  } catch (error) {
    if (!abortController.signal.aborted) {
      await recorder.finish("failed", formatError(error));
      send({ kind: "error", text: formatError(error) });
      console.log(`${label} failed: ${formatError(error)}`);
    } else {
      await recorder.finish("stopped");
      console.log(`${label} stopped`);
    }
  } finally {
    res.end();
    // Keep the store bounded; nothing waits on this or depends on it.
    void pruneRuns(runStore, runsMax).catch(() => {});
  }
});

app.post("/brief/post", async (req, res) => {
  const { prUrl, markdown } = req.body as { prUrl?: string; markdown?: string };

  let reference;
  try {
    reference = parsePrUrl(prUrl ?? "");
  } catch (error) {
    res.status(400).json({ error: formatError(error) });
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
