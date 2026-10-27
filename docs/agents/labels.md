# Labels

Labels are the workflow's state. Use only the labels below, and never create new ones.

## Triage (issues)

The vendored triage skills refer to canonical roles. Map them to these labels:

| Role                | Label             | Meaning                                                   |
| ------------------- | ----------------- | --------------------------------------------------------- |
| Needs evaluation    | `needs-triage`    | A maintainer needs to evaluate the issue                  |
| Waiting on reporter | `needs-info`      | Waiting for more information from the reporter            |
| Ready for an agent  | `agent-ready`     | Has a brief; an agent picks it up with no further context |
| Ready for a human   | `ready-for-human` | Needs a human to implement it                             |
| Won't fix           | `wontfix`         | Will not be actioned                                      |

Upstream skills call the agent role `ready-for-agent`. In this repo it is always `agent-ready`.

## Workflow

| Label           | On       | Applied by                                         | Effect                                                                                                                                                                                                                            |
| --------------- | -------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-ready`   | issue    | human (via `/triage`, `/to-tickets` or `/to-spec`) | Starts `/implement` (waits while the issue has open blockers)                                                                                                                                                                     |
| `agent-blocked` | issue/PR | agent                                              | The agent stopped; its latest comment says what it needs                                                                                                                                                                          |
| `needs-review`  | PR       | the harness supervisor or a human                  | Restarts `/review-pr` outside its budget, e.g. for the harness supervisor's send-back (it runs by itself when CI goes green; see `docs/agents/review.md`)                                                                         |
| `harness`       | issue/PR | human or `/harness-retro`                          | A tag for work on the harness itself, for retros and humans. It gates nothing: any agent may change harness files when its work needs it                                                                                          |
| `needs-human`   | issue/PR | the harness supervisor (`/supervise`)              | An escalation waiting on the human: its comment has the question and a recommended answer. The harness supervisor removes it once the human replies; on a merged PR's human steps, the human removes it once they've applied them |

The harness supervisor also applies the other labels here as its duties need (`/supervise`), and says which labels it applied in the comment that reports the action.

When an agent finishes a step it removes the label that triggered it, so re-applying the label is how a human
re-runs that step. Re-applying a trigger label also removes `agent-blocked`: the dispatcher clears it when it
starts the run.

## Run control

No label changes how or where a run goes: every coding run fires the same routine (see "Routing" in
`docs/agents/runners.md`). While the `AGENTS_PAUSED` repository variable is `true`, no label starts a run
(see "Kill switch" in `docs/agents/runners.md`).

## Lifecycle

```
issue: needs-triage ─► (triage) ─► agent-ready ─► /implement ─► PR opened
PR:    CI green ─► /review-pr (reviews, fixes, pushes) ─┬─► CI green ─► harness supervisor ─► checks the merge gate, merges it
                                                       └─► CI red ─► second /review-pr ─► harness supervisor decides
any:   ─► agent-blocked ─► harness supervisor answers, or a human does ─► trigger label re-applied (clears agent-blocked)
any:   ─► needs-human (escalated) ─► human replies ─► harness supervisor carries on and removes needs-human
PR:    red CI, no finished review run, a conflict, needs-human or agent-blocked keeps it from merging
       (see "Merge gate" in docs/agents/runners.md)
issue closed as not planned ─► its open agent PR is closed (branch kept)
```

What a review run fixes, and its budget, are in `docs/agents/review.md`.
