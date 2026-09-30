# pr-review-agent

An agent that helps with a pull request in three ways. Each is its own action, on the CLI and as a button in the local web UI:

| Action           | CLI                                                             | What it does                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brief PR**     | `brief <owner/repo> <pr-number> [--post]`                       | Read-only summary of what the PR does, with a changed-files tree, a diagram, and things to double-check. `--post` adds it as a PR comment.                                                                                                                                                                                                      |
| **Review PR**    | `review <owner/repo> <pr-number> [--post]`                      | Reviews the PR's code (bugs, security, missing tests, drift from the description or a linked issue), taking the comments already on the PR into account, and reports **Findings** with a file and line. Never approves or requests changes. `--post` creates a **pending** review with the Findings as inline comments; you submit it yourself. |
| **Fix comments** | `fix <owner/repo> <pr-number> [--dry-run] [--include-resolved]` | Triages review comments others left: applies a locally-validated fix for real bugs, drafts a reply for the rest.                                                                                                                                                                                                                                |

Run any of them with, for example:

```bash
npm run dev -- review <owner/repo> <pr-number>
```

`brief` and `review` are read-only: they write a Markdown file (`pr-briefing-…md` / `code-review-…md`) and print it, and post nothing unless you ask.

Or use the local web UI instead:

```bash
npm run serve
```

Opens at http://localhost:4127 (override with the `PORT` env var). The same logic as the CLI, but progress streams into the browser live, and a red **Stop** button cancels a long run for real (it aborts the underlying model session, it doesn't just hide it).

1. **Paste a PR link and click Load PR.** A card shows the PR before anything runs: title, description, branch, author, age, comment count, files changed and additions/deletions (from `GET /pr?prUrl=…`, one GitHub call). Editing the link clears the card.
2. **Pick a mode**: Brief PR, Review PR or Fix comments, then click the action button. The **Dry run** toggle only appears for Fix comments, since it is the only action that writes anything by default (Brief and Review are read-only).
3. **Watch Agent activity.** A checklist shows each step as it starts and finishes, with how long it took (fetching the PR, checking out the branch, reviewing the code, one step per comment for Fix comments). The **Raw log** tab has the full detail.

Each action has its own results view: **Brief PR** shows the briefing (summary, changed files, diagram, risks), **Review PR** shows the Findings as cards ordered by severity, and **Fix comments** shows one card per review comment with its Verdict and outcome. Every view has a **Raw log** tab with the full output.

## What each action can write

Nothing is written to GitHub unless you ask for it explicitly.

| Action           | Writes by default                                                                                                                                     | Only when you ask                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brief PR**     | nothing (a local `.md` file from the CLI)                                                                                                             | `--post` / "Post to GitHub": one top-level PR comment                                                                                                                       |
| **Review PR**    | nothing (a local `.md` file from the CLI)                                                                                                             | `--post` / "Post to GitHub": one **pending** review with inline comments. It stays private to you until you submit it on GitHub, and it never approves or requests changes. |
| **Fix comments** | commits pushed to the PR branch and a confirmation reply per fix; draft replies collected into one pending review, each inside its own comment thread | `--dry-run` (on by default in the UI): everything is computed, nothing is pushed or posted                                                                                  |

## Fix comments: dry run, then apply

`--dry-run` (CLI) / the UI's "Dry run" checkbox does everything for real, including edits and the Validation Gate, except the final `git push` and the GitHub writes, which are only printed. The UI also saves what the dry run found (Verdicts, patches, drafted replies).

If the results look right, click **Apply this run** in the results view. It replays those saved results without calling the model again: it applies the recorded patches to a fresh checkout, re-runs the Validation Gate on the result, pushes, posts the fix confirmations and creates one pending review with the draft replies. Every item is checked against its Agent Marker first, so nothing is posted twice, and a retry picks up where a failure left off. Only a dry run that completed can be applied, and only once it has succeeded. If a patch no longer applies because the PR moved, nothing is pushed (the draft replies are still created, since they never touch code) and you re-run Fix comments.

Apply is only available while that run's results are on screen: reloading the page loses the way back to it. The run itself stays saved under `data/runs`, but the UI has no list to reopen it from.

