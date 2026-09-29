# PR Review Agent

An agent that helps with a pull request in three separate ways: **Brief PR** (explain what it does), **Review PR** (review its code and report Findings), and **Fix comments** (triage the review comments others left, fixing what's a real bug and drafting a reply to what isn't). Each is a CLI command and a button in the local web UI.

## Language

**Fix Run**:
One invocation of the agent's comment-fixing action against a single `(owner/repo, PR number)` pair, from fetching the review comments others left through to its last write (a push or a draft reply). The action is called **Fix comments** in the UI and `fix` on the CLI.
_Avoid_: Review Run (its old name — "review" now means a Code Review), session, job, execution

**Verdict**:
The agent's per-comment judgment of whether an inline review comment points at a real bug (`bug`) or not (`not-a-bug`).
_Avoid_: classification, decision, outcome

**Fix Attempt**:
One iteration of editing the local checkout in response to a `bug` verdict, followed by running the Validation Gate. A comment gets up to 3 Fix Attempts before falling back to a Draft Reply.
_Avoid_: try, iteration, retry

**Validation Gate**:
Running the target repo's own `typecheck`, `lint` and `test` npm scripts against the local checkout, in that order, stopping at the first failure. A script the repo doesn't define is skipped. A Fix Attempt may only be committed and pushed once the Validation Gate passes; the agent never runs it itself, and Apply runs it again on the patched tree.
_Avoid_: CI rerun, checks, verification

**Draft Reply**:
A pending, unsubmitted reply the agent adds inside the original review comment's thread — used for a `not-a-bug` verdict, and as the fallback when a `bug` verdict exhausts its Fix Attempts without passing the Validation Gate. GitHub allows only one pending review per PR, so every Draft Reply from one Fix Run belongs to a single shared pending review; the replies are added to it through GitHub's GraphQL API, since the REST API cannot make a comment both pending and a reply. If a thread cannot be found, the Draft Reply falls back to a new comment on the same file and line.
_Avoid_: pending comment, response, reply

**Resolved thread**:
A review conversation someone marked resolved on GitHub. A Fix Run skips it by default, because a Verdict, a fix or a reply would reopen a conversation that was closed on purpose; it is shown as skipped, and can be judged anyway on request (`--include-resolved`, or the UI's Include resolved switch). Distinct from an outdated comment, whose diff position has moved: an outdated comment is still judged, but only ever gets a Draft Reply.
_Avoid_: closed thread, done

**Agent Marker**:
An HTML comment embedding the specific original comment's id (`<!-- pr-review-agent:comment-<id> -->`), placed in every Draft Reply body. Since a Draft Reply can't be a structural reply, idempotency is checked by scanning comment bodies for this exact marker rather than by reply/thread structure.
_Avoid_: signature, flag, generic tag

**Dry Run**:
A mode of a Fix Run that computes every Verdict and Fix Attempt normally but skips the actual git push and GitHub API writes, printing what it would have done instead.
_Avoid_: preview mode, simulation

**PR Briefing**:
A one-shot, read-only summary of a PR's overall diff — for a _human_ reviewer deciding how to approach someone else's PR, not for the agent's own per-comment triage. Built from the PR's title, description, existing conversation, and diff, plus the same-repo GitHub issues the title or description links to (read by the agent, at most 5, as background: the briefing says whether the change appears to deliver what they ask; the model itself fetches nothing) (no local checkout, no Validation Gate); includes a changed-files tree and a Mermaid diagram of the change's shape, and flags where the diff drifts from what the description claims. Generated privately (CLI/UI) first; posting it — as a GitHub PR comment, a downloadable Markdown file, or both — is a separate, explicit action, never automatic. Distinct from a Fix Run: a Fix Run reacts to existing inline comments and can write code; a PR Briefing only reads and never touches the repo.
_Avoid_: PR Summary (confusable with GitHub's own PR description), explanation, report

**Run Record**:
The saved, durable account of one Fix Run or one PR Briefing started from the web UI (CLI runs and Code Reviews are not saved): which PR, whether it was a Dry Run, its status (running, completed, failed, stopped), and — for a Fix Run — one entry per review thread holding its Verdict, its outcome (a fix with its patch, a Draft Reply, a failed Fix Attempt that fell back to a Draft Reply, or skipped) and that thread's own log lines, plus the full ordered log. It is written as the run progresses, so a crash or a Stop keeps everything done so far. It is what the results view refetches and what the **Apply** step replays after a Dry Run. There is deliberately no history list to browse saved records. Distinct from the text log a run prints: the log is a stream to watch, the Run Record is the account Apply works from.
_Avoid_: run log, history, history entry, result

**Apply**:
Replaying a Dry Run's saved results onto the PR without calling the model again: the recorded patches are applied to a fresh checkout, the Validation Gate is re-run on the result, the fixes are pushed with a confirmation reply each, and the Draft Replies are created as one pending review. Every item is checked against its Agent Marker first, so nothing is posted twice, and a retry resumes from what already succeeded. Only the Run Record of a completed Dry Run can be applied, and only once it succeeds. A patch that no longer applies pushes nothing, but the Draft Replies, which never touch code, are still created. Shown as "Apply this run" in the UI.
_Avoid_: approve, confirm, replay, re-run (a re-run calls the model again)

**Code Review**:
A one-shot review of a PR's code by the agent, for a _human_ reviewer deciding what to raise on someone else's PR. Reads the PR's diff plus a read-only local checkout (so it can follow callers and types), never edits anything, and produces **Findings** plus a short overall assessment. It never approves or requests changes — that stays the human's call. Generated privately (CLI/UI) first; posting the Findings as a pending review with inline comments is a separate, explicit action. Distinct from a PR Briefing (which explains what the PR does, not whether it is right) and from a Fix Run (the comment-fixing action, which reacts to comments others already left, and can write code).
_Avoid_: PR review, audit, scan

**Finding**:
One issue a Code Review reports: a file, a line, a severity (`high`, `medium` or `low`), a category (`correctness`, `security`, `tests` or `drift`), a title and an explanation. The line is checked against the diff in code. A Finding on a diff line is anchored, so it can be posted as an inline comment. One whose line is not part of the diff is kept as **unanchored**: shown in the report and included in the posted review's body, never dropped and never posted inline. A concern about the change as a whole belongs in the assessment. In scope: correctness bugs, security problems, missing or weak tests, and drift between the diff and what the PR description or a linked issue asks for (the same same-repo issues a PR Briefing reads, at most 5, read by the agent as background). Out of scope: style nits that lint already covers.
_Avoid_: comment (confusable with a review comment), issue (confusable with a GitHub issue), nit

**Progress Step**:
One line of the checklist a web UI run shows while it works (for example "Checking out the branch"), reported as it starts and again as it finishes or fails, with the time it took. A Fix Run reports one per review thread. Steps are only for watching progress: they are not saved in the Run Record and the CLI does not show them (its text log is unchanged). Distinct from a Fix Attempt, which is one edit-and-validate iteration on a comment.
_Avoid_: stage, phase, task
