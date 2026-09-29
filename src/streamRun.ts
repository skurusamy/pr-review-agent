import type { Response } from "express";
import type { PrReference } from "./prUrl.js";
import { classifyLogLine } from "./logFormat.js";
import { formatError } from "./errorLog.js";
import { RunRecorder } from "./runRecord/recorder.js";
import { pruneRuns } from "./runRecord/maintenance.js";
import type { RunStore } from "./runRecord/runStore.js";
import type { LogEntry } from "./runRecord/types.js";

/** One line of the newline-delimited JSON a streamed run writes to the browser. */
export interface StreamEntry {
  kind: string;
  text?: string;
  data?: unknown;
  event?: unknown;
}

export type SendEntry = (entry: StreamEntry) => void;

/**
 * Opens an NDJSON response and returns the function that writes one entry to
 * it. Headers go out 200 immediately, before anyone knows whether the run
 * will succeed, so a failure is reported as an in-band {kind: "error"} line
 * rather than an HTTP status (which can't change once the body is streaming).
 */
export function startNdjson(res: Response): SendEntry {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();
  return (entry) => {
    // The client may already be gone (that's exactly why we'd be aborting);
    // writing to an ended response throws, and that throw has nothing to do
    // with the run itself, so it mustn't surface as the run's error.
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(entry)}\n`);
  };
}

export interface StreamedRunContext {
  /** Progress lines: classified, saved to the Run Record (if any) and sent. */
  log: (line: string) => void;
  send: SendEntry;
  /** Set when the run is being recorded. */
  recorder?: RunRecorder;
  /** Aborted when the client disconnects, so the SDK tears down its session. */
  abortController: AbortController;
}

export interface StreamedRunOptions {
  res: Response;
  /** Names the run in the server's own terminal output. */
  action: string;
  pr: PrReference;
  /** Save a Run Record as the run progresses. Omit for runs that aren't saved. */
  record?: {
    kind: "fix" | "briefing";
    store: RunStore;
    runsMax: number;
  };
  /** The action itself; whatever it sends before returning is its result. */
  run: (context: StreamedRunContext) => Promise<void>;
}

// Only for telling overlapping requests apart in this terminal's output. A
// run's durable identity is its RunRecorder id.
let requestCounter = 0;

/**
 * Runs one action for a web request and streams it: progress lines as they
 * happen, then whatever the action sends as its result, then `done`. Owns the
 * parts every action needs and used to copy by hand:
 *
 * - real cancellation: the client disconnecting aborts the run's
 *   AbortController. This listens on the RESPONSE, not the request: an
 *   IncomingMessage's "close" fires as soon as its body has been read (right
 *   after express.json()), long before the client actually leaves, and
 *   listening there aborted every run almost instantly. The response's
 *   "close" with `writableEnded` still false means a real premature
 *   disconnect (a Stop click or a closed tab).
 * - the Run Record lifecycle: started, saved as it goes, finished as
 *   completed, failed or stopped, and the store pruned afterwards.
 * - error reporting: a failure becomes an in-band error line, but a
 *   cancelled run is `stopped`, not `failed`, and reports nothing.
 */
export async function streamRun(options: StreamedRunOptions): Promise<void> {
  const { res, action, pr, record, run } = options;
  const send = startNdjson(res);

  const label = `[${action} #${++requestCounter} ${pr.owner}/${pr.repo}#${pr.prNumber}]`;
  console.log(`${label} started`);

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log(`${label} client disconnected -- aborting`);
      abortController.abort();
    }
  });

  // The record's id goes to the client first thing.
  let recorder: RunRecorder | undefined;
  if (record) {
    recorder = new RunRecorder(record.store, { kind: record.kind, pr });
    await recorder.start();
    send({ kind: "run", text: recorder.id });
  }

  const log = (line: string): void => {
    const entry: LogEntry = { kind: classifyLogLine(line), text: line.trim() };
    recorder?.log(entry);
    send(entry);
  };

  try {
    await run({ log, send, recorder, abortController });
    await recorder?.finish("completed");
    send({ kind: "done", text: "" });
    console.log(`${label} finished`);
  } catch (error) {
    if (!abortController.signal.aborted) {
      await recorder?.finish("failed", formatError(error));
      send({ kind: "error", text: formatError(error) });
      console.log(`${label} failed: ${formatError(error)}`);
    } else {
      await recorder?.finish("stopped");
      console.log(`${label} stopped`);
    }
  } finally {
    res.end();
    // Keep the store bounded; nothing waits on this or depends on it.
    if (record) void pruneRuns(record.store, record.runsMax).catch(() => {});
  }
}
