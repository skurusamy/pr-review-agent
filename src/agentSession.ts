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
