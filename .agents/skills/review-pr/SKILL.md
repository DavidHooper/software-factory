---
name: review-pr
description: 'Review a PR on standards, spec and security, fix what breaks the flow, push, and post one summary. Use when an agent routine or a human asks to review a PR by number.'
---

Review the pull request numbered in the arguments, fix what you find that breaks the flow, and post **one** summary of what you changed and what you left. Nobody answers your findings afterwards, so fix them yourself. Read `docs/agents/issue-tracker.md` for the `gh` commands.

## 1. Load the PR

Read the PR and its conversation (`docs/agents/issue-tracker.md` has the commands for everything in this skill). If it isn't open, stop. Check out its branch (never rebase or force-push), and merge `origin/main` if it's behind. The fixed point is `origin/<base>`; the spec is the brief of the issue it closes (see `/implement`, step 1).

If the PR already has an agent review (`<!-- agent-review -->`, posted by the agent bot (`<bot>[bot]`, with `<bot>` from `node .harness/src/cli/config.ts bot`)) and CI is red on a head past the commit it reviewed, this is the **second run**: the first run's push turned CI red, and the dispatcher started you to get it green ("Review budget" in `docs/agents/review.md`). Read the failing checks first; making them pass is this run's main job, alongside the review. Otherwise a `needs-review` label restarted you outside the budget: run as a first run.

**Send-back.** Either way, look for the harness supervisor's latest send-back (`/supervise`, **Send it back**): the agent bot's latest comment on the PR that starts `**Supervisor: send-back**`. That comment lists the changes. If it's newer than the PR's latest agent review, the harness supervisor sent the PR back for this run: making the changes it lists is this run's main job, and its summary reports on each point (step 4). If this is also the second run, get the failing checks green first, then make the send-back's changes.

**Don't revert another PR's merge on the branch** unless the brief asks for it (#114): it would undo that PR on `main` when this one merges.

## 2. Review on three axes, in parallel

Run all three axes on every diff, whatever its size. All three must run as sub-agents, so each reads the diff fresh. Start a **security** sub-agent, then call the Skill tool with `code-review` (fixed point and spec as above) while it runs. Give the security sub-agent the diff command (`git diff origin/<base>...HEAD`) and this brief, with `<n>` the issue the PR closes:

> The PR implements issue #<n>; read its brief (the latest `## Agent Brief` comment, or else the issue body: `gh api repos/{owner}/{repo}/issues/<n>` and its `/comments`) and any tracking issue it says to read first: a trade-off the brief or tracking issue decided is not a finding. The repository is private, and agents write to GitHub only through `github-write`.
>
> Report security problems this diff introduces or makes worse: missing authentication or authorisation, injection (SQL, shell, template), unsafe deserialisation, secrets in code, config or logs, SSRF, path traversal, insecure defaults, and risky new dependencies. For each: file and line, how it would be exploited, and the fix. Ignore problems the diff doesn't touch. Under 300 words.

List the PR's commits too (`git log --oneline origin/<base>..HEAD`). A commit that reverts another PR (its message starts `Revert "`, or it undoes a merged PR's changes) breaks the flow unless the brief asks for that revert.

## 3. Fix what breaks the flow

Fix each point of a send-back comment (step 1) first: the harness supervisor has already decided it breaks the flow. Then sort every finding from the three reports by "What to fix" in `docs/agents/review.md`: **fix** the ones that break the flow, and **leave** the rest. Drop anything a check in the verify command would catch, and anything already raised and settled in the PR's conversation.

Fix each one on the branch, test-first for a change in behaviour (call the Skill tool with `tdd`), with commits that reference the PR's issue. A finding you can't fix from this PR (it needs a human, access you lack, or a decision the brief doesn't make) is left, with the reason; that goes for a send-back point too.

Run the verify command, `node .harness/src/cli/verify.ts`, until it's green. If you changed anything, update the PR's `## Commit message` section (and its title, if the scope moved) so it still describes the whole diff, and its `## Human steps` section so it lists every step the final diff needs ("Branches, PR titles and commit messages" in `docs/agents/issue-tracker.md`), with `github-write` ("Update a PR" in `docs/agents/issue-tracker.md`, "Writing").

## 4. Post the summary, then push

Post the summary **before** you push: the dispatcher counts it as your run's review, so it must be on GitHub before the push's CI can finish ("Review budget" in `docs/agents/review.md`). Write it to `review.json` and post it with `node .harness/src/cli/github-write.ts POST repos/{owner}/{repo}/pulls/<n>/reviews --input review.json`, on the commit you reviewed (the PR's head when you started):

```json
{
  "commit_id": "<the full SHA of the head you reviewed>",
  "event": "COMMENT",
  "body": "<!-- agent-review -->\n**Sent back:** <only after a send-back: each point by its number, one line each, with how you addressed it and the commit, or why you didn't>\n**Changed:** <each fix, one line each, with its commit; or 'Nothing: no finding broke the flow.'>\n**Left:** <each finding you left, one line each, with why>\n<!-- agent -->"
}
```

Check that `github-write` printed the posted review's `id`. If it failed, fix the cause and post it again until the review is on GitHub: until it is, the dispatcher would take your push for an unreviewed PR and start another run. Keep it short: one line a finding. Post no inline comments; nobody answers them. List every finding you left, so `/harness-retro` can ticket the ones worth doing.

Remove `needs-review` from the PR if it's there. Then push (`git push`), if you committed anything. Don't wait for CI: if your push turns it red, the dispatcher starts the second run, and after that the harness supervisor decides.

## 5. Retro

Call the Skill tool with `retro`. Each finding you fixed is a `review-catch` event: its target is whatever should have stopped it reaching review (a check, a coding standard, context).

**Done when** the summary review is posted, every fix is pushed, and the retro is posted, or the PR is `agent-blocked` with a comment saying why, and the retro is posted.
