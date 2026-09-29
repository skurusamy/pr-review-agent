// octokit throws @octokit/request-error's RequestError on any failed API
// call, which carries far more than .message: the HTTP status and (for a
// GitHub-shaped error body) a documentation_url that's often the single
// biggest clue to what actually went wrong -- e.g. a 404 whose docs link is
// the pulls-get endpoint almost always means an access/SSO problem, not a
// missing PR. .message alone (what console.error(error.message) shows)
// throws that context away.
interface RequestErrorShape {
  status?: number;
  request?: { url?: string };
  response?: { data?: { documentation_url?: string } };
}

/**
 * Formats an error for a human reading the console, not just its message --
 * the HTTP status and GitHub's own documentation link when present, so a
 * bare "Not Found" doesn't hide the one detail that would let someone
 * self-diagnose it (permissions/SSO vs. a genuinely missing PR) without
 * having to ask someone else to go dig for it.
 */
export function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const lines = [error.message];
  const shaped = error as Error & RequestErrorShape;

  if (typeof shaped.status === "number") {
    lines.push(`  HTTP status: ${shaped.status}`);
  }
  if (shaped.request?.url) {
    lines.push(`  Request: ${shaped.request.url}`);
  }
  if (shaped.response?.data?.documentation_url) {
    lines.push(`  Docs: ${shaped.response.data.documentation_url}`);
  }

  return lines.join("\n");
}
