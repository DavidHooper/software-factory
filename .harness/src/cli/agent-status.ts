// Shows agent runs' status on GitHub (see agent-status.ts), as the bot. Run by
// the dispatcher when a run's routine was fired: SKILL, KIND (issue|pr),
// NUMBER, RUN_URL (optional).
import { execFileSync } from 'node:child_process';
import { StatusSync } from '../agent-status.ts';

const gh = (args: string[], input?: unknown) =>
  execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
    stdio: ['pipe', 'pipe', 'inherit'],
  });

const env = process.env;
const repo = env.GITHUB_REPOSITORY ?? '';
const sync = new StatusSync(gh, repo);

/** The run that `start` acts on, from SKILL, KIND, NUMBER and RUN_URL. */
function runFromEnv() {
  const { SKILL, KIND, NUMBER, RUN_URL } = env;
  if (!SKILL || (KIND !== 'issue' && KIND !== 'pr') || !NUMBER) {
    throw new Error(
      `SKILL, KIND (issue|pr) and NUMBER must be set: got ${JSON.stringify({ SKILL, KIND, NUMBER })}.`,
    );
  }
  return {
    skill: SKILL,
    kind: KIND,
    number: Number(NUMBER),
    url: RUN_URL || undefined,
  } as const;
}

try {
  const run = runFromEnv();
  sync.startRun(run.skill, run.kind, run.number, run.url);
  console.log(`Marked ${run.skill} #${run.number} as started.`);
} catch (error) {
  // Status is a convenience: it shouldn't fail dispatch.
  console.log(
    `::warning::Couldn't update the agent status: ${error instanceof Error ? error.message : String(error)}`,
  );
}
