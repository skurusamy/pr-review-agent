import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runCodeReview } from "./codeReviewRun.js";

vi.mock("./codeReviewRun.js", () => ({ runCodeReview: vi.fn() }));

let server: Server;
let base: string;
let runsDir: string;

beforeAll(async () => {
  // server.ts loads secrets and opens its run store at import time.
  runsDir = await mkdtemp(join(tmpdir(), "server-review-test-"));
  vi.stubEnv("GITHUB_TOKEN", "ghp_test");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("RUNS_DIR", runsDir);
  const { app } = await import("./server.js");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(runsDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

// Braces matter: a function RETURNED from beforeEach is run as a teardown
// hook, and mockReset() returns the mock itself.
beforeEach(() => {
  vi.mocked(runCodeReview).mockReset();
});

async function post(body: unknown): Promise<Response> {
  return fetch(`${base}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function lines(response: Response): Promise<Record<string, unknown>[]> {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const PR = "https://github.com/acme/widgets/pull/7";

const review = {
  assessment: "Fine.",
  findings: [],
  unanchored: [],
  skippedFiles: [],
  changedFiles: [],
};

describe("POST /review", () => {
  it("streams progress, then the structured review, then the markdown, then done", async () => {
    vi.mocked(runCodeReview).mockImplementation(async ({ log }) => {
      log?.("Fetching PR context for acme/widgets#7...");
      log?.("  [thinking] looking at it");
      return { title: "My PR", prUrl: PR, review, markdown: "# Code Review" };
    });

    const response = await post({ prUrl: PR });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("ndjson");

    expect(await lines(response)).toEqual([
      { kind: "info", text: "Fetching PR context for acme/widgets#7..." },
      { kind: "thinking", text: "[thinking] looking at it" },
      { kind: "data", data: { title: "My PR", prUrl: PR, review } },
      { kind: "result", text: "# Code Review" },
      { kind: "done", text: "" },
    ]);
  });

  it("passes the parsed PR, the token and an abort controller to the run", async () => {
    vi.mocked(runCodeReview).mockResolvedValue({
      title: "t",
      prUrl: PR,
      review,
      markdown: "m",
    });
    await (await post({ prUrl: PR })).text();

    const options = vi.mocked(runCodeReview).mock.calls[0]![0];
    expect(options).toMatchObject({
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      githubToken: "ghp_test",
    });
    expect(options.abortController).toBeInstanceOf(AbortController);
  });

  it("reports a failed run as an in-band error line", async () => {
    vi.mocked(runCodeReview).mockRejectedValue(new Error("Not Found"));
    const out = await lines(await post({ prUrl: PR }));
    expect(out).toEqual([{ kind: "error", text: "Not Found" }]);
  });

  it("rejects a bad PR link with a 400 before streaming anything", async () => {
    const response = await post({ prUrl: "nope" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /PR reference/,
    );
    expect(runCodeReview).not.toHaveBeenCalled();
  });

  it("aborts the run when the client disconnects", async () => {
    let seen: AbortSignal | undefined;
    vi.mocked(runCodeReview).mockImplementation(
      ({ abortController }) =>
        new Promise((_, reject) => {
          seen = abortController?.signal;
          abortController?.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    const response = await post({ prUrl: PR });
    // Headers are flushed before the run finishes, so the response is here
    // while the run is still pending; cancelling the body is the client
    // going away (what the browser's Stop button does).
    await response.body?.cancel();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
  });
});
