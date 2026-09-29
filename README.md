# pr-review-agent

An agent that helps with a pull request in three ways. Each is its own action, on the CLI and as a button in the local web UI:

| Action           | CLI                                        | What it does                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Brief PR**     | `brief <owner/repo> <pr-number> [--post]`  | Read-only summary of what the PR does, with a changed-files tree, a diagram, and things to double-check. `--post` adds it as a PR comment.                                                                                                                               |
| **Review PR**    | `review <owner/repo> <pr-number> [--post]` | Reviews the PR's code (bugs, security, missing tests, drift from the description) and reports **Findings** with a file and line. Never approves or requests changes. `--post` creates a **pending** review with the Findings as inline comments; you submit it yourself. |
| **Fix comments** | `fix <owner/repo> <pr-number> [--dry-run]` | Triages review comments others left: applies a locally-validated fix for real bugs, drafts a reply for the rest.                                                                                                                                                         |

Run any of them with, for example:

```bash
npm run dev -- review <owner/repo> <pr-number>
```

`brief` and `review` are read-only: they write a Markdown file (`pr-briefing-…md` / `code-review-…md`) and print it, and post nothing unless you ask.

Or paste a PR link into the local web UI instead:

```bash
npm run serve
```

Opens at http://localhost:4127 (override with the `PORT` env var). The same logic as the CLI, but progress streams into the browser live, line by line, and a red **Stop** button cancels a long run for real.

For **Fix comments**, `--dry-run` (CLI) / the UI's "Dry run" checkbox does everything for real — including edits and the Validation Gate — except the final `git push` and GitHub review-creation call, which are only printed.

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
