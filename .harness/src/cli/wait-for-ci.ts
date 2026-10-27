// Waits for CI on a commit and reports the result, so agents don't hand-roll
// polling loops. Usage: node .harness/src/cli/wait-for-ci.ts [sha]
// (defaults to HEAD). Exits 0 when every check passed, 1 when any failed,
// and 2 if checks are still running after 15 minutes.
import { execFileSync } from 'node:child_process';
import { ciReport, ciStatus, type CheckRun } from '../ci-status.ts';

const sha =
  process.argv[2] ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const deadline = Date.now() + 15 * 60 * 1000;

for (;;) {
  const { check_runs: runs } = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs`],
      {
        encoding: 'utf8',
      },
    ),
  ) as { check_runs: CheckRun[] };
  const { state } = ciStatus(runs);

  if (state !== 'pending') {
    console.log(ciReport(sha, runs));
    process.exit(state === 'passed' ? 0 : 1);
  }
  if (Date.now() > deadline) {
    console.log(`CI still running on ${sha.slice(0, 7)} after 15 minutes.`);
    process.exit(2);
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
