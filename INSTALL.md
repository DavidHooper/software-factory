# Installing software-factory

Instructions for an agent. A person starts it with one of these prompts in a session on their project:

```text
Install software-factory into this repo: follow INSTALL.md in DavidHooper/software-factory
Upgrade software-factory in this repo to <version>: follow INSTALL.md in DavidHooper/software-factory
```

Work through the steps in order, tell the person what you're doing at each one, and stop to ask only where a step
says so. Steps marked **(person)** need them to click or paste something: give them the exact link or text, wait,
then carry on. Never print a private key or token in the conversation.

**Where to run it.** Steps 5–8 set GitHub Actions variables and secrets with `gh`, which works from Claude Code on
the person's own machine (with `gh auth status` showing an account that administers the repository) but not from
a cloud session, whose proxy refuses those endpoints. In a cloud session, do the other steps and hand the person the
`gh` commands for 5–8 to run themselves.

**Upgrading** runs steps 1–2 and 11 only, then any human steps listed in the release notes between the installed
version and the new one. An upgrade never touches project-owned files (step 3).

**Installing into software-factory itself**: its files are already there. Skip steps 1–3 and start at step 4.

## 1. Pick the version

- `git ls-remote --tags https://github.com/DavidHooper/software-factory` lists the releases. Use the version the
  person named, or the newest tag.
- If there are no tags yet, use `main` and record its commit hash as the version.
- On an upgrade, read the installed version from `.harness/installed.json` and show the person the release notes
  between the two versions (`https://github.com/DavidHooper/software-factory/releases`) before going on.

## 2. Copy the harness-owned files

1. Clone the version into a temporary directory outside the project:
   `git clone --depth 1 --branch <version> https://github.com/DavidHooper/software-factory <tmp>` (for a commit
   hash, clone `main` and check the hash out).
2. Read `<tmp>/.harness/manifest.json`. Its `paths` are everything the harness owns. For each path, delete the
   project's copy (if any) and copy the version's in its place. A path ending in `/` is a directory; copy it whole,
   keeping symlinks as symlinks (`.claude/skills` is a link to `../.agents/skills`).
3. Copy nothing else from `<tmp>`. Its `README.md`, `INSTALL.md`, `harness.config.json`, `package.json`,
   `verify.yml` and `docs/adr/` belong to software-factory, not the project.
4. Write `.harness/installed.json`: `{"version": "<tag or hash>", "installedAt": "<ISO date>"}`.

## 3. Create the project-owned files (first install only)

Create each of these only if it doesn't exist. Never overwrite one.

- **`harness.config.json`** at the repository root. Ask the person for the names (offer the defaults):

  ```json
  {
    "bot": "<repo>-agent",
    "routines": { "coding": "<repo>-agent", "supervisor": "<repo>-supervisor" },
    "environments": { "coding": "<repo>-agent", "supervisor": "<repo>-supervisor" },
    "verify": "<command>",
    "retros": false
  }
  ```

  For `verify`, find the command that checks the whole project (a `verify`, `check` or `test` script in
  `package.json`, `make check`, `pytest`, and so on) and confirm it with the person. Keep `retros` false unless the
  person asks for it: retros feed proposals back into the harness, and other projects have no route for that yet.
- **A `Verify` workflow**, `.github/workflows/verify.yml`, if no workflow is named `Verify`. The dispatcher listens
  for a workflow and a check both named `Verify`, on pushes to the default branch and on pull requests. It sets up
  what the project needs and runs the `verify` command. Don't mention `.harness/` in it, or the manifest test counts
  it as a harness file.
- **`AGENTS.md`**: add this section (create the file if there is none):

  ```markdown
  ## Agent workflow

  This repository runs the agent harness (`.harness/`). Its rules apply to every agent run and are in
  @docs/agents/harness.md: read it before working on an issue or PR.
  ```

  The rest of `AGENTS.md` is the project's own guidance: layout, toolchain, how to verify. If it has none, write a
  short draft from what you can see and tell the person to check it.
- **`CLAUDE.md`** containing `@AGENTS.md`, if there is none.
- **`GLOSSARY.md`**, **`docs/adr/`** and **`CODING_STANDARDS.md`**: the skills read them. Create a short stub of
  each that says it's the project's and how to fill it in.
- **`.gitignore`**: add `.agent-run/` and `.claude/worktrees/`.

## 4. Labels

