# AGENTS.md

Guidance for coding agents working in this repository. Claude Code loads it through `CLAUDE.md`.

## Project state

This repository is **software-factory**: the agent harness itself. It is developed by the harness it ships (it is
installed on itself), and other projects install tagged releases of it by following `INSTALL.md`.

- `.harness/` — the harness runtime: TypeScript run with plain `node`, no dependencies. Its tests sit beside the
  code (`*.test.ts`) and use Node's built-in test runner.
- `.agents/skills/`, `.claude/`, `.github/workflows/agent-*.yml`, `.github/workflows/supervisor-tick.yml`,
  `docs/agents/` — the rest of what an install copies. `.harness/manifest.json` lists every harness-owned path.
- Project-owned here (never copied into other projects): `harness.config.json`, `package.json`,
  `.github/workflows/verify.yml`, this file, `README.md`, `INSTALL.md`, `GLOSSARY.md`, `CODING_STANDARDS.md` and
  `docs/adr/`.

A change to a harness-owned file reaches other projects only through a release and their upgrade, so treat its
behaviour as an interface: when a change needs installed projects to do something (a new config key, a routine
prompt change, a human step), say so in the PR's `## Human steps` so the release notes carry it.

## Verifying changes

- `npm ci` once after cloning, then `npm run verify` (typecheck plus every harness test) before reporting work
  as done. `npm test` runs only the tests.
- CI runs the same in the `Verify` check (`.github/workflows/verify.yml`).
- Node is pinned in `.harness/.node-version` (and mirrored in `package.json`'s `engines` for CI).

## Agent workflow

This repository runs the agent harness (`.harness/`). Its rules apply to every agent run and are in
@docs/agents/harness.md: read it before working on an issue or PR. Why the harness is shaped as it is is in
`README.md` and `docs/adr/0001`–`0004`.
