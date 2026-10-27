# software-factory

> **Agents:** to install or upgrade software-factory in a project, follow [`INSTALL.md`](INSTALL.md).

software-factory turns a GitHub repository into a place where AI agents do the software work and a person
steers. You write down what you want as an issue. Agents build it, review it, fix it, merge it and keep `main`
green, and they come to you only for what needs your judgement or your access.

To install it, give any coding agent in your project this prompt:

```text
Install software-factory into this repo: follow INSTALL.md in DavidHooper/software-factory
```

## How it works

1. **You file an issue** with a short brief: what to build and how to know it's done. Labelling it `agent-ready`
   starts the work.
2. **A coding agent builds it** test-first in a cloud session you can watch, then opens a pull request.
3. **CI runs.**
4. **A fresh agent reviews the pull request** for standards, the brief and security, fixes what it finds, and
   posts a summary of what it changed and what it left.
5. **The supervisor decides.** It is an agent too, standing in for you. It merges the pull request, makes a
   small fix itself, sends it back once for another review-and-fix run, or asks you.
6. **If `main` breaks, the supervisor fixes it forward.**
7. **Every run writes a short retro** (optional per project). A weekly retro turns them into proposals, and the
   supervisor turns the good ones into new issues, so the factory improves its own process.

Under the hood it is a handful of GitHub Actions workflows that react to labels and CI, two Claude Code routines
(a coding agent and a supervisor), and a small Node toolkit in `.harness/`. Labels on issues are the state.

## Principles

**Trust the agents.** This is the controversial one. Most agent setups surround the model with guards: command
filters, path allow-lists, signed approvals, stop hooks, revision caps. software-factory started that way and
removed nearly all of it ([ADR 0004](docs/adr/0004-trust-the-agents.md)): the code halved, and the agents got
better at the work, not worse. Agents here can change any file, the factory's own rules included. They are
expected to behave like a capable colleague with commit access, and when they don't, the retro says so and the
process is fixed. The few hard limits left are the ones a colleague would also have: the bot can't touch your
repository settings, secrets or the kill switch, and each project's bot can reach only its own repository. If you
need stronger guarantees than that, this is not the right tool, or you add them in your project.

**The supervisor decides, not a rulebook.** Merging, fixing, sending back and escalating are judgement calls made
by an agent reading the pull request against its brief, not a checklist of conditions. The fixed rules that remain
(CI green, reviewed, no conflict, nothing waiting on a human) are the minimum, never the decision.

**You steer; you don't operate.** Your part is direction (issues and briefs), answers to real questions, and
things only you can do (accounts, secrets, billing). Everything routine a maintainer would do, the supervisor
does. If you find yourself doing routine work, that's a bug in the factory.

**Fix only what breaks the flow.** Reviews fix what would break the product or the workflow and leave the rest as
notes. A pull request is never held hostage to polish.

**Fix forward.** A red `main` is fixed by the next change, not by reverting and arguing.

**Simple over safe-looking.** Every part has to earn its place. A guard that never caught anything real is cost,
not safety. When in doubt, delete it and let the retros show whether it was needed.

**Learn from every run.** Retros are cheap, honest and specific, and they are how the factory changes. Proposals
become issues like any other work, built by the same agents.

**Stable for others, fast for us.** Projects install tagged releases and upgrade when they choose. The factory's
own repository moves quickly; releases are cut by its supervisor when a batch of changes is ready.

## What's in the repository

| Path | What it is |
| --- | --- |
| `.harness/` | The runtime: dispatcher, relay, supervisor tick and CLIs, in TypeScript run with plain `node` |
| `.agents/skills/` | The skills agents run: `implement`, `review-pr`, `supervise`, `retro`, `harness-retro`, planning and dev skills |
| `.github/workflows/agent-*.yml`, `supervisor-tick.yml` | The workflows that turn GitHub events into agent runs |
| `docs/agents/` | How the factory works, for agents and people |
| `INSTALL.md` | Install and upgrade instructions, written for an agent to follow |
| `docs/adr/` | Why it is shaped this way |

software-factory is developed with itself: its issues are worked by its own agents and supervisor.
