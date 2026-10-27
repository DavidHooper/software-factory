---
name: retro
description: "Retrospective on a coding session: records what went wrong or was missing, and proposes fixes to the agent's environment. Use at the end of every implement or review-pr run, or when the user asks for a retro."
---

You are recording a **retrospective** on this session, so the environment that agents work in (context docs, skills, checks, tooling) gets better after every run. Based on the upstream `retro` skill (see `.agents/skills/UPSTREAM.md`).

Propose; never apply: `/harness-retro` turns retros into harness changes.

**Retros off.** First run `node .harness/src/cli/config.ts retros`. If it prints `false`, the project has retros off ("Project config" in `docs/agents/runners.md`): skip steps 1 and 2, record no events, and in an agent run post only a **run report** (step 4). Never post a retro then.

## 1. Gather the evidence

1. Call the Skill tool with `writing-for-agents`, the style guide for any fix you propose to a document agents read.
2. Read the primary sources for this session:
   - the conversation itself, including tool calls that were denied, failed or retried
   - `.agent-run/interjections.jsonl` if it exists: one line per human message. The first line is the prompt that started the run; **every later line is a human interjection**
   - comments and review threads on the PR (or issue) since the run started, from humans and reviewer agents
   - CI runs during the session (the check runs on each commit you pushed)

## 2. Record events

An **event** is a moment the environment let the agent down. Each has a category:

- `human-correction`: a human interjected, redirected or corrected the agent. The highest-value signal: anything a human had to say is context the environment should have supplied.
- `review-catch`: a reviewer (human or agent) found something that a check, a standard or the context should have prevented.
- `missing-context`: the agent had to discover something that should have been written down (a convention inferred from code, an unwritten rule).
- `wrong-assumption`: the agent acted on a belief that turned out false.
- `tool-friction`: denied commands, flaky or slow checks, repeated retries, expensive tool calls.
- `brief-gap`: the brief was ambiguous, contradictory or missing acceptance criteria.

For each event record: the evidence (a quote or link), the cost (`minor`: cost a step; `major`: wrong output, a fix at review, or a human had to step in), the **target** (the file, skill, check or tool that should change), and a concrete fix of one of these kinds, preferring earlier ones:

1. **Automated check**: a mistake with a fixed shape (a banned API, an import shape, a file-location rule) gets a lint rule, test or hook, not prose. Look at what the verify command (`verify` in `harness.config.json`) and CI already run first; a check that exists but isn't wired up is the finding.
2. **Coding standard**: a judgement call no check could make goes in `CODING_STANDARDS.md`, which the reviewer reads. The reviewer, not the implementer, enforces standards.
3. **Skill or doc**: a step, gotcha or reference behind a pointer (a skill, `docs/agents/`, `GLOSSARY.md`, an ADR).
4. **Navigation pointer** in `AGENTS.md`: only when the agent couldn't find something it needed. `AGENTS.md` is loaded into every session, so it holds pointers, not content.
5. **Information access**: a log, read-only service access or tool output the agent needed and couldn't see.
6. **Removal**: an instruction that changed nothing (a no-op) or went stale.

**Done when** every interjection after the first is accounted for, either as an event or noted as "not an environment gap" with the reason, and every review finding from this session is either an event or explained.

## 3. Post the retro

In an agent run (`AGENT_RUN=1`), post one comment on the PR, or on the issue if there's no PR, with exactly this shape:

````markdown
<!-- agent-retro v1 -->

## Agent retro

**Skill:** implement · **Issue:** #12 · **PR:** #34 · **Runner:** cloud · **Model:** <model> · **Outcome:** pr-opened · **CI attempts:** 1 · **Session:** <link>

### Events

1. **human-correction** · major · `docs/agents/issue-tracker.md`
   Evidence: "<quote or link>"
   Fix (skill or doc): <the concrete edit>

<!-- or, when nothing went wrong: -->

No events: <one line on why the run went smoothly>

<details><summary>Data</summary>

```json
{
  "version": 1,
  "skill": "implement",
  "issue": 12,
  "pr": 34,
  "runner": "cloud",
  "model": "<model>",
  "outcome": "pr-opened",
  "ciAttempts": 1,
  "session": "<link>",
  "interjections": 1,
  "events": [
    {
      "category": "human-correction",
      "cost": "major",
      "target": "docs/agents/issue-tracker.md",
      "fixKind": "skill-or-doc",
      "summary": "<one line>"
    }
  ]
}
```

</details>

<!-- agent -->
````

The session link is `https://claude.ai/code/${CLAUDE_CODE_REMOTE_SESSION_ID/#cse_/session_}` in cloud runs, and omitted locally. `outcome` is one of `pr-opened`, `reviewed`, `blocked`, `waiting` (blocked by another issue) or `abandoned`, or for `/supervise`, `supervised-run`. `fixKind` is one of `automated-check`, `coding-standard`, `skill-or-doc`, `navigation-pointer`, `information-access`, `removal`. Don't edit an earlier retro comment: each run posts its own.

Post it with `github-write` as a comment ("Writing" in `docs/agents/issue-tracker.md`): it prints the comment's `html_url`.

In a human's own session (no `AGENT_RUN`), present the events to the user instead, most severe first, and post the comment only if they ask.

## 4. Run report (retros off)

The relay finishes the run's status (the `Agent review` check or the issue's `Agent status` comment) from this comment, so an agent run with retros off still posts it, where the retro would have gone, with the same `github-write` command:

````markdown
<!-- agent-run v1 -->

## Agent run

**Skill:** implement · **Issue:** #12 · **PR:** #34 · **Outcome:** pr-opened · **Session:** <link>

<details><summary>Data</summary>

```json
{
  "version": 1,
  "skill": "implement",
  "issue": 12,
  "pr": 34,
  "runner": "cloud",
  "outcome": "pr-opened",
  "session": "<link>"
}
```

</details>

<!-- agent -->
````

The fields and outcomes are the retro's, without `events` or `interjections`.
