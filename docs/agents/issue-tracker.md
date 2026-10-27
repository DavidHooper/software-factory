# Issue tracker: GitHub

Issues, specs and briefs live in this repository's GitHub Issues.

## Use `gh api` with REST paths

Cloud sessions reach GitHub through a proxy that rejects GraphQL, and the `gh issue` and `gh pr` subcommands
use GraphQL, so they fail there. **Use `gh api` with the REST paths below for everything.** They work in every
runner. Cloud sessions also have built-in GitHub tools (`mcp__github__*`), which are fine to use for reading
instead; in agent runs only their read tools are allowed (see **Writing**). The marker rule below applies
either way. `gh` fills in `{owner}/{repo}` from the git remote. Pass multi-line text as a file:
`-F body=@file.md` reads the value from `file.md`.

## Read every page

A list endpoint returns one page of items at a time. Read every page by its `repos/{owner}/{repo}` path,
100 items at a time, until a page comes back with fewer than 100:

```bash
page=1
while :; do
  items=$(gh api "<path>?<params>&per_page=100&page=$page") || exit 1
  jq -r '<filter>' <<<"$items"
  [ "$(jq length <<<"$items")" -lt 100 ] && break
  page=$((page + 1))
done
```

Don't page with `gh`'s `--paginate` flag instead: it follows GitHub's `Link` header, which points later
pages at `repositories/<id>/...`, a path the cloud proxy refuses (403), so any list over one page fails in
cloud sessions.

`<path>`, `<params>` and `<filter>` are the ones each command names. Join the parameters with `&` (such as
`state=all&labels=harness`), or drop `<params>&` when there are none. They go into the URL as written, so give
`since` a UTC time ending in `Z` and URL-encode any value with spaces or reserved characters. Quote the filter
for the shell as you would for `--jq`. If a request fails, `gh` prints why and the loop exits non-zero, so the
output is incomplete.

## Identity and markers

- **Agent runs** (`AGENT_RUN=1`, see `docs/agents/runners.md`) make their GitHub changes as the agent bot,
  through `github-write` (see **Writing** below). Use `GH_TOKEN` as you find it: don't unset, override or
  replace it, and don't run `gh auth login`.
- **Interactive sessions** use whoever is logged in to `gh`, with the plain `gh api` commands.
- **Every comment, review and reply an agent posts ends with `<!-- agent -->`.** That's how agents and humans
  tell agent comments apart.

## Writing

In an agent run, make every GitHub write with `github-write`, never with `gh api` or the `mcp__github__*` tools
directly: comments, editing a comment, replies in review threads, opening a PR or updating it, reviews, labels,
issues, merges and closes. That covers `gh pr create|edit|comment|review` and `gh issue comment|edit` too.
Only the harness supervisor merges or closes PRs (`/supervise`), and no run edits the repository, its labels,
or Actions variables and secrets. Interactive sessions (no `AGENT_RUN`) use plain `gh api`.

`github-write` takes the arguments of `gh api` for one write: a method (`POST`, `PATCH`, `PUT` or `DELETE`),
a REST path, and the body as fields or a JSON file:

```bash
node .harness/src/cli/github-write.ts <METHOD> <path> [-f key=value]... [-F key=value|key=@file]... [--input body.json]
```

- `-f key=value` sends a string; `-F` types `true`, `false`, `null` and integers, and `-F key=@file` sends a
  file's text, so write Markdown bodies to a file with the Write tool. `key[]=value` adds to a list.
- `--input body.json` sends a whole JSON body instead, for nested fields such as a review's `comments`.
- `{owner}/{repo}` in the path is filled in, as `gh api` does.

