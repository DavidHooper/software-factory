// Run by .github/workflows/agent-dispatch.yml: turns the triggering GitHub
// event into agent runs, written to $GITHUB_OUTPUT as `runs` (a JSON array,
// each fired at its cloud routine). It merges nothing: agent PRs' merges are the harness supervisor's to decide, so it
// wakes it for them. When Verify fails on main, it wakes the harness
// supervisor too, which gets main green; it never turns on the kill switch
// itself (see "Main is red" in docs/agents/runners.md). The wake is written
// as `supervisor` (its routine's payload, or empty). Writes a summary of what
// it decided and why.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import {
  breakingMerge,
  isAbandoned,
  isRed,
  isPaused,
  onCiCompleted,
  onIssueClosed,
  onIssueLabeled,
  onMainVerified,
  onMergeCheck,
  onPullLabeled,
  pauseWarning,
  urgentReasons,
  wakeSupervisor,
  type Dispatch,
  type MainCommitFacts,
  type MergeOutcome,
  type MainDecision,
  type Commenter,
  type WakeReason,
} from '../dispatch.ts';
import { checkName } from '../agent-status.ts';
import {
  api,
  env,
  githubFacts,
  labelNames,
  listAll,
  type GitHubIssue,
  type GitHubPull,
} from './github-facts.ts';

const repo = env('GITHUB_REPOSITORY');
const eventName = env('GITHUB_EVENT_NAME');
const event = JSON.parse(
  readFileSync(env('GITHUB_EVENT_PATH'), 'utf8'),
) as Record<string, unknown>;
const defaultBranch =
  (event.repository as { default_branch?: string } | undefined)
    ?.default_branch ?? 'main';
const { issueFacts, isOnMain, mainRuns, pullIssue, pullFacts } = githubFacts(
  repo,
  defaultBranch,
);

/** The PR merged as `main` commit `sha`, if it wasn't pushed directly. */
const mergedAs = (sha: string): GitHubPull | undefined =>
  api<GitHubPull[]>(`repos/${repo}/commits/${sha}/pulls`)
    .map((pull) => api<GitHubPull>(`repos/${repo}/pulls/${pull.number}`))
    .find((pull) => pull.merge_commit_sha === sha);

/** The facts of a main commit whose Verify run finished. */
function mainCommitFacts(run: {
  head_sha: string;
  conclusion: string | null;
  html_url: string;
}): MainCommitFacts {
  const merged = mergedAs(run.head_sha);
  const breaking = isRed(run.conclusion)
    ? breakingMerge(mainRuns())
    : undefined;
  return {
    sha: run.head_sha,
    conclusion: run.conclusion,
    runUrl: run.html_url,
    pull: merged
      ? {
          number: merged.number,
          headRef: merged.head.ref,
          title: merged.title,
          mergedBy: merged.merged_by?.login ?? null,
        }
      : null,
    breaking:
      breaking === undefined
        ? undefined
        : {
            sha: breaking,
            pr:
              (breaking === run.head_sha ? merged : mergedAs(breaking))
                ?.number ?? null,
          },
    onMain: isOnMain(run.head_sha),
  };
}

/** Closes an abandoned agent PR (see `isAbandoned`), keeping its branch. */
function closeAbandoned(
  prNumber: number,
  issueNumber: number,
  notes: string[],
): void {
  execFileSync('gh', [
    'api',
    `repos/${repo}/issues/${prNumber}/comments`,
    '-f',
    `body=Closing: #${issueNumber} was closed as not planned, so this agent PR is abandoned work. The branch is kept; reopen the PR to pick it back up.\n\n<!-- agent -->`,
  ]);
  execFileSync('gh', [
    'api',
    '-X',
    'PATCH',
    `repos/${repo}/pulls/${prNumber}`,
    '-f',
    'state=closed',
  ]);
  notes.push(`Closed #${prNumber}: #${issueNumber} was closed as not planned.`);
}

