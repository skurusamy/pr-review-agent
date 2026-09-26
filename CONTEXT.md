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
A pending, unsubmitted GitHub review comment the agent creates in reply to an original review comment — used for a `not-a-bug` verdict, and as the fallback when a `bug` verdict exhausts its Fix Attempts without passing the Validation Gate.
_Avoid_: pending comment, response

**Agent Marker**:
An HTML-comment tag embedded in every Draft Reply body, used to detect on a later Review Run that a comment was already handled so it isn't reprocessed.
_Avoid_: signature, flag

**Dry Run**:
A mode of a Review Run that computes every Verdict and Fix Attempt normally but skips the actual git push and GitHub API writes, printing what it would have done instead.
_Avoid_: preview mode, simulation
