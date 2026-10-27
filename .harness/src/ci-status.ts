export interface CheckRun {
  /** Later runs of the same check have higher ids. */
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  /** The check's summary, such as why it failed. */
  output?: { title: string | null };
}

export interface CiStatus {
  state: 'pending' | 'passed' | 'failed';
  /** Names of the runs that finished badly. */
  failed: string[];
  /** Names of the runs that haven't finished. */
  pending: string[];
}

const OK = new Set(['success', 'skipped', 'neutral']);

/** Whether a check run with this conclusion counts as passed. */
const isPassing = (conclusion: string | null): boolean =>
  OK.has(conclusion ?? '');

/**
 * The agents' own status checks (agent-status.ts) report on agent runs, not
 * CI: counting them would make a run wait for itself.
 */
const isAgentStatus = (run: CheckRun) => /^Agent[ :]/.test(run.name);

/**
 * The latest run of each check. A check can run more than once on a commit
 * (a re-run, or a run its concurrency group cancelled), and only the newer
 * one counts.
 */
function latestRuns(runs: readonly CheckRun[]): CheckRun[] {
  const latest = new Map<string, CheckRun>();
  for (const run of runs) {
    const seen = latest.get(run.name);
    if (!seen || (run.id ?? 0) > (seen.id ?? 0)) {
      latest.set(run.name, run);
    }
  }
  return [...latest.values()];
}

/** Whether a run finished badly. */
const isFailed = (run: CheckRun) =>
  run.status === 'completed' && !isPassing(run.conclusion);

/** The runs that decide a commit's CI: the latest of each check but the agents' own. */
const countedRuns = (runs: readonly CheckRun[]): CheckRun[] =>
  latestRuns(runs.filter((run) => !isAgentStatus(run)));

/** Summarises a commit's check runs (`GET /repos/{owner}/{repo}/commits/{sha}/check-runs`). */
export function ciStatus(allRuns: readonly CheckRun[]): CiStatus {
  const runs = countedRuns(allRuns);
  const pending = runs
    .filter((run) => run.status !== 'completed')
    .map((run) => run.name);
  const failed = runs.filter(isFailed).map((run) => run.name);
  const state =
    runs.length === 0 || pending.length > 0
      ? 'pending'
      : failed.length > 0
        ? 'failed'
        : 'passed';
  return { state, failed, pending };
}

/**
 * The line `wait-for-ci` prints once CI on `sha` has finished, or undefined
 * while it's still running. A pass names each check that ran once and counts
 * the skipped ones (such as matrix jobs under their unexpanded names); a
 * failure gives each failed check's output title, which says why.
 */
export function ciReport(
  sha: string,
  allRuns: readonly CheckRun[],
): string | undefined {
  const { state } = ciStatus(allRuns);
  const runs = countedRuns(allRuns);
  const short = sha.slice(0, 7);
  if (state === 'passed') {
    const ran = runs.filter((run) => run.conclusion !== 'skipped');
    const skipped = runs.length - ran.length;
    const parts: string[] = [];
    if (ran.length > 0) parts.push(ran.map((run) => run.name).join(', '));
    if (skipped > 0) parts.push(`${skipped} skipped`);
    return `CI passed on ${short}: ${parts.join('; ')}.`;
  }
  if (state === 'failed') {
    const failed = runs
      .filter(isFailed)
      .map((run) =>
        run.output?.title ? `${run.name} (${run.output.title})` : run.name,
      );
    return `CI failed on ${short}: ${failed.join(', ')}. Read the failing run's log with gh api repos/{owner}/{repo}/actions/runs.`;
  }
  return undefined;
}