/**
 * Re-applying a trigger label is how a human restarts a blocked item, so
 * clear `agent-blocked` when a label starts a run.
 */
function clearBlocked(
  number: number,
  labels: readonly string[],
  dispatch: Dispatch,
): void {
  if (dispatch.runs.length > 0 && labels.includes('agent-blocked')) {
    execFileSync('gh', [
      'api',
      '-X',
      'DELETE',
      `repos/${repo}/issues/${number}/labels/agent-blocked`,
    ]);
    dispatch.notes.push(`Removed agent-blocked from #${number}.`);
  }
}

const config = {
  // The only place the kill switch is read. Closing abandoned PRs still
  // happens while paused: like cancelling, it only tidies up called-off work.
  paused: isPaused(process.env.AGENTS_PAUSED),
  // The workflow passes whether the routine's secrets are set, not their values.
  supervisorConfigured: process.env.SUPERVISOR_CONFIGURED === 'true',
};

let dispatch: Dispatch = { runs: [], notes: [] };
let gate: MergeOutcome = { reasons: [], notes: [] };
const urgent: WakeReason[] = [];
const action = event.action;

/** Notes a decision about main, and the wake it asks for. */
function decided(decision: MainDecision): void {
  dispatch.notes.push(decision.note);
  if (decision.reason) {
    urgent.push(decision.reason);
  }
}

