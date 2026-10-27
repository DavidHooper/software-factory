// Makes one relayed GitHub write in the agent-relay workflow, with the bot's
// token in GH_TOKEN. Reads the repository_dispatch event from
// GITHUB_EVENT_PATH and makes the write it carries (relay.ts), unless it's to
// Actions variables, secrets or repository settings. The write's summary
// goes in a notice for github-write to read back; the run fails if the write
// was refused or failed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { StatusSync } from '../agent-status.ts';
import {
  applyWrite,
  defaultCodeOwners,
  parseRelayPayload,
  RESULT_PREFIX,
  workflowCommand,
  writeSummary,
  type RelayPayload,
} from '../relay.ts';

const repo = process.env.GITHUB_REPOSITORY ?? '';
const event = JSON.parse(
  readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
) as { client_payload?: RelayPayload };

function gh(args: string[], input?: unknown): string {
  return execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

const reviewers = existsSync('.github/CODEOWNERS')
  ? defaultCodeOwners(readFileSync('.github/CODEOWNERS', 'utf8'))
  : [];

try {
  const write = parseRelayPayload(event.client_payload ?? {}, repo);
  console.log(`Relaying ${write.method} ${write.path}.`);
  const response = applyWrite(write, {
    gh,
    reviewers,
    finishRun: (retro) => {
      try {
        new StatusSync(gh, repo).finishRun(retro);
      } catch (error) {
        // The write is made; a status that didn't update isn't worth failing it.
        console.log(
          workflowCommand(
            'warning',
            `Couldn't update the run's status: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },
  });
  console.log(
    workflowCommand(
      'notice',
      `${RESULT_PREFIX}${JSON.stringify(writeSummary(response))}`,
    ),
  );
} catch (error) {
  console.log(
    workflowCommand(
      'error',
      error instanceof Error ? error.message : String(error),
    ),
  );
  process.exit(1);
}