Create every label in `docs/agents/labels.md`'s tables, with its meaning as the description:
`gh label create <name> --description "<meaning>" --force`.

## 5. The bot's GitHub App (first install only)

Each project gets its own App, installed only on its own repository. This runs on the person's machine: it opens
their browser.

1. Run `node .harness/src/cli/create-app.ts <owner>/<repo> <key file>` (add `--org` if the owner is an
   organisation), with `<key file>` a path outside the repository, such as `~/.config/<bot>.pem`. It opens a page
   in the browser and waits.
2. **(person)** On that page, click **Continue to GitHub**. GitHub shows the App, named as the config's `bot`,
   with its permissions filled in: Contents, Issues, Pull requests, Checks and Workflows read and write; Actions
   and Commit statuses read. They click **Create GitHub App**, and GitHub sends them back to the page.
3. The command prints `{"id", "slug", "keyPath", "installUrl"}` and writes the private key to `<key file>`. Don't
   open or print the key. If it prints an error instead (the code expired, or GitHub refused it), run it again.
4. **(person)** Open `installUrl`, choose **Only select repositories**, pick this repository, and install.
5. Look up the bot's user id for step 7: `gh api 'users/<slug>[bot]' --jq .id`.

## 6. Actions variables and secrets

```bash
gh variable set AGENT_APP_ID --body "<id>"
gh variable set AGENTS_PAUSED --body false
gh secret set AGENT_APP_PRIVATE_KEY < <key file>
```

Then delete the key file. `AGENTS_PAUSED` is the person's kill switch: setting it to `true` stops every agent run.

## 7. Cloud environments (person)

These can't be created by an agent. Give the person the values for both environments, named as the config's
`environments.coding` and `environments.supervisor`, from `docs/agents/cloud-routines.md` ("Environments"):

- **Network access:** Custom: the default allowlist, plus `nodejs.org` and `moonrepo.dev`, and anything the
  project's own setup needs.
- **Environment variables:**

  ```text
  AGENT_RUN=1
  AGENT_RUNNER=cloud
  AGENT_HARNESS=1
  GITHUB_AGENT_GIT_NAME=<slug>[bot]
  GITHUB_AGENT_GIT_EMAIL=<user id>+<slug>[bot]@users.noreply.github.com
  ```

- **Setup script:** the contents of `.harness/cloud-setup.sh`, plus anything the project's toolchain needs (for
  example installing moon, if the project pins it in `.prototools`).

They create them at claude.ai/code → Environments.

## 8. Routines

Two routines, as in `docs/agents/cloud-routines.md` ("Routines"): names from the config, this repository, no
connectors, the environment of the same role, Opus, and the prompts given there. The supervisor's routine also runs
hourly. The coding routine runs weekly only if `retros` is on.

If you have a tool that creates routines, create them with it; otherwise **(person)** creates them at
claude.ai/code/routines. Either way, the dispatcher fires each one through its **API trigger**: **(person)** adds
an API trigger to each routine, copies its URL and generates a token, and pastes both. Then:

```bash
gh secret set ROUTINE_AGENT_HARNESS_URL       # coding routine
gh secret set ROUTINE_AGENT_HARNESS_TOKEN
gh secret set ROUTINE_HARNESS_SUPERVISOR_URL  # supervisor routine
gh secret set ROUTINE_HARNESS_SUPERVISOR_TOKEN
```

Pipe each value in from what the person pasted; don't put it on the command line.

## 9. Branch protection (optional)

Suggest protecting the default branch with `Verify` required. On a private repository this needs a paid GitHub
plan; without it, nothing on GitHub stops a direct push to `main`, and the agents only avoid it by their rules.

## 10. Check it

Run the project's `verify` command and the harness tests (`node --import ./.harness/src/test/setup.ts --test
'.harness/src/**/*.test.ts'`). Fix anything the install caused.

## 11. Open the pull request

Commit on a branch named `chore/install-software-factory` (`chore/upgrade-software-factory-<version>` on an
upgrade) and open a pull request listing what was copied, what was created, and what's left for the person. The
person merges this first one: the supervisor doesn't run until the routines exist.

After it merges, offer a smoke test: an issue titled `chore: smoke test the agent workflow`, with a brief asking
for a one-line change to `README.md`, labelled `agent-ready`. If an `Agent status` comment appears within a few
minutes and a pull request follows, the factory is running.
