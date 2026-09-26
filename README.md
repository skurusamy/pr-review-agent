# pr-review-agent

A CLI agent that triages a pull request's inline review comments: applying a locally-validated fix for real bugs, or drafting a reply for everything else.

```bash
pr-review-agent review <owner/repo> <pr-number> [--dry-run]
```

See [CONTEXT.md](./CONTEXT.md) for the project's vocabulary, and the [wayfinder map](https://github.com/skurusamy/pr-review-agent/issues/1) for how this is being built.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
```

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` for local runs.

## Testing fixtures

This repo keeps a standing test PR with real inline review comments (some with replies, some outdated) that later wayfinder tickets use to verify against a live PR rather than only fixtures.
