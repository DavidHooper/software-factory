# Agent workflow

How work moves through this repo when agents do it: issues become agent runs, agent runs become PRs, and PRs merge
themselves once they pass the merge gate.

## Language

**Agent run**:
One session in which an agent carries out a skill (implement, review or supervise) on one issue or PR.
_Avoid_: job, task, session (a session is where a run happens, not the run)

**Harness**:
The skills, hooks, context docs and workflows that drive agent runs, as opposed to the product they work on.
_Avoid_: framework, tooling

**Supervisor**:
An agent run that does a human's part of one process, end to end, so that process runs without them. Each process
gets its own supervisor.
_Avoid_: manager, orchestrator, dispatcher (the dispatcher starts runs and applies the merge gate's fixed rules;
it makes no judgement calls)

**Harness supervisor**:
The supervisor for the agent workflow itself: it turns retro proposals into tickets, triages, unblocks, keeps
stalled runs moving and escalates what needs the human. It wakes on the dispatcher's urgent events and on the
hourly tick, and reads GitHub itself. When `main` goes red, it fixes it forward. It also decides and makes every agent PR's merge (ADR 0003): it weighs what the review
run left, defers what doesn't break the flow, fixes what does when the fix is small, sends the PR back when it's bigger but inside the brief (or escalates it), checks the merge gate, and merges through the relay.
_Avoid_: the supervisor (once there's more than one)

**Tick**:
The workflow that fires the harness supervisor's routine with no reasons, once an hour, so it runs without an
urgent event. The routine's hourly trigger fires it, because only Actions can read the kill switch, and a tick fires
nothing while the kill switch is on.
_Avoid_: cron, heartbeat, sweep

**Merge gate**:
The conditions an agent PR's head commit must meet before the harness supervisor may merge it (the minimum it
checks: it may refuse more, never less): every check green, its review run finished, no conflict, and nothing
flagged for a human (`needs-human` or `agent-blocked`) (see "Merge gate" in `docs/agents/runners.md`).
_Avoid_: auto-approve, approval

**Review run**:
The one review-and-fix run (`/review-pr`) a PR gets once CI goes green: it reviews the PR, fixes what breaks the
flow, pushes, and posts a summary of what it changed and what it left. A second runs only if the first's push
broke CI (see "Review budget" in `docs/agents/review.md`), or when the harness supervisor sends the PR back.
_Avoid_: re-review, revision round

**Send-back**:
The harness supervisor returning a PR for one more review run, with one comment saying what must change and why,
when the change is bigger than a small fix but inside the brief. Once per PR; after that it escalates.
_Avoid_: revision request, changes requested

**Left finding**:
A review finding the review run doesn't fix, because it doesn't break the flow ("What to fix" in
`docs/agents/review.md`). Its summary lists it; `/harness-retro` takes up the ones worth doing.
_Avoid_: blocking finding, suggestion, nit

**Kill switch**:
The single setting that stops all merges and new agent runs. Only a human turns it on or off: a red `main` is the
harness supervisor's to fix forward, never a reason for the harness to pause.
_Avoid_: pause label, emergency stop

**Escalation**:
A question a supervisor hands to a human because it needs their judgement or access, rather than answering it itself.
_Avoid_: blocker (an agent is blocked; it escalates only via a supervisor)
