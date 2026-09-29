import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Shared lockdown for every Claude Agent SDK session this agent starts. Each
 * session reads content other people wrote (a PR's diff, description, comments
 * and files), so what the model can reach must not depend on the model's own
 * good behaviour. Three defaults of the SDK are wrong for that:
 *
 * - `allowedTools` only auto-approves the tools it lists; it removes none. A
 *   live run showed the model reaching for Bash although Bash was never
 *   listed. `tools` is the option that actually restricts the set.
 * - With `settingSources` omitted the SDK loads user, project and local
 *   settings. "Project" means the checked-out PR's own .claude/settings.json,
 *   which its author controls and which can grant permissions or define hooks
 *   that run commands. An empty list loads none (and no CLAUDE.md either).
 * - The subprocess inherits process.env, and the Read tool can open files such
 *   as /proc/self/environ on Linux, where Cloud Run would run this. No session
 *   needs the GitHub token (the SDK talks to Anthropic; every GitHub call is
 *   ours), so it is removed from the environment the session sees.
 */

/** A copy of `processEnv` without the GitHub token. Never mutates its input. */
export function sessionEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...processEnv };
  delete env.GITHUB_TOKEN;
  return env;
}

/**
 * The SDK options that lock a session down: exactly these built-in tools (an
 * empty list means none), no settings loaded from anywhere, no GitHub token
 * in the environment. Spread into a session's options.
 */
export function lockedDown(
  builtInTools: readonly string[],
  processEnv: NodeJS.ProcessEnv = process.env,
): {
  tools: string[];
  settingSources: never[];
  env: NodeJS.ProcessEnv;
} {
  return {
    tools: [...builtInTools],
    settingSources: [],
    env: sessionEnv(processEnv),
  };
}

/**
 * The SDK signals an exhausted turn budget by THROWING, not by ending the
 * stream, so a check placed after the loop never runs for that case. Callers
 * that have a fallback for "the model never finished" must catch this.
 */
export function isMaxTurnsError(error: unknown): boolean {
  return (
    error instanceof Error && /maximum number of turns/i.test(error.message)
  );
}

/** The API key was rejected. Retrying can't help, so the run stops at once. */
export class ApiKeyRejectedError extends Error {
  constructor() {
    super(
      "The Anthropic API key was rejected (401). Check ANTHROPIC_API_KEY in .env and restart.",
    );
  }
}

/**
 * Called on every message of a session's stream, before anything else looks at
 * it. The SDK retries failed API calls with a growing delay and says nothing
 * else meanwhile, so without this a bad key looks like a hung app for minutes.
 *
 * - An `api_retry` message becomes a visible warning line, so a wait is never
 *   silent ("API error 529, retry 3 of 10 in 8s").
 * - Authentication failures throw ApiKeyRejectedError immediately, since
 *   retrying a rejected key only delays the same answer.
 */
export function watchApiHealth(
  message: SDKMessage,
  log: (line: string) => void,
): void {
  if (message.type === "system" && message.subtype === "api_retry") {
    if (message.error === "authentication_failed") {
      throw new ApiKeyRejectedError();
    }
    const seconds = Math.round(message.retry_delay_ms / 1000);
    log(
      `Warning: API error${message.error_status ? ` ${message.error_status}` : ""} (${message.error}); retry ${message.attempt} of ${message.max_retries} in ${seconds}s`,
    );
    return;
  }
  if (
    message.type === "assistant" &&
    message.error === "authentication_failed"
  ) {
    throw new ApiKeyRejectedError();
  }
}
