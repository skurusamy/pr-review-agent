import { applyEvent } from "./applyEvent.js";
import { newRunId, type RunStore } from "./runStore.js";
import type { LogEntry, ReviewEvent, RunRecord, RunStatus } from "./types.js";

/**
 * Builds one RunRecord as a run progresses and saves it incrementally, so a
 * crash or Stop click keeps everything done so far. Per-line log events
 * don't trigger a save (a file rewrite per line would be wasteful); the
 * meaningful events and the final status do.
 */
export class RunRecorder {
  private record: RunRecord;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: RunStore,
    init: Pick<RunRecord, "kind" | "pr"> & { triggeredBy?: string | null },
  ) {
    this.record = {
      id: newRunId(),
      kind: init.kind,
      status: "running",
      startedAt: new Date().toISOString(),
      triggeredBy: init.triggeredBy ?? null,
      pr: init.pr,
      threads: [],
      rawLog: [],
    };
  }

  get id(): string {
    return this.record.id;
  }

  get snapshot(): RunRecord {
    return this.record;
  }

  start(): Promise<void> {
    return this.persist();
  }

  log(entry: LogEntry): void {
    this.record = { ...this.record, rawLog: [...this.record.rawLog, entry] };
  }

  event(event: ReviewEvent): void {
    this.record = applyEvent(this.record, event);
    if (event.type !== "thread-log") void this.persist();
  }

  setBriefing(markdown: string): void {
    this.record = { ...this.record, briefingMarkdown: markdown };
  }

  finish(status: Exclude<RunStatus, "running">, error?: string): Promise<void> {
    this.record = {
      ...this.record,
      status,
      finishedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    return this.persist();
  }

  // Saves are chained so two overlapping ones can't write out of order and
  // leave an older snapshot as the file's final content.
  private persist(): Promise<void> {
    const snapshot = this.record;
    this.saving = this.saving
      .then(() => this.store.save(snapshot))
      .catch((error) => {
        console.error(`Could not save run ${snapshot.id}:`, error);
      });
    return this.saving;
  }
}
