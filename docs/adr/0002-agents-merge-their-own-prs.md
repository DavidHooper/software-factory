---
status: accepted (two-week trial); who merges is superseded by ADR 0003, and the revert path, digest and review conditions by ADR 0004
---

# Agents merge their own PRs, harness included, with a harness supervisor in place of the human

On 2026-10-21 we decided that agent PRs merge themselves once their head commit passes the merge gate (every check
green, no blocking agent review findings, no unresolved threads, no conflict, not `agent-blocked`; amended 2026-10-26 in ADR 0003: findings
are no longer marked blocking, and the gate needs a finished review run instead), and that a harness
supervisor does the rest of the human's part of the agent workflow. This reverses ADR 0001's consequence that harness
changes "are reviewed by a human in `harness` PRs". The app isn't mission critical yet, and we'd rather learn what the
loop gets wrong by letting it run than by guarding every step. It starts as a two-week trial, from when the kill switch,
merge gate and revert-on-red work is on `main`; at the end, merges, reverts, human interventions and retro findings
decide whether to keep it, put harness PRs back behind a human, or loosen further.

## Considered options

- **Agents merge feature PRs; harness PRs wait for a human.** Keeps a human on the rules agents are judged by. On the
  day of the decision a human caught a Stop-hook bypass in #24 that the review agent had marked optional, which is the
  case for this option. Rejected for the trial to find out how much that gate is worth.
- **Self-changes wait for a human:** PRs that change the harness supervisor's own skill or the merge gate's code skip
  auto-merge. Rejected for the trial too; the digest flags every such merge instead. (Superseded 2026-10-26 by ADR 0004: there is no digest.)

## Consequences

- Nothing on GitHub enforces the merge gate: the free plan has no branch protection or rulesets, and the bot's token
  can push to `main`. The gate is plain, tested dispatcher code, not an agent's judgement, and agents still can't
  merge from their own sessions.
- Mistakes reach `main`, so a red `main` is reverted automatically, and the kill switch (`AGENTS_PAUSED`) goes on if the
  revert doesn't fix it. (Amended 2026-10-23 in ADR 0003: the harness supervisor fixes a red `main` forward, or reverts
  it, and only a human turns the kill switch on. Superseded 2026-10-26 by ADR 0004: it fixes it forward only, and a revert is an
  ordinary PR.)
- The harness supervisor starts only harness and bug work. Product work still starts from a spec a human approves.
- There's no cap on runs; the Claude plan's usage limits are the cap, and runs they cut off are restarted.
