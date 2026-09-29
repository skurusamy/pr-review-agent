import { EventEmitter } from "node:events";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { streamRun } from "./streamRun.js";

const PR = { owner: "o", repo: "r", prNumber: 1 };

function fakeResponse() {
  const emitter = new EventEmitter();
  const written: string[] = [];
  const res = Object.assign(emitter, {
    writableEnded: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: (chunk: string) => {
      written.push(chunk);
    },
    end: () => {
      res.writableEnded = true;
    },
  });
  const lines = () =>
    written
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { res: res as unknown as Response, lines, emitter };
}

describe("streamRun", () => {
  it("streams log lines and the result, then done, and ends the response", async () => {
    const { res, lines } = fakeResponse();
    await streamRun({
      res,
      action: "test",
      pr: PR,
      run: async ({ log, send }) => {
        log("hello");
        send({ kind: "result", text: "# md" });
      },
    });
    expect(lines().map((l) => l.kind)).toEqual(["info", "result", "done"]);
    expect(res.writableEnded).toBe(true);
  });

  it("reports a failure as an in-band error line", async () => {
    const { res, lines } = fakeResponse();
    await streamRun({
      res,
      action: "test",
      pr: PR,
      run: async () => {
        throw new Error("nope");
      },
    });
    const last = lines().at(-1)!;
    expect(last.kind).toBe("error");
    expect(String(last.text)).toContain("nope");
  });

  it("reports nothing when the client disconnected (a Stop, not a failure)", async () => {
    const { res, lines, emitter } = fakeResponse();
    await streamRun({
      res,
      action: "test",
      pr: PR,
      run: async ({ abortController }) => {
        emitter.emit("close");
        expect(abortController.signal.aborted).toBe(true);
        throw new Error("aborted");
      },
    });
    expect(lines().some((l) => l.kind === "error")).toBe(false);
  });
});
