import type { RunStore } from "./runStore.js";

export const DEFAULT_RUNS_MAX = 200;

/**
 * Keeps only the newest `max` records. Records hold review comments and code
 * patches, so they are pruned rather than left to pile up; there is no
 * delete-one action while a shared server has no per-user ownership.
 */
export async function pruneRuns(
  store: RunStore,
  max: number = DEFAULT_RUNS_MAX,
): Promise<number> {
  const ids = await store.listIds();
  const stale = ids.slice(max);
  await Promise.all(stale.map((id) => store.delete(id)));
  return stale.length;
}

/**
 * Marks every run still saved as `running` as `stopped`. Run at startup:
 * anything running then belongs to a process that no longer exists, so its
 * record would otherwise say "running" forever.
 */
export async function sweepOrphanedRuns(store: RunStore): Promise<number> {
  let swept = 0;
  for (const id of await store.listIds()) {
    const record = await store.get(id);
    if (record?.status !== "running") continue;
    await store.save({
      ...record,
      status: "stopped",
      finishedAt: new Date().toISOString(),
      error: "Server restarted while this run was in progress.",
    });
    swept++;
  }
  return swept;
}
