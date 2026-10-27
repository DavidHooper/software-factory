# Upstream skills

Most skills here are vendored from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see
`UPSTREAM-LICENSE`), at commit `49dd158d1076134a641b33efb035946536778336` (2026-10-09). Vendored skills are
kept byte-for-byte as upstream apart from the adaptations below, and are excluded from Prettier, so a diff
against upstream shows only real changes.

## Vendored

| Skill                           | Upstream path                                      | Changes                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-review`                   | `skills/engineering/code-review`                   | Tracker pointer → `docs/agents/issue-tracker.md`. Agent runs skip the Spec axis instead of asking where the spec is. Spec brief searches the whole repo for a removal's wording                                                         |
| `codebase-design`               | `skills/engineering/codebase-design`               | None                                                                                                                                                                                                                                    |
| `diagnosing-bugs`               | `skills/engineering/diagnosing-bugs`               | None                                                                                                                                                                                                                                    |
| `domain-modeling`               | `skills/engineering/domain-modeling`               | None                                                                                                                                                                                                                                    |
| `grill-with-docs`               | `skills/engineering/grill-with-docs`               | None                                                                                                                                                                                                                                    |
| `grilling`                      | `skills/productivity/grilling`                     | None                                                                                                                                                                                                                                    |
| `improve-codebase-architecture` | `skills/engineering/improve-codebase-architecture` | None                                                                                                                                                                                                                                    |
| `pr`                            | `skills/engineering/pr`                            | None                                                                                                                                                                                                                                    |
| `tdd`                           | `skills/engineering/tdd`                           | None                                                                                                                                                                                                                                    |
| `to-spec`                       | `skills/engineering/to-spec`                       | Tracker pointer → `docs/agents/`. Applies `ready-for-agent` only when the spec should be built as one piece, since the label starts a run                                                                                               |
| `to-tickets`                    | `skills/engineering/to-tickets`                    | Tracker pointer → `docs/agents/`. Notes that labelling starts a run and blocked tickets wait. Limits a ticket to one duty, state machine or trust boundary                                                                              |
| `triage`                        | `skills/engineering/triage`                        | Label mapping pointer → `docs/agents/labels.md`. Posts the brief before applying the label. Brief template has an optional **Threat model**, an "Every criterion is reachable" principle, and a **Removals** acceptance-criteria bullet |
| `wizard`                        | `skills/engineering/wizard`                        | None                                                                                                                                                                                                                                    |
| `writing-for-agents`            | `skills/productivity/writing-for-agents`           | None                                                                                                                                                                                                                                    |

`setup-matt-pocock-skills` isn't vendored: its output is `docs/agents/`, including `docs/agents/harness.md`.

## Based on upstream

These are written for this repo's GitHub workflow and are formatted like the rest of the repo.

| Skill           | Based on                               | Why it differs                                                                                                        |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `implement`     | `skills/engineering/implement`         | Works one GitHub issue end to end: resumes existing work, plan, PR, CI, retro. Model-invoked so routines can start it |
| `retro`         | `skills/engineering/retro`             | Model-invoked so other skills can call it. Records structured events as a PR comment for `/harness-retro`             |
| `review-pr`     | `skills/engineering/code-review`       | Adds a security axis, fixes what breaks the flow, and posts one summary review                                        |
| `harness-retro` | none                                   | Aggregates retros into `harness` PRs and the scorecard                                                                |
| `today`         | `skills/engineering/ask-matt` (router) | The human's daily entry point: a brief, then runs the chosen workflow, reading user-invoked skills directly           |

## Updating

1. Download the new upstream commit to a scratch directory:
   `gh api repos/mattpocock/skills/tarball/<sha> > skills.tgz`.
2. For each vendored skill, diff upstream's old and new versions, and apply the changes here, keeping the
   adaptations above. Check upstream's renames and removals too: skills there move between buckets.
3. For each "based on upstream" skill, read the upstream diff and port anything that applies.
4. Update the commit above, and the table if an adaptation changed.
