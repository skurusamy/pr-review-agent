export interface Secrets {
  anthropicApiKey: string;
  githubToken: string;
}

/**
 * Reads the two required secrets from the environment, failing fast with a
 * clear error naming exactly what's missing, rather than letting a later
 * API call fail with a confusing auth error.
 */
export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  const githubToken = env.GITHUB_TOKEN;

  const missing = [
    !anthropicApiKey && "ANTHROPIC_API_KEY",
    !githubToken && "GITHUB_TOKEN",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. Copy .env.example to .env and fill them in.`,
    );
  }

  return {
    anthropicApiKey: anthropicApiKey as string,
    githubToken: githubToken as string,
  };
}
