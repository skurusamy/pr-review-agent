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
import { runBrief } from "./briefRun.js";

vi.mock("./briefRun.js", () => ({ runBrief: vi.fn() }));

let server: Server;
let base: string;
let runsDir: string;

beforeAll(async () => {
  // server.ts loads secrets and opens its run store at import time.
  runsDir = await mkdtemp(join(tmpdir(), "server-brief-test-"));
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

beforeEach(() => {
  vi.mocked(runBrief).mockReset();
  vi.mocked(runBrief).mockResolvedValue("# PR Briefing: T");
});

const brief = (body: unknown): Promise<Response> =>
  fetch(`${base}/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const URL = "https://github.com/acme/widgets/pull/7";

describe("POST /brief mode", () => {
  it("runs a quick briefing when no mode is sent", async () => {
    const response = await brief({ prUrl: URL });
    await response.text();
    expect(vi.mocked(runBrief).mock.calls[0]![0]).toMatchObject({
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      mode: "quick",
    });
  });

  it("passes deeper through", async () => {
    await (await brief({ prUrl: URL, mode: "deeper" })).text();
    expect(vi.mocked(runBrief).mock.calls[0]![0].mode).toBe("deeper");
  });

  it("refuses an unknown mode instead of running it as quick", async () => {
    const response = await brief({ prUrl: URL, mode: "thorough" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'mode must be "quick" or "deeper".',
    });
    expect(runBrief).not.toHaveBeenCalled();
  });
});
