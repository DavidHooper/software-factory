---
status: accepted; the Actions runner and graduation are superseded by ADR 0004
---

# Runner-agnostic agent harness, defaulting to Claude cloud sessions

Agents work GitHub Issues through a label-driven workflow (implement → review → revise; amended 2026-10-26 in
ADR 0003: review and revise are one review-and-fix run now). Skills are runner-agnostic
and idempotent: they take an issue or PR number and resume from the state in GitHub. A dispatcher workflow picks
the runner per run. We default to Claude Code cloud sessions so humans can watch and interject while the skills
and context are still being tuned. Skills move to unattended GitHub Actions runs as their retro metrics show they
no longer need correcting. (Superseded 2026-10-26 by ADR 0004: cloud sessions are the only runner, and nothing graduates.)

## Considered options

- **GitHub Actions only** (`claude-code-action`): robust and isolated, but runs can't be interjected, which is
  what catches gaps in skills and context early on. Kept as a second runner.
- **Sessions on a developer laptop** behind a tunnel (the approach in the earlier Bardo monorepo): steerable
  from the app, but triggers are lost silently when the laptop is off, it exposes an inbound endpoint to a
  machine running agents without permission prompts, and the session-management code was fragile. Rejected.
- **Linear instead of GitHub Issues:** better planning features, but triggering runs needs a webhook relay, and
  it adds a second identity and a second place where workflow state lives. Revisit if non-engineers triage work
  daily; only `docs/agents/issue-tracker.md` and the dispatcher's trigger would change.

## Consequences

- Cloud runs act as the connected GitHub user unless a bot token is supplied in the cloud environment (an open
  spike in `docs/plans/agent-harness.md`).
- Agents must not edit harness files (skills, context docs, hooks, workflows) in feature work. Changes to the
  harness are proposed from run retros and reviewed by a human in `harness` PRs. (Reversed by ADR 0002: agent PRs,
  harness ones included, now merge themselves; and by #161, step 5: any agent may change harness files when
  its work needs it, and the `harness` label is only a tag.)
