# Review findings

What a review-and-fix run (`/review-pr`) fixes, and how many runs a PR gets. The skill links here rather than
restating it.

## What to fix

The human's standing rule: fix only what breaks the flow. A review may find as much as it likes; this decides
what the run fixes on the PR, and what it only lists as left.

**Fix** a finding when it truly breaks the flow:

- a bug on a realistic path that nothing else catches. The harness supervisor, fixing a red `main` forward and a
  human all count as something else
- a security hole
- a broken contract or interface that other code or agents rely on
- a missing or wrong acceptance criterion from the brief
- wrong facts in a doc that agents read (`AGENTS.md`, `docs/`, `GLOSSARY.md`, the ADRs, skills)

**Leave** everything else: minor standards breaches, naming, duplication, wording, hardening with no realistic
path, and gaps that something else already catches. A breach of a documented standard is worth fixing only if it
also breaks the flow; otherwise the summary lists it as left and names the rule it breaks.

**When in doubt, leave it**, except on security: fix a doubtful security hole.

Left findings aren't lost. The run's summary lists every one, and `/harness-retro` reads those summaries,
turning the ones worth doing into tickets.

## Review budget

One review-and-fix run per PR, and a second only if the first's push broke CI. The dispatcher enforces it
(`reviewRun()` in `.harness/src/dispatch.ts`):

- **First run:** starts when CI first goes green on an agent PR's head.
- **Second run:** starts once CI is red on a head past the commit the first run reviewed (its push), and the
  first run's retro has completed its `Agent review` check there, so the two runs' checks can't get mixed up.
- **Finished:** the run's summary review (`<!-- agent-review -->`) is on the PR and no `Agent review` check is
  running on the head. The run posts the summary on the commit it reviewed **before** it pushes, so the
  dispatcher never mistakes the push's CI for a PR that hasn't been reviewed yet. Any head pushed after the
  summary counts as reviewed too, whoever pushed it: the harness supervisor reads those commits before it
  merges.

The dispatcher takes a head past the reviewed commit to be the run's push. After a run that pushed nothing, a
later push by the harness supervisor or a human gets no `Agent review` check, so if it goes red no second run
starts and no `red-after-review` wake fires: the supervisor's hourly run finds the PR.

Once a run has finished, the dispatcher wakes the harness supervisor: `mergeable` when the head is green and
passes the merge gate, or `red-after-review` when the head is red and the budget is spent. The supervisor
decides from there: merge, make a small fix itself, send it back, or escalate with `needs-human`. To run a review
again outside the budget, it (or a human) applies `needs-review`: the dispatcher starts that run whatever the
budget says. It **sends a PR back** when the PR needs a change bigger than a small fix but inside its
brief: one PR comment saying what must change and why, then `needs-review`. The run fixes those points first and
reports on each in its summary. Once per PR: after that, it escalates (`/supervise`, **Send it
back**).
