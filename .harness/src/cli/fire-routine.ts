// Fires a Claude cloud routine with ROUTINE_URL and ROUTINE_TOKEN, retrying
// while the routine API is busy (routine-fire.ts). Run by agent-dispatch.yml
// and supervisor-tick.yml. The routine's text is either:
//   PAYLOAD      the text itself, such as an agent run's JSON payload
//   FIRE_FAILED  an agent run's JSON ({skill, number}) whose fire failed: the
//                harness supervisor is woken with a `fire-failed` reason, if
//                it's set up (SUPERVISOR_CONFIGURED, as the dispatcher's) and
//                agents aren't paused (AGENTS_PAUSED)
// WHAT names the fire in the step summary. Writes the session's URL to
// $GITHUB_OUTPUT as `url`, and exits 1 if the fire still fails.
import { appendFileSync } from 'node:fs';
import { isPaused, wakeSupervisor } from '../dispatch.ts';
import { fireRoutine } from '../routine-fire.ts';
import { env } from './github-facts.ts';

function writeSummary(line: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) {
    appendFileSync(file, `${line}\n`);
  }
}

function report(line: string): void {
  console.log(line);
  writeSummary(line);
}

let payload = process.env.PAYLOAD;
const failed = process.env.FIRE_FAILED;
if (failed) {
  const run = JSON.parse(failed) as { skill: string; number: number };
  const wake = wakeSupervisor(
    [{ kind: 'fire-failed', number: run.number, skill: run.skill }],
    {
      paused: isPaused(process.env.AGENTS_PAUSED),
      supervisorConfigured: process.env.SUPERVISOR_CONFIGURED === 'true',
    },
  );
  wake.notes.forEach(report);
  if (!wake.wake) {
    process.exit(0);
  }
  payload = JSON.stringify(wake.wake);
}

const what = env('WHAT');
const result = await fireRoutine(
  env('ROUTINE_URL'),
  env('ROUTINE_TOKEN'),
  payload ?? env('PAYLOAD'),
);
const tries = result.attempts === 1 ? '' : ` (${result.attempts} attempts)`;
if (!result.ok) {
  const line = `Couldn't fire ${what}${tries}: ${result.error}`;
  console.log(`::error::${line}`);
  writeSummary(line);
  process.exit(1);
}
const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(output, `url=${result.sessionUrl ?? ''}\n`);
}
report(`Fired ${what}${tries}: ${result.sessionUrl ?? 'no session link'}`);
