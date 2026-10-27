// Run by .github/workflows/supervisor-tick.yml, which the harness supervisor
// routine's hourly run fires (`/supervise`, Start): fires the
// harness supervisor unless the kill switch is on or its routine isn't set
// up. The decision is tick() in supervisor-tick.ts; this only reads the
// environment. Writes `supervisor` to $GITHUB_OUTPUT (the routine's payload,
// or empty) and a summary of why.
import { appendFileSync } from 'node:fs';
import { isPaused } from '../dispatch.ts';
import { tick } from '../supervisor-tick.ts';

const decision = tick({
  paused: isPaused(process.env.AGENTS_PAUSED),
  // The workflow passes whether the routine's secrets are set, not their values.
  configured: process.env.SUPERVISOR_CONFIGURED === 'true',
});
const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(
    output,
    `supervisor=${decision.fire ? JSON.stringify(decision.fire) : ''}\n`,
  );
}
const summary = `### Harness supervisor tick\n\n${decision.note}`;
console.log(summary);
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  appendFileSync(summaryFile, `${summary}\n`);
}
