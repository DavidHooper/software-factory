# Agent harness

Guidance for coding agents working in a repository that runs this agent harness. The project's own guidance
(its layout, toolchain and how to verify it) is in `AGENTS.md`, which points here.

## Agent workflow

Work is tracked in GitHub Issues and moves through a label-driven workflow: an issue with an Agent Brief is
labelled `agent-ready`, an agent implements it and opens a PR, one review-and-fix run reviews it and fixes what
breaks the flow, and the harness supervisor merges it, which needs the merge gate passed. Humans can step in at any point.

Read these before working on an issue or PR:

- `docs/agents/issue-tracker.md`: how to read and update issues and PRs, and which GitHub identity to use.
- `docs/agents/labels.md`: the label vocabulary and the state each label represents.
- `docs/agents/domain.md`: which domain docs (`GLOSSARY.md`, ADRs) to read, and how to use their vocabulary.
- `docs/agents/runners.md`: how the harness fits together, where agent runs execute, how they are routed, and the
  `AGENT_*` environment variables.
- `docs/agents/review.md`: which review findings a review run fixes, and how many review runs a PR gets.

Rules that apply to every agent run:

- **Branches** are named `<type>/<issue>-<slug>` with a Conventional Commits type, e.g. `feat/13-health-check`;
  PR titles are Conventional Commits, e.g. `feat(api): add health() function`. See "Branches, PR titles and
  commit messages" in `docs/agents/issue-tracker.md`. Never push to `main`.
- **Guardrails.** Nothing in the session enforces them, so follow "Guardrails" in `docs/agents/runners.md`
  yourself: your own branch only, GitHub changes through `github-write`, verify, push and retro.
- **Resume, don't restart.** Before creating a branch or PR, check whether one already exists for the issue and
  continue it.
- **Stop when blocked.** If you can't proceed (missing access, ambiguous requirements, conflicting review
  comments), comment with exactly what you need, apply `agent-blocked`, and stop.

## Claude Code

- Skills live in `.agents/skills/` (shared with other harnesses) and are symlinked into `.claude/skills/`. Edit
  the source in `.agents/skills/`, never the symlink.
- When the human asks what to work on or what needs them, point them to `/today`: it briefs them and starts new work.

## The harness folder

The harness's code is `.harness/`: the hooks, the CLIs the skills and workflows run, and their tests. It runs
on plain `node`, at the version pinned in `.harness/.node-version`, with no `npm install`: it uses only Node's
standard library, and Node runs its TypeScript directly. It doesn't depend on the project's `package.json`,
build tools or test runner.

- **Tests** use Node's test runner. Run them from the repository root:
  `node --import ./.harness/src/test/setup.ts --test '.harness/src/**/*.test.ts'`. `src/test/expect.ts` gives
  them the slice of jest's `expect`, `fn` and `it.each` API they use, without the dependency; `src/test/setup.ts`
  points them at a neutral fixture config instead of the project's.
- **The manifest**, `.harness/manifest.json`, lists every path the harness owns: the folder itself, the
  skills, the `.claude/` settings and skills link, the agent workflows and `docs/agents/`. Installing the
  harness into a project copies exactly these; everything else, `harness.config.json` included, belongs to the
  project. `src/manifest.test.ts` checks that every listed path exists and that no harness file is unlisted, so
  a new harness file goes into the manifest in the same change.
- **Project-specific values** live in the project's `harness.config.json`, never in a harness file ("Project
  config" in `docs/agents/runners.md`).
