---
name: implement
description: 'Implement a GitHub issue end to end: branch, build test-first, verify, open or update the PR, retro. Use when an agent routine or a human asks to implement an issue by number.'
---

Implement the issue numbered in the arguments. Based on the upstream `implement` skill (see `.agents/skills/UPSTREAM.md`), wrapped in this repo's workflow. Read `docs/agents/runners.md` once for the `AGENT_*` variables, and `docs/agents/issue-tracker.md` for the `gh` commands.

The run is idempotent: it finds existing work for the issue and resumes it, so it is safe to re-run at any point.

## 1. Load the brief

Read the issue and its comments (`docs/agents/issue-tracker.md` has the commands for everything in this skill), and state its title.

- **The brief** is the latest `## Agent Brief` comment, or else the issue body if it has acceptance criteria (a ticket from `/to-tickets` or a spec from `/to-spec`). With no brief, comment what's missing, apply `agent-blocked`, and go to step 7.
- **Blockers:** if the issue is blocked by an open issue (its `blocked_by` count, or an open issue in a `Blocked by` line), comment which issue it's waiting on and go to step 7 with outcome `waiting`. Leave the labels as they are: it is picked up again when the blocker closes.
- Read the domain docs described in `docs/agents/domain.md`.

## 2. Resume or start

Look for an existing branch and PR (`docs/agents/issue-tracker.md`, "Find existing work"):

- **Open PR:** check out its branch, read the PR conversation, and continue from where it got to.
- **Branch, no PR:** check it out and continue.
- **Merged or closed PR:** comment that the issue already has a finished PR and stop.
- **Nothing yet:** pick the Conventional Commits type for the change (`feat` for new behaviour, `fix` for a
  bug, and so on) and a slug of one to four words, then
  `git fetch origin && git switch -c <type>/<n>-<slug> origin/main`, e.g. `feat/13-health-check`
  ("Branches, PR titles and commit messages" in `docs/agents/issue-tracker.md`).

Work on that branch even if the session started on another one: cloud sessions start on a generated branch
such as `claude/kind-wright-bb5hda`, and later runs find the work by the `<type>/<n>-` name.

If the branch is behind `origin/main`, merge it in. Never rebase or force-push.

**Don't revert another PR's merge on your branch** unless the brief asks for it (#114): it would undo that PR on `main` when yours merges. If `main` is red, the harness supervisor fixes it forward ("Main is red" in `docs/agents/runners.md`). If your change doesn't depend on the broken part, carry on. Otherwise comment on the issue what you're waiting for and why, apply `agent-blocked`, and go to step 7.

## 3. Plan

Post a plan as an issue comment starting `<!-- agent-plan -->` (edit your earlier plan comment if there is one):

- for each acceptance criterion, the behaviour that changes
- the modules and interfaces you expect to touch
- the **seams** you'll test at: the ones the brief or spec names; otherwise the highest existing seam, stated as your choice
- anything in the brief you find ambiguous, with the reading you'll take

In a cloud run, end the plan with the session link (`https://claude.ai/code/${CLAUDE_CODE_REMOTE_SESSION_ID/#cse_/session_}`), so the human can find the session to steer it.

Post it with `github-write` ("Writing" in `docs/agents/issue-tracker.md`): it's on GitHub as soon as the command returns. Then go straight on to step 4.

## 4. Build

When the change has behaviour a test can observe, call the Skill tool with `tdd`; the seams in your plan count as pre-agreed. When it changes only skill or doc text, edit it directly, and name the verify command as the check in the plan's seams line.

Typecheck and run single test files as you go (`moon run <project>:typecheck`; for one test file, `npx jest <path>` from inside the project's directory, since jest needs the project's config; for a harness test, `node --import ./.harness/src/test/setup.ts --test <path>` from the root). Commit in small steps with messages that reference `#<n>`.

If you hit something you can't resolve (missing access, a requirement you can't satisfy, a contradiction in the brief), comment exactly what you need, apply `agent-blocked`, and go to step 7.

## 5. Review and verify

Call the Skill tool with `code-review`, with `origin/main` as the fixed point, on every diff whatever its size. Its standards and spec reviews must run as sub-agents, so each reads the diff fresh. Fix every hard finding; fix judgement calls you agree with and note the rest for the PR.

**Removals:** when the change deletes a feature, rule or value, search for every way the repo still states it, not only its identifiers: the word stems a reader would use (e.g. `supervis`, `graduat`, `checkpoint`), the rule's wording in prose, and types, unions and comments that name a value nothing produces now. Update each hit, unless it's history (an ADR, a dated plan entry, a retro). List the stems you searched in the PR body.

Run the verify command, `node .harness/src/cli/verify.ts` (it runs `verify` from `harness.config.json`), until it's green.

## 6. Open or update the PR

Re-read the issue. If it's closed, the run was cancelled: push the branch so the work isn't lost, open no PR, and go to step 7 with outcome `abandoned`.

Push with `git push -u origin <branch>`. Call the Skill tool with `pr` for the body, and include `Closes #<n>`. If the diff changes anything only a human can apply once it merges, add a `## Human steps` section listing each step; with no such change, leave the section out. End the body with the `## Commit message` section, and title the PR as a Conventional Commit with the branch's type (all in "Branches, PR titles and commit messages", `docs/agents/issue-tracker.md`). Create the PR if there isn't one; otherwise update its title and body. Remove `agent-ready` from the issue. Don't add `needs-review`: review starts by itself once CI is green. Make each of these writes with `github-write`, which returns once the write is on GitHub.

Wait for CI on the head commit with `node .harness/src/cli/wait-for-ci.ts` (give the command a 15-minute timeout; it exits 0 when CI passes and 1 with the failing checks when it doesn't). If it fails, fix it and push. After three red runs in a row, comment what's failing, apply `agent-blocked` to the PR, and go to step 7.

## 7. Retro

Call the Skill tool with `retro`.

**Done when** the PR is open with green CI and the retro is posted, or the issue or PR is `agent-blocked` (or waiting on a blocker) with a comment saying why, and the retro is posted.
