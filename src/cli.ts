export function placeholder(): string {
  return "pr-review-agent scaffold is wired up";
}

// Formats the CLI's name and version for --version output, e.g. "pr-review-agent@0.1.0".
export function formatVersion(name: string, version: string): string {
  return `${name}@${version}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(placeholder());
}
