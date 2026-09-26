import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GateName = "typecheck" | "lint" | "test";

// Fixed order: typecheck first (fastest, catches the most obvious breakage),
// then lint, then test (slowest). We stop at the first failure rather than
// running all three, so a broken typecheck doesn't waste time running tests
// that were never going to matter.
const GATE_ORDER: GateName[] = ["typecheck", "lint", "test"];

const MAX_OUTPUT_CHARS = 2000;

export interface GateResult {
  passed: boolean;
  ranGates: GateName[];
  failedGate?: GateName;
  output?: string;
}

async function getAvailableScripts(repoDir: string): Promise<Set<string>> {
  const raw = await readFile(join(repoDir, "package.json"), "utf-8");
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
  return new Set(Object.keys(pkg.scripts ?? {}));
}

// Keep only the tail of the output -- the most useful part of a failing
// lint/typecheck/test run is usually the last error, not the setup noise
// at the top.
function truncate(output: string): string {
  return output.length > MAX_OUTPUT_CHARS
    ? `...(truncated)\n${output.slice(-MAX_OUTPUT_CHARS)}`
    : output;
}

function commandOutput(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "stdout" in error &&
    "stderr" in error
  ) {
    const { stdout, stderr } = error as { stdout: string; stderr: string };
    return `${stdout}\n${stderr}`.trim();
  }
  return String(error);
}

/**
 * Runs the target repo's own lint/typecheck/test scripts (v1 assumes npm),
 * skipping whichever aren't defined in package.json rather than failing on
 * a script that doesn't exist. A Fix Attempt may only be committed once
 * this passes.
 */
export async function runValidationGate(repoDir: string): Promise<GateResult> {
  const available = await getAvailableScripts(repoDir);
  const ranGates: GateName[] = [];

  for (const gate of GATE_ORDER) {
    if (!available.has(gate)) {
      continue;
    }
    ranGates.push(gate);
    try {
      await execFileAsync("npm", ["run", gate], { cwd: repoDir });
    } catch (error) {
      return {
        passed: false,
        ranGates,
        failedGate: gate,
        output: truncate(commandOutput(error)),
      };
    }
  }

  return { passed: true, ranGates };
}
