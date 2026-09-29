export interface PrReference {
  owner: string;
  repo: string;
  prNumber: number;
}

export function prUrlOf(owner: string, repo: string, prNumber: number): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

const PR_URL_PATTERN = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/;

/**
 * Parses a pasted GitHub PR URL (e.g.
 * https://github.com/owner/repo/pull/123) into its parts. This is the UI's
 * equivalent of the CLI's <owner/repo> <pr-number> arguments -- one text
 * field instead of two, since a pasted link is the lower-friction input for
 * a form.
 */
export function parsePrUrl(url: string): PrReference {
  const match = PR_URL_PATTERN.exec(url.trim());
  if (!match) {
    throw new Error(
      `Couldn't find a PR reference in "${url}". Expected something like https://github.com/owner/repo/pull/123`,
    );
  }
  const [, owner, repo, prNumberRaw] = match;
  return { owner: owner!, repo: repo!, prNumber: Number(prNumberRaw) };
}
