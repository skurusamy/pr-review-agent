# pr-review-agent

A CLI agent that triages a pull request's inline review comments: applying a locally-validated fix for real bugs, or drafting a reply for everything else.

## Run a review

From the CLI (no build step needed during development):

```bash
npm run dev -- review <owner/repo> <pr-number> [--dry-run]
```

Or paste a PR link into the local web UI instead:

```bash
npm run serve
```

Opens at http://localhost:4127 (override with the `PORT` env var). Same `runReview()` logic as the CLI, but progress streams into the browser live, line by line, instead of you watching a terminal.

`--dry-run` (CLI) / the UI's "Dry run" checkbox does everything for real — including edits and the Validation Gate — except the final `git push` and GitHub review-creation call, which are only printed.

See [CONTEXT.md](./CONTEXT.md) for the project's vocabulary, the [wayfinder map](https://github.com/skurusamy/pr-review-agent/issues/1) for how this is being built, and the [Agent Blueprint](https://claude.ai/artifact/RjzLkJ3ys8nY3Uken1woEw) for an interactive walkthrough of the tools, the Claude Agent SDK harness, and the step-by-step flow.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
```

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` for local runs — both load automatically via `dotenv`, no manual export needed.

## Logs

Tool calls, thinking, and verdicts print as they happen — both the CLI and the UI stream live rather than waiting for the whole run to finish. The CLI colorizes them when running in an interactive terminal; set `NO_COLOR=1` to disable, or redirect output to a file and it stays plain automatically.