if (eventName === 'issues' && action === 'labeled') {
  const { issue, label } = event as {
    issue: { number: number };
    label: { name: string };
  };
  const facts = issueFacts(issue.number);
  dispatch = onIssueLabeled(label.name, facts, config);
  clearBlocked(issue.number, facts.labels, dispatch);
  urgent.push(
    ...urgentReasons({
      kind: 'labeled',
      label: label.name,
      number: issue.number,
    }),
  );
} else if (eventName === 'issues' && action === 'closed') {
  const { issue } = event as { issue: { number: number } };
  const dependents = listAll<GitHubIssue>(
    `repos/${repo}/issues/${issue.number}/dependencies/blocking`,
  );
  dispatch = onIssueClosed(
    dependents.map((dependent) => issueFacts(dependent.number)),
    config,
  );
  const closed = event.issue as { state_reason?: string | null };
  const closedIssue = {
    state: 'closed' as const,
    stateReason: closed.state_reason ?? null,
  };
  const openPulls = listAll<GitHubPull>(`repos/${repo}/pulls?state=open`);
  for (const pull of openPulls) {
    if (
      pullIssue(pull) === issue.number &&
      isAbandoned({ state: pull.state, headRef: pull.head.ref }, closedIssue)
    ) {
      closeAbandoned(pull.number, issue.number, dispatch.notes);
    }
  }
} else if (eventName === 'pull_request_target' && action === 'opened') {
  // Opened after its issue was called off: the run lost the race with its
  // cancellation.
  const { pull_request: pr } = event as { pull_request: GitHubPull };
  const issueNumber = pullIssue(pr);
  if (issueNumber !== undefined) {
    const linked = api<GitHubIssue>(`repos/${repo}/issues/${issueNumber}`);
    if (
      isAbandoned(
        { state: pr.state, headRef: pr.head.ref },
        { state: linked.state, stateReason: linked.state_reason ?? null },
      )
    ) {
      closeAbandoned(pr.number, issueNumber, dispatch.notes);
    }
  }
} else if (eventName === 'pull_request_target' && action === 'labeled') {
  const { pull_request: pr, label } = event as {
    pull_request: { number: number; labels: { name: string }[] };
    label: { name: string };
  };
  dispatch = onPullLabeled(label.name, pullFacts(pr.number), config);
  clearBlocked(pr.number, labelNames(pr), dispatch);
  urgent.push(
    ...urgentReasons({
      kind: 'labeled',
      label: label.name,
      number: pr.number,
    }),
  );
} else if (eventName === 'workflow_run') {
  const { workflow_run: run } = event as {
    workflow_run: {
      name: string;
      event: string;
      head_branch: string | null;
      head_sha: string;
      conclusion: string | null;
      html_url: string;
      pull_requests: { number: number }[];
    };
  };
  if (
    run.name === 'Verify' &&
    run.event === 'push' &&
    run.head_branch === defaultBranch
  ) {
    // Verify finished on main: a red one wakes the harness supervisor.
    decided(onMainVerified(mainCommitFacts(run)));
  } else {
    // CI finished on a PR: start the review run where its budget allows,
    // or hand the PR to the harness supervisor once the run has finished.
    const pulls = run.pull_requests.map((pr) => pullFacts(pr.number));
    dispatch = onCiCompleted(run.head_sha, pulls, config);
    gate = onMergeCheck(run.head_sha, pulls, config);
  }
} else if (eventName === 'check_run' && action === 'completed') {
  // Any app's check, the `Agent review` check included: CI workflows come
  // through workflow_run, as Actions sends no check_run events for them.
  const { check_run: check } = event as {
    check_run: {
      name: string;
      head_sha: string;
      conclusion: string | null;
      app: { slug: string } | null;
      pull_requests: { number: number }[];
    };
  };
  urgent.push(
    ...urgentReasons({
      kind: 'check',
      name: check.name,
      app: check.app?.slug,
      conclusion: check.conclusion,
      pulls: check.pull_requests.map((pr) => pr.number),
    }),
  );
  const pulls = check.pull_requests.map((pr) => pullFacts(pr.number));
  // Only the `Agent review` check: its events share CI's concurrency group
  // (agent-dispatch.yml), so two can't both start a run.
  if (check.name === checkName('review-pr')) {
    dispatch = onCiCompleted(check.head_sha, pulls, config);
  }
  gate = onMergeCheck(check.head_sha, pulls, config);
} else if (
  (eventName === 'issue_comment' && action === 'created') ||
  (eventName === 'pull_request_review_comment' && action === 'created') ||
  (eventName === 'pull_request_review' && action === 'submitted')
) {
  // A comment or review on any issue or PR: a person's wakes the harness
  // supervisor for it, a bot's doesn't (urgentReasons).
  const {
    issue,
    pull_request: pr,
    comment,
    review,
  } = event as {
    issue?: { number: number };
    pull_request?: { number: number };
    comment?: Commenter;
    review?: Commenter;
  };
  const number = issue?.number ?? pr?.number;
  const by = comment ?? review;
  if (number !== undefined && by) {
    urgent.push(...urgentReasons({ kind: 'comment', number, comment: by }));
  }
}

dispatch.notes.push(...gate.notes);
urgent.push(...gate.reasons);
const supervisor = wakeSupervisor(urgent, config);
dispatch.notes.push(...supervisor.notes);

const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(
    output,
    `runs=${JSON.stringify(dispatch.runs)}\nsupervisor=${supervisor.wake ? JSON.stringify(supervisor.wake) : ''}\n`,
  );
}

const warning = pauseWarning(process.env.AGENTS_PAUSED);
const summary = [
  `### Agent dispatch: \`${eventName}${typeof action === 'string' ? `.${action}` : ''}\``,
  '',
  ...(config.paused
    ? ['**Paused:** `AGENTS_PAUSED` is on, so no agent runs start.', '']
    : []),
  ...(warning ? [`**Warning:** ${warning}`, ''] : []),
  ...(dispatch.runs.length > 0
    ? [
        '| Skill | Item | Routine |',
        '| --- | --- | --- |',
        ...dispatch.runs.map(
          (run) => `| ${run.skill} | #${run.number} | ${run.routine} |`,
        ),
      ]
    : ['No agent runs.']),
  ...dispatch.notes.map((note) => `- ${note}`),
].join('\n');
console.log(summary);
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  appendFileSync(summaryFile, `${summary}\n`);
}
