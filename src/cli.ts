export function placeholder(): string {
  return "pr-review-agent scaffold is wired up";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(placeholder());
}
