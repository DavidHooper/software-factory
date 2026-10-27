---
status: accepted; signed markers, the relay re-checking merges and the revert path are superseded by ADR 0004
---

# The harness supervisor decides and makes agent PR merges

On 2026-10-22 we decided that the harness supervisor decides whether each agent PR merges, and makes the merge
itself (#41). This reverses ADR 0002's "the gate is plain, tested dispatcher code, not an agent's judgement". The
merge gate stays, as the minimum the harness supervisor must check: it may refuse a PR the gate would pass, never
merge one the gate refuses.

Under ADR 0002 the dispatcher merged a PR as soon as every condition held, and nothing merged until each one did.
In practice PRs waited a revision round, or several, for suggestions nobody needed before the merge: a naming nit
or a hardening with no realistic path kept a thread open, and an open thread failed the gate. The human's standing
rule is to fix only what breaks the flow. On 2026-10-23 they asked the harness supervisor to "learn to merge instead
of waiting for each suggestion to be covered, documenting it, making decisions on when to do it", and gave it the
permissions for it, because "it's meant to be powerful in this repo".

## What changes

- The dispatcher no longer merges agent PRs. When one passes the gate, or would once its review threads are
  resolved, it wakes the harness supervisor (`isMergeCandidate()`). It still merges revert PRs, which need no
  judgement and keep `main` red until they merge. (Amended 2026-10-23, below: it no longer does.)
- The harness supervisor weighs each open thread: what breaks the flow goes back to `/revise`, and the rest is
  answered, resolved and logged on the scorecard for a follow-up ticket. It overrules a `[blocking]` finding only
  with a stated reason, and never a security finding without the human. Then it merges through the relay.
  (Amended 2026-10-26, below: there's no `/revise` or `[blocking]` finding now.)
- The relay's `merge` action is supervisor-only (its requests carry the harness supervisor's signature). The relay
  re-reads the PR, and refuses unless it's an agent PR, its head is the one judged, the kill switch is off and
  `mergeGate()` passes. A judgement can't merge what the gate refuses, and a forged request can't merge at all.
- Every decision (`merged`, `deferred`, `overruled`, `sent-back`, `closed`) is a signed marker with its reason, and
  the digest lists them under **Decisions**. (Amended 2026-10-26, below: `overruled` and `sent-back` are gone.) Each harness retro reviews them, and a merge later reverted counts as
  a `major` event against the decision that caused it. That's how the judgement improves.

## Considered options

- **Keep the gate as the decider, and have the harness supervisor resolve suggestion threads so it passes.** That's
  what it did before this decision. It kept the decision in code, but the harness supervisor still had to judge every
  thread, and the merge waited on an event it didn't control. Rejected: the judgement was already the
  supervisor's, so it should own the merge too.
- **A `merge-approved` label the dispatcher acts on.** It keeps the merge in the dispatcher, but adds a label any
  run that can label could forge, and a second path to keep in step. Kept only as a fallback, if auto mode's safety
  check refuses the harness supervisor's `merge` call despite the allow rule in `.claude/settings.json`.

## Consequences

- Judgement can now be wrong in ways the gate never was: a deferred suggestion can turn out to matter. A merge
  that breaks `main` wakes the harness supervisor to fix it forward or revert it (amendment below), and the
  digest and retros catch the rest.
- The harness supervisor holds a merge path, so its key is worth more. It still can't push to `main`, force-push,
  delete branches, write Actions secrets or variables (the kill switch included), or change its own key or
  routine.
- The harness supervisor can't read the kill switch from its cloud session, so the dispatcher puts `paused` in
  every payload it sends it, and a payload without it counts as paused. The relay checks the kill switch again
  before every merge.

## Amendment, 2026-10-23: a red `main` is fixed forward, and nothing pauses by itself

The human decided (#63): "if something breaks, let's not pause everything — allow the supervisor to fix forward".
Until then the dispatcher reverted a merge-gate merge that turned `main` red, merged the revert PR itself, and
turned on the kill switch when the revert failed or left `main` red, which stopped every run and merge until a
human noticed.

- The dispatcher no longer reverts, merges or pauses. A red `main` wakes the harness supervisor with `main-red`
  (the failing run, the PR and how it merged, and the commit that broke `main`), and a revert PR that can't merge
  wakes it with `revert-failed`.
- The harness supervisor fixes forward by default: an urgent `fix/` ticket whose PR it merges next. It reverts
  only when a fix isn't quick or safe (the cause isn't clear, or the breaking change touches the merge gate, the
  relay or signing), pushing `revert/pr-<n>` itself and merging it through the relay, which still holds it to the
  exact revert. While `main` is red it merges only the fix or the revert.
- After two attempts, or 2 hours, with `main` still red, it escalates to the human. It never pauses: the kill
  switch is human-only.

This trades the safety of stopping everything for keeping work moving: a bad fix can land on a red `main`, but
only the fix or the revert merges there, each attempt is a `main-red` decision in the digest, and the human is
called in after two.

## Amendment, 2026-10-26: one review-and-fix run, and the supervisor fixes small things itself

Step 6 of #161 (#166) merged `/review-pr` and `/revise` into one review-and-fix run. The review run fixes
what breaks the flow itself and posts one summary of what it changed and left, so nothing goes back to `/revise`
and no finding is marked `[blocking]`.

- The harness supervisor still weighs what the review run left, and every open thread. When something breaks the
  flow and the fix is small, it makes the fix itself on the PR's branch (`/supervise`, **Fix it yourself**), and
  merges `main` into a conflicted PR when that's mechanical; otherwise it escalates.
- The `overruled` and `sent-back` decision markers, the revision cap and its `grant` markers are gone. The gate's
  review condition is now "a review run has posted its summary and none is going on the head" ("Review budget" in
  `docs/agents/review.md`).

## Amendment, 2026-10-26: trust the agents (ADR 0004)

The harness simplification (#161, ADR 0004) keeps this decision: the harness supervisor decides and makes every
agent PR's merge. What changed around it:

- Nothing is signed. The supervisor's markers are plain comments, and the relay makes its merge as sent, without
  re-reading the PR or checking `mergeGate()` again: the supervisor checks the gate itself (`supervisor-state.ts gate`).
- A red `main` is fixed forward only. The 2026-10-23 amendment's revert path is gone: no `revert/pr-<n>` branches,
  exact-revert check or `revert-failed` wake. A revert is an ordinary PR when it's the quickest fix.
- The digest is gone: the harness supervisor's markers, and its retros on the Supervisor log, record its decisions.
