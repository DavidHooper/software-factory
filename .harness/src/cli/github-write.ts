// Makes one GitHub write as the agent bot. Usage:
//   node .harness/src/cli/github-write.ts <METHOD> <path> [--input file.json] [-f key=value]... [-F key=value|key=@file]...
// The arguments are those of `gh api` for a write (parseWriteArgs in
// ../github-write.ts): a method, a REST path (`{owner}/{repo}` is filled in),
// and a JSON body from fields or a file. From a cloud session the write is
// relayed through the agent-relay workflow, because the cloud proxy would
// make it as the human who connected GitHub; elsewhere it is made directly
// with the session's own token (the bot's, in GitHub Actions). Either way it
// is sent at once, waits until it's done, and prints the response's number,
// id and URL as JSON.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StatusSync } from '../agent-status.ts';
import {
  ghApi,
  parseWriteArgs,
  relayFailure,
  relayResult,
  REPO_ROOT,
} from '../github-write.ts';
import {
  applyWrite,
  defaultCodeOwners,
  MAX_PAYLOAD_BYTES,
  parseRelayWrite,
  RELAY_EVENT,
  RELAY_TIMEOUT_MS,
  writeSummary,
  type RelayWrite,
} from '../relay.ts';

const gh = ghApi();

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface WorkflowRun {
  id: number;
  display_title: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

/** Sends one write to the relay, waits for its run, and returns its summary. */
async function relay(write: RelayWrite): Promise<Record<string, unknown>> {
  const id = randomUUID();
  const payload = { event_type: RELAY_EVENT, client_payload: { id, write } };
  const bytes = Buffer.byteLength(JSON.stringify(payload.client_payload));
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `The write is ${bytes} bytes, over the relay's ${MAX_PAYLOAD_BYTES} (MAX_PAYLOAD_BYTES in relay.ts): send a shorter body.`,
    );
  }
  gh(['repos/{owner}/{repo}/dispatches', '--input', '-'], payload);

  const deadline = Date.now() + RELAY_TIMEOUT_MS;
  let run: WorkflowRun | undefined;
  while (Date.now() < deadline) {
    await sleep(5_000);
    const { workflow_runs: runs } = JSON.parse(
      gh([
        'repos/{owner}/{repo}/actions/workflows/agent-relay.yml/runs?event=repository_dispatch&per_page=30',
      ]),
    ) as { workflow_runs: WorkflowRun[] };
    run = runs.find((r) => r.display_title === `${RELAY_EVENT} ${id}`);
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(relayFailure(gh, run));
      }
      return relayResult(gh, run);
    }
  }
  throw new Error(
    run
      ? `The relay run is still going after ${RELAY_TIMEOUT_MS / 60_000} minutes: ${run.html_url}. Check it before retrying, or the write may happen twice.`
      : 'The relay run never started. Is .github/workflows/agent-relay.yml on main?',
  );
}

function codeOwners(): string[] {
  try {
    return defaultCodeOwners(
      readFileSync(resolve(REPO_ROOT, '.github/CODEOWNERS'), 'utf8'),
    );
  } catch {
    return [];
  }
}

try {
  const viaRelay =
    process.env.AGENT_GITHUB_WRITE === 'relay' ||
    (process.env.AGENT_GITHUB_WRITE !== 'direct' &&
      process.env.CLAUDE_CODE_REMOTE === 'true');
  const repo = gh(['repos/{owner}/{repo}', '--jq', '.full_name']).trim();
  // Checked here too, so a refused write fails fast, and direct writes keep the rule.
  const write = parseRelayWrite(
    parseWriteArgs(process.argv.slice(2), repo, (path) =>
      readFileSync(path, 'utf8'),
    ),
    repo,
  );
  const summary = viaRelay
    ? await relay(write)
    : writeSummary(
        applyWrite(write, {
          gh,
          reviewers: codeOwners(),
          finishRun: (retro) => {
            try {
              new StatusSync(gh, repo).finishRun(retro);
            } catch {
              // Only GitHub Apps can write checks, so this fails in a human's session.
            }
          },
        }),
      );
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
