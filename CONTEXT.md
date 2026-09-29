# PR Review Agent

A CLI agent that triages a pull request's inline review comments, fixing what's a real bug and drafting a reply to what isn't.

## Language

**Review Run**:
One invocation of the agent against a single `(owner/repo, PR number)` pair, from fetching comments through to its last write (a push or a draft reply).
_Avoid_: session, job, execution

**Verdict**:
The agent's per-comment judgment of whether an inline review comment points at a real bug (`bug`) or not (`not-a-bug`).
_Avoid_: classification, decision, outcome

**Fix Attempt**:
One iteration of editing the local checkout in response to a `bug` verdict, followed by running the Validation Gate. A comment gets up to 3 Fix Attempts before falling back to a Draft Reply.
_Avoid_: try, iteration, retry

**Validation Gate**:
Running the repo's own lint, typecheck, and test scripts against the local checkout; a Fix Attempt may only be committed and pushed once the Validation Gate passes.
_Avoid_: CI rerun, checks, verification

**Draft Reply**:
A pending, unsubmitted GitHub review comment the agent creates at the same file and line as an original review comment — used for a `not-a-bug` verdict, and as the fallback when a `bug` verdict exhausts its Fix Attempts without passing the Validation Gate. GitHub allows only one pending review per PR, so every Draft Reply from one Review Run lands in a single shared pending review, not a reply nested in the original comment's thread (GitHub's API has no way to make a comment both pending and a reply).
_Avoid_: pending comment, response, reply

**Agent Marker**:
An HTML comment embedding the specific original comment's id (`<!-- pr-review-agent:comment-<id> -->`), placed in every Draft Reply body. Since a Draft Reply can't be a structural reply, idempotency is checked by scanning comment bodies for this exact marker rather than by reply/thread structure.
_Avoid_: signature, flag, generic tag

**Dry Run**:
A mode of a Review Run that computes every Verdict and Fix Attempt normally but skips the actual git push and GitHub API writes, printing what it would have done instead.
_Avoid_: preview mode, simulation

**PR Briefing**:
A one-shot, read-only summary of a PR's overall diff — for a _human_ reviewer deciding how to approach someone else's PR, not for the agent's own per-comment triage. Built from the PR's title, description, existing conversation, and diff (no local checkout, no Validation Gate); includes a changed-files tree and a Mermaid diagram of the change's shape, and flags where the diff drifts from what the description claims. Generated privately (CLI/UI) first; posting it — as a GitHub PR comment, a downloadable Markdown file, or both — is a separate, explicit action, never automatic. Distinct from a Review Run: a Review Run reacts to existing inline comments and can write code; a PR Briefing only reads and never touches the repo.
_Avoid_: PR Summary (confusable with GitHub's own PR description), explanation, report

**Run Record**:
The saved, durable account of one Review Run or one PR Briefing: which PR, whether it was a Dry Run, its status (running, completed, failed, stopped), and — for a Review Run — one entry per review thread holding its Verdict, its outcome (a fix with its patch, a Draft Reply, a failed Fix Attempt that fell back to a Draft Reply, or skipped) and that thread's own log lines, plus the full ordered log. It is written as the run progresses, so a crash or a Stop keeps everything done so far. It is what the UI's history and results view read, and what an approve-after-dry-run step would apply. Distinct from the text log a run prints: the log is a stream to watch, the Run Record is the account to come back to.
_Avoid_: run log, history entry, result
