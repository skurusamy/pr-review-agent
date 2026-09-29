import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { RunRecord } from "./types.js";

/**
 * The seam where a real backend (Cloud Storage, a database) replaces local
 * files later: everything else only talks to this interface.
 */
export interface RunStore {
  save(record: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | undefined>;
  /** Newest first. */
  list(): Promise<RunRecord[]>;
}

const ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

/** Time-sortable and unguessable enough for a file name, e.g. 20260929-183012-a3f9. */
export function newRunId(now: Date = new Date()): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${date}-${time}-${randomBytes(2).toString("hex")}`;
}

export function isRunId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** One JSON file per run. Ephemeral on Cloud Run's disk -- see the run-record ticket. */
export class FileRunStore implements RunStore {
  constructor(private readonly dir: string) {}

  async save(record: RunRecord): Promise<void> {
    if (!isRunId(record.id)) {
      throw new Error(`Invalid run id: ${record.id}`);
    }
    await mkdir(this.dir, { recursive: true });
    // Write-then-rename so a crash or a concurrent reader never sees a
    // half-written file (records are re-saved as a run progresses).
    const target = join(this.dir, `${record.id}.json`);
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(record, null, 2));
    await rename(temp, target);
  }

  async get(id: string): Promise<RunRecord | undefined> {
    // The id becomes part of a file path, so anything but our own format is
    // rejected before it can reach the filesystem.
    if (!isRunId(id)) return undefined;
    try {
      return JSON.parse(
        await readFile(join(this.dir, `${id}.json`), "utf-8"),
      ) as RunRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(): Promise<RunRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const ids = names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length))
      .filter(isRunId)
      .sort()
      .reverse();
    const records = await Promise.all(ids.map((id) => this.get(id)));
    return records.filter((r): r is RunRecord => r !== undefined);
  }
}
