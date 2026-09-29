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

Opens at http://localhost:4127 (override with the `PORT` env var). The same logic as the CLI, but progress streams into the browser live, line by line, and a red **Stop** button cancels a long run for real (it aborts the underlying model session, it doesn't just hide it).

Each action has its own view: **Brief PR** shows the briefing (summary, changed files, diagram, risks), **Review PR** shows the Findings as cards ordered by severity, and **Fix comments** shows one card per review comment with its Verdict and outcome. Every view has a **Raw log** tab with the full output.

## What each action can write

Nothing is written to GitHub unless you ask for it explicitly.

| Action           | Writes by default                                                                                                 | Only when you ask                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brief PR**     | nothing (a local `.md` file from the CLI)                                                                         | `--post` / "Post to GitHub": one top-level PR comment                                                                                                                       |
| **Review PR**    | nothing (a local `.md` file from the CLI)                                                                         | `--post` / "Post to GitHub": one **pending** review with inline comments. It stays private to you until you submit it on GitHub, and it never approves or requests changes. |
| **Fix comments** | commits pushed to the PR branch and a confirmation reply per fix; draft replies collected into one pending review | `--dry-run` (on by default in the UI): everything is computed, nothing is pushed or posted                                                                                  |

## Fix comments: dry run, then apply

`--dry-run` (CLI) / the UI's "Dry run" checkbox does everything for real, including edits and the Validation Gate, except the final `git push` and the GitHub writes, which are only printed. The UI also saves what the dry run found (Verdicts, patches, drafted replies).

If the results look right, click **Apply this run** in the results view. It replays those saved results without calling the model again: it applies the recorded patches to a fresh checkout, re-runs the Validation Gate on the result, pushes, posts the fix confirmations and creates one pending review with the draft replies. Every item is checked against its Agent Marker first, so nothing is posted twice, and a retry picks up where a failure left off. If a patch no longer applies because the PR moved, nothing is pushed and you re-run Fix comments.

Apply is only available while that run's results are on screen: reloading the page loses the way back to it. (The run itself stays saved under `data/runs`, but the UI has no list to reopen it from.)

See [CONTEXT.md](./CONTEXT.md) for the project's vocabulary, the [wayfinder map](https://github.com/skurusamy/pr-review-agent/issues/1) for how this is being built, and the [Agent Blueprint](https://claude.ai/artifact/RjzLkJ3ys8nY3Uken1woEw) for an interactive walkthrough of the tools, the Claude Agent SDK harness, and the step-by-step flow.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
```

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` for local runs. Both load automatically via `dotenv`, no manual export needed. The token needs access to the repos you point the agent at (for an organization with SAML SSO, it must also be SSO-authorized).

| Variable            | Required | Default     | What it does                                                                                |
| ------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      |             | Used by the Claude Agent SDK.                                                               |
| `GITHUB_TOKEN`      | yes      |             | Reads PRs; writes only for the actions above.                                               |
| `PORT`              | no       | `4127`      | Port for `npm run serve`. Deliberately not 3000, which local tooling usually already holds. |
| `RUNS_DIR`          | no       | `data/runs` | Where the UI saves each run's record.                                                       |
| `RUNS_MAX`          | no       | `200`       | How many saved runs to keep; the oldest are pruned.                                         |
| `NO_COLOR`          | no       |             | Set to disable CLI colors.                                                                  |

Saved runs exist for the Apply step above; they are not a history you can browse.

## Logs

Tool calls, thinking, and verdicts print as they happen — both the CLI and the UI stream live rather than waiting for the whole run to finish. The CLI colorizes them when running in an interactive terminal; set `NO_COLOR=1` to disable, or redirect output to a file and it stays plain automatically.