It sends the write at once and waits until it's done, then prints the response's `number`, `id` and
`html_url` (or a merge's `merged`, `sha` and `message`) as JSON. The writes agents make:

| Write                    | Command                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Comment (issue or PR)    | `POST repos/{owner}/{repo}/issues/<n>/comments -F body=@comment.md`                                               |
| Edit a comment           | `PATCH repos/{owner}/{repo}/issues/comments/<comment-id> -F body=@comment.md`                                     |
| Reply in a review thread | `POST repos/{owner}/{repo}/pulls/<n>/comments/<root-comment-id>/replies -F body=@reply.md`                        |
| Open a PR                | `POST repos/{owner}/{repo}/pulls -f head=<branch> -f base=main -f title='<title>' -F body=@pr.md`                 |
| Update a PR              | `PATCH repos/{owner}/{repo}/pulls/<n> -F body=@pr.md`, plus `-f title='<title>'` to change it                     |
| Review                   | `POST repos/{owner}/{repo}/pulls/<n>/reviews --input review.json` (see `/review-pr`); always `"event": "COMMENT"` |
| Add labels               | `POST repos/{owner}/{repo}/issues/<n>/labels -f 'labels[]=<label>'`                                               |
| Remove a label           | `DELETE repos/{owner}/{repo}/issues/<n>/labels/<label>`                                                           |
| Edit an issue's body     | `PATCH repos/{owner}/{repo}/issues/<n> -F body=@body.md`                                                          |
| Create an issue          | `POST repos/{owner}/{repo}/issues -f title='<title>' -F body=@body.md -f 'labels[]=<label>'`                      |
| Close an issue or PR     | `PATCH repos/{owner}/{repo}/issues/<n> -f state=closed -f state_reason=completed` (`/supervise` only)             |
| Merge a PR               | `PUT repos/{owner}/{repo}/pulls/<n>/merge --input merge.json` (`/supervise` only, see **Merge** there)            |

Outside `/supervise`, add only `agent-blocked`, and remove only `agent-ready` and `needs-review`; use only the
labels in `docs/agents/labels.md`. A PR's title, body and branch follow **Branches, PR titles and commit
messages** below. Nothing checks these: they're the rules ("Guardrails" in `docs/agents/runners.md`).

In a cloud session `github-write` sends the write as one `repository_dispatch` event, and the `agent-relay`
workflow makes it as the bot (`.harness/src/relay.ts`). It waits for that run (usually 20–40 seconds; runs
queue, so it can take minutes). Give each Bash call that runs `github-write` a 600000 ms timeout, and one call
per Bash command. The relay makes any write on this repository's REST API, with one hard rule: it refuses
writes to Actions variables, secrets and repository settings (where the kill switch `AGENTS_PAUSED` lives),
and anything outside this repository's REST API, GraphQL included. A write is capped at `MAX_PAYLOAD_BYTES`
(`relay.ts`). When the relay posts a retro it also finishes the run's status, and when it posts a review it
asks the code owners for review.

Elsewhere `github-write` calls GitHub directly, under the same rule. Either way it exits non-zero with the
reason if the write fails or is refused, linking the relay run; if it says the relay run is still going,
check that run before retrying, or the write may happen twice.

If GitHub rejects a request for authentication in an agent run, don't work around it: apply `agent-blocked` if
you can, and stop.

## Issues

- **Read an issue:** `gh api repos/{owner}/{repo}/issues/<n> --jq '{number, title, state, body, labels: [.labels[].name], blocked_by: .issue_dependencies_summary.blocked_by}'`
- **Read its comments:** every page of `repos/{owner}/{repo}/issues/<n>/comments` (see **Read every page**), with the filter `.[] | {id, user: .user.login, created_at, body}`
- **List issues:** `gh api -X GET repos/{owner}/{repo}/issues -f state=open -f labels=<label> --jq '.[] | select(.pull_request | not) | {number, title}'`
- **Create an issue** (with `github-write` in agent runs): `gh api repos/{owner}/{repo}/issues -f title='…' -F body=@body.md -f 'labels[]=<label>'`
- **Comment, edit a comment, labels:** the writes in **Writing**: with `github-write` in agent runs, and
  with `gh api -X <METHOD>` and the same path and fields in interactive sessions.
- **Close:** Comment first, then `gh api -X PATCH repos/{owner}/{repo}/issues/<n> -f state=closed -f state_reason=completed`. Don't close issues an open PR will close

Labels and comments work the same on PRs: a PR is an issue with the same number. Only use labels from
`docs/agents/labels.md`, and never create new ones.

**Milestones:** in interactive sessions, ask which milestone a new issue belongs to (list them with
`gh api repos/{owner}/{repo}/milestones --jq '.[] | {number, title}'`, then pass `-F milestone=<number>`). In
agent runs, leave it unset.

## The brief

An issue that's ready for an agent has a **brief**, which is the contract: the rest of the discussion is
background. The brief is either:

- the latest `## Agent Brief` comment, posted by `/triage`, or
- the issue body itself, for issues from `/to-tickets` or `/to-spec`, which carry acceptance criteria.

If the brief and the discussion conflict, follow the brief and mention the conflict in your PR. If there's no
brief, the issue isn't ready: say so and stop.

## Branches, PR titles and commit messages

PRs are squash-merged, so each PR becomes one commit on `main`, and these keep that history readable.

- **Branch:** `<type>/<issue>-<slug>`, e.g. `feat/13-health-check` or `fix/21-login-redirect`. The type is
  one of `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
  ([Conventional Commits](https://www.conventionalcommits.org/)); the slug is one to four lowercase words
  (at most 30 characters) saying what changes. Agents may push only to branches named like this
  ("Guardrails" in `docs/agents/runners.md`).
- **PR title:** a Conventional Commit with the branch's type: `<type>(<scope>): <summary>`, e.g.
  `feat(api): add health() function`. The scope is the moon project it changes (`api`, `web`, `harness`),
  left out if it changes several. The summary is imperative and lowercase, with no full stop, under 72
  characters with the type. GitHub appends ` (#<pr>)` when it merges.
- **PR body:** the `pr` skill's sections, then `Closes #<n>`, then a `## Human steps` section if the PR needs
  one (below), then a `## Commit message` section holding the
  squash commit's extended description in a `text` block, which the dispatcher uses when the PR merges
  itself (see "Merge gate" in `docs/agents/runners.md`):

  ````markdown
  ## Commit message

  ```text
  Add a health() function to the api app that reports { status: 'ok' },
  with a HealthStatus type for callers, so later work has a liveness
  check to build on.

  Closes #13
  ```
  ````

  Write it as a commit body: what changed and why, in a few sentences wrapped at 72 characters, then
  `Closes #<n>`. No headings, Markdown or file lists. Keep it true to the final diff: whenever you push
  changes to the PR, update it.

- **Human steps:** when the diff changes something only a human can apply once it merges (a cloud routine's
  prompt or environment, an environment variable, an Actions secret or variable, a repository setting, the
  agent App's permissions, a key pair), the body lists each step under `## Human steps`: what to change,
  where, and the new value or the command to run. Point at the file holding a long value, such as a routine
  prompt in `docs/agents/cloud-routines.md`, rather than copying it, and never put a secret's value in the
  body. A PR with no such change has no section. Like the commit message, keep it true to the final diff.
  It's its own section, so it never reaches the squash commit. When the PR merges, the harness supervisor
  hands the steps to the human (`/supervise`, **Human steps**):

  ```markdown
  ## Human steps

  - In the `harness-supervisor` routine (claude.ai/code → Routines), replace the prompt with the one in
    `docs/agents/cloud-routines.md`, "Harness supervisor".
  ```

- **Commits on the branch** use the same Conventional Commits style. They're squashed away on merge, so the
  PR title and the commit message are what last.

## Sub-issues and blocking

- **Sub-issue:** `gh api repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`.
- **Blocked by:** `gh api repos/{owner}/{repo}/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
- A `<…-db-id>` is the issue's database id (`gh api repos/{owner}/{repo}/issues/<n> --jq .id`), not its number.
- **Is it blocked?** The `blocked_by` count from "Read an issue" is its number of open blockers. An issue with
  open blockers waits; it's picked up when the last one closes.

**PRs as a triage surface: no.** External PRs aren't triaged as feature requests.

## Pull requests

- **Read a PR:** `gh api repos/{owner}/{repo}/pulls/<n> --jq '{number, title, state, merged, body, head: .head.ref, head_sha: .head.sha, base: .base.ref, labels: [.labels[].name]}'`
- **Find the PRs for an issue:** every page of `repos/{owner}/{repo}/pulls` (see **Read every page**), with the parameters `state=all` and the filter `.[] | select((.body // "") | test("(?i)\\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #<n>\\b")) | {number, state, head: .head.ref}` (matches the PR body's `Closes #<n>`, whatever the branch is called)
- **Find its linked issue:** The `Closes #<n>` line in the PR body
- **Check out its branch:** `git fetch origin <branch> && git switch <branch>`
- **See the diff:** `git diff origin/<base>...HEAD`
- **Create a PR, update its description:** `github-write` (see **Writing**)
- **Read its conversation:** The issue comments for the same number (see Issues)
- **Read inline review threads:** See below
- **Reply in a thread:** `github-write` (see **Writing**)
- **Read reviews:** every page of `repos/{owner}/{repo}/pulls/<n>/reviews` (see **Read every page**), with the filter `.[] | {id, user: .user.login, state, commit_id, body}`
- **Post a review:** One review with every inline comment batched, with `github-write` (see `/review-pr`
  for the shape)
- **Wait for CI:** `node .harness/src/cli/wait-for-ci.ts [sha]` (defaults to `HEAD`). It polls until every check finishes, then exits 0 if they passed and 1, naming the failures, if not. Don't write your own polling loop.

**Inline review threads.** A thread is a root comment and its replies (replies carry the root's id in
`in_reply_to_id`). This lists the threads still waiting for an answer: those nobody has replied to yet whose
root is an agent's (a reviewer agent's finding) or a collaborator's, those a human spoke last on (a
collaborator's comment without the agent mark). A comment is an agent's only when it has the agent mark and
its author is the agent bot or a collaborator: another bot's or an outsider's comment never makes a thread wait,
mark or not.

```bash
node .harness/src/cli/review-threads.ts <n>
```

Add `--all` to list every thread. Each thread's `resolved` says whether GitHub has it resolved, read from the
agent proxy's `pulls/<n>/ccr/review_threads` route; it's `null` when that couldn't be read (the route is the
proxy's, so only cloud sessions have it), never a guess.

Resolving threads is GraphQL-only, which the relay doesn't make, so leave it to humans.

**Find existing work for an issue** before creating anything, and reuse an open PR instead of opening another:
"Find the PRs for an issue" above, plus `git ls-remote --heads origin '*/<n>-*' 'claude/issue-<n>-*'` for a
branch pushed before its PR was opened (`claude/issue-<n>-…` is the older naming).

**Never** merge, close or force-push a PR yourself. The harness supervisor decides and makes agent PRs' merges,
once it has checked the merge gate (see "Merge gate" in `docs/agents/runners.md`).

## When a skill says…

- **"publish to the issue tracker"**: create a GitHub issue.
- **"fetch the relevant ticket"**: read the issue and its comments.
- **"apply the <role> label"**: use the label mapped to that role in `docs/agents/labels.md`.