See [CONTEXT.md](./CONTEXT.md) for the project's vocabulary, the [wayfinder map](https://github.com/skurusamy/pr-review-agent/issues/1) for how this is being built, and the [Agent Blueprint](https://claude.ai/artifact/RjzLkJ3ys8nY3Uken1woEw) for an interactive, step-by-step walkthrough of all three actions, plus the web layer, the Claude Agent SDK harness, how each model session is locked down, every tool, and where each piece lives in the code.

## Limits

- **Same-repo PRs only** for Fix comments and Apply. They check out the PR's branch so they can push, and a PR from a fork is refused with a clear error. Review PR only reads, so it fetches the PR's own `refs/pull/N/head` and works on forks and on merged PRs whose branch is gone. Brief PR needs no checkout, so it works on forks too.
- **Review PR checks its own findings.** After the review, each finding (the 8 most severe) goes to a fresh read-only session that tries to disprove it. A dismissed finding is listed under "Checked and dismissed" and never posted; only confirmed findings become inline comments in the pending review, and the ones the check could not settle go in its body. This adds up to 8 short model sessions per Review. Review PR also reads the repo's own written rules from the **base branch** (`.github/copilot-instructions.md`, `CONTRIBUTING.md`, a coding-standards doc, and path-specific `.github/instructions/*.instructions.md` files whose `applyTo` globs match a changed file), so it can flag a documented convention the diff breaks. Rules that exist only on the PR's own branch are ignored on purpose. Where nothing is documented it may add at most 2 low-severity "Possible code smell" findings. A finding can carry a small **suggested change** (at most 10 lines), which the check must also judge correct before it is posted as a one-click GitHub suggestion. Each posted comment carries a hidden marker, so posting again after you submitted the first review does not repeat the same findings.
- **Review PR** also reads the inline review threads already on the PR (open ones first, at most 30, each comment cut to 1,500 characters), so it doesn't repeat a point someone already raised, and treats resolved threads as settled unless the code clearly still has the problem. Threads left in someone's own unsubmitted draft review can't be seen.
- **Linked issues (Brief PR and Review PR)** are read for the same repo only. References to other repos, Jira, Linear or other trackers, and ordinary web links are not followed.
- **Fix comments** only acts on inline review comments on the diff. Conversations already marked **resolved** on GitHub are skipped unless you pass `--include-resolved` (the UI has an **Include resolved** switch). The AI reads the whole thread, replies included, with each author labelled as the PR author or the reviewer, and the Verdict step also sees the PR's general discussion (the most recent 20 comments, each cut to 1,500 characters), since a note like "we're not touching the parser here" can change what counts as a bug. A comment gets up to 3 Fix Attempts before falling back to a draft reply.
- **The Validation Gate** runs the target repo's own `typecheck`, `lint` and `test` npm scripts, in that order, and stops at the first failure. A script the repo doesn't define is skipped. It assumes npm.
- **Untrusted PRs.** Every model session runs locked down, because it reads content other people wrote: only the tools it needs exist for the model (none for Brief PR, Read/Grep/Glob for Review PR and the Verdict step, plus Edit for a Fix Attempt), no settings are loaded from the checked-out PR, and the GitHub token is neither in the session's environment nor in the checkout's `.git/config` (a push carries it in memory only). The Brief PR session also runs in the system temp directory instead of the server's own. Not covered: the Read tool is not confined to the checkout (it can open other files the server's user can), and the Anthropic key stays in the environment because the session needs it, so this is suited to a local single-user tool, not yet to a shared deployment. This has been tested with the model faked and with real git; the newest parts (Brief, Verdict and Fix Attempt) have not yet been run against the live model.

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

Saved runs exist for the Apply step above; they are not a history you can browse. Only runs started from the web UI are saved (Fix comments and Brief PR); CLI runs and Code Reviews are not. When the server starts, any run still marked as running is marked stopped.

## Logs

Tool calls, thinking, and verdicts print as they happen — both the CLI and the UI stream live rather than waiting for the whole run to finish. The CLI colorizes them when running in an interactive terminal; set `NO_COLOR=1` to disable, or redirect output to a file and it stays plain automatically.
