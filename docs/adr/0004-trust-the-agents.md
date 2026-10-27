---
status: accepted
---

# Trust the agents, and give the harness supervisor control

On 2026-10-25 the human decided, step by step, to slim the harness (#161): trust the agents, give the harness
supervisor most of the control, and keep only what the flow needs. We are building a software factory, and agents
get more trustworthy as models improve, so simplicity and maintainability now beat security-driven machinery. If
removing a guard causes problems, retros surface it and the harness supervisor tickets a fix. No guard is kept
"just in case".

Until then, most of the harness's code guarded against a misbehaving agent: in-session hooks that refused
commands, signed supervisor markers, a relay that allow-listed and re-checked every write, a separate rule and
check for harness files, supervised mode, a revert path for a red `main`, and a review protocol of blocking
tags, revisions and caps. Each layer closed a real failure, but together they cost more to keep working than the
failures they prevented, and they slowed every PR.

## Decisions

The chain of tickets under #161 made these changes, one PR at a time (#162 to #170). #161 holds the full table.

| Step              | Decision                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tickets           | Unchanged.                                                                                                                                                                      |
| Dispatcher        | No supervised mode, graduation or Actions runner. Two routines: `agent-harness` (implement, review, the weekly harness retro) and the harness supervisor.                       |
| In-session guards | No `bash-guard`, `tool-guard`, Stop hook or Subagent hooks. Skills tell agents to write through `github-write`.                                                                 |
| GitHub writes     | A thin relay: one REST write per dispatch, as the bot, with no allow-list, queue or signing. Its one hard rule: no writes to Actions variables, secrets or repository settings. |
| Harness rule      | Gone. Any agent may change harness files when its work needs it; `harness` is only a tag.                                                                                       |
| Review            | One review-and-fix run (`/review-pr`) that fixes what breaks the flow and posts a summary. No `/revise`, `[blocking]` tags or revision cap.                                     |
| Merge             | The harness supervisor decides and makes merges (ADR 0003 stands), against a smaller gate: every check green, review run finished, no conflict, nothing flagged for a human.    |
| Red `main`        | Fixed forward only. A revert is an ordinary PR when it's the quickest fix.                                                                                                      |
| Supervisor        | Wakes on dispatcher events and hourly. It reads GitHub itself with `gh`; no sweeps, digest or session naming. The kill switch still holds.                                      |
| Retros            | Unchanged.                                                                                                                                                                      |

## Considered options

- **Keep the guards and tune them.** Each guard had tests and a reason. Rejected: the guards were where the
  harness broke most often (a merge blocked by its own revert check in #184, refusals the supervisor had to
  escalate), and they defended against agents we already let merge to `main`.
- **Move agents to GitHub Actions, where they hold the bot's token directly.** That would drop the relay
  altogether. Rejected for now: humans can't watch or steer Actions runs, and the relay is now small.

## Consequences

- Nothing in a session stops an agent from breaking a rule. Retros surface a run that breaks one, and the harness
  supervisor tickets a fix.
- Nothing on GitHub stops a push to `main` until a human turns on branch protection with `Verify` required, which
  the free plan doesn't offer for a private repo. Until then the skills and the merge gate are the only guardrails.
- The supervisor's markers and the relay's writes are unsigned: any agent run could forge a marker. Agents are
  trusted, so that's accepted.
- The kill switch stays human-only, and the relay refuses writes to it.

## What this supersedes

- **ADR 0001:** the GitHub Actions runner, and skills moving to it as their metrics improve (graduation). Cloud
  sessions are the only runner. Its "harness files are off limits" consequence was already reversed.
- **ADR 0002:** "the gate is plain, tested dispatcher code" (already reversed by ADR 0003), reverting a red `main`
  automatically, its digest, and the merge gate's review conditions (blocking findings, unresolved threads).
- **ADR 0003** stands: the harness supervisor decides and makes every agent PR's merge. Its parts about signed
  markers, the relay re-checking the gate before a merge, and reverting a red `main` no longer hold.
