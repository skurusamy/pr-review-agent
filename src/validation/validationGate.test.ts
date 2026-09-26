import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidationGate } from "./validationGate.js";

async function makeRepo(scripts: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "validation-gate-test-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", scripts }),
  );
  return dir;
}

describe("runValidationGate", () => {
  it("passes when every defined script succeeds", async () => {
    const dir = await makeRepo({
      typecheck: "true",
      lint: "true",
      test: "true",
    });
    try {
      const result = await runValidationGate(dir);
      expect(result.passed).toBe(true);
      expect(result.ranGates).toEqual(["typecheck", "lint", "test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips gates the repo doesn't define", async () => {
    const dir = await makeRepo({ test: "true" });
    try {
      const result = await runValidationGate(dir);
      expect(result.passed).toBe(true);
      expect(result.ranGates).toEqual(["test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops at the first failing gate, in typecheck -> lint -> test order", async () => {
    const dir = await makeRepo({
      typecheck: "true",
      lint: "false",
      test: "true",
    });
    try {
      const result = await runValidationGate(dir);
      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("lint");
      expect(result.ranGates).toEqual(["typecheck", "lint"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("captures the failing command's output", async () => {
    const dir = await makeRepo({
      test: "node -e \"console.error('boom'); process.exit(1)\"",
    });
    try {
      const result = await runValidationGate(dir);
      expect(result.passed).toBe(false);
      expect(result.output).toContain("boom");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
