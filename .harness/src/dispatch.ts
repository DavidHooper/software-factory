/**
 * Decides which agent runs a GitHub event starts, and where each one runs.
 * The precedence rules are documented in docs/agents/runners.md; this is the
 * single implementation of them.
 */

import { AGENT_APP, AGENT_BOT, checkName } from './agent-status.ts';
import { config } from './config.ts';
import { isAgentBranch, parseAgentBranch } from './branches.ts';
import { ciStatus, type CheckRun, type CiStatus } from './ci-status.ts';

/** A comment or review's author, as GitHub's events and REST reads give it. */
export interface Commenter {
  user: { login: string } | null;
  /** How GitHub relates the author to the repo, e.g. `COLLABORATOR` or `NONE`. */
  author_association: string;
}

const COLLABORATORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * A person's comment: a collaborator's, not a bot's (agents and apps all
 * post as bots). Anyone else's comment doesn't wake the harness supervisor
 * or make a review thread wait.
 */
export const isHuman = (c: Commenter): boolean =>
  c.user !== null &&
  !c.user.login.endsWith('[bot]') &&
  COLLABORATORS.has(c.author_association);

export const SKILLS = ['implement', 'review-pr'] as const;
export type Skill = (typeof SKILLS)[number];
export interface DispatchConfig {
  /** The kill switch is on (`isPaused`): no new runs start. */
  paused?: boolean;
}

export interface Run {
  skill: Skill;
  number: number;
  /** Whether `number` is an issue or a PR; the run's status shows on it as a comment or a check. */
  kind: 'issue' | 'pr';
  /** The cloud routine that runs it: every coding run goes to the same one (`routines.coding` in the config). */
  routine: string;
}

export interface Dispatch {
  runs: Run[];
  /** Why events were skipped, for the workflow summary. */
  notes: string[];
}

/**
 * The kill switch: whether the `AGENTS_PAUSED` repository variable pauses
 * agents. Only `true` (in any case) does; unset or any other value doesn't.
 * The dispatcher checks it before starting any run, and the relay before a
 * merge. Only a human turns it on or off: no agent tooling sets it.
 */
export function isPaused(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * A warning for the workflow summary when `AGENTS_PAUSED` is set to something
 * that doesn't pause (say `1` or `yes`), so whoever flipped the switch can see
 * it didn't take effect.
 */
export function pauseWarning(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (
    trimmed === '' ||
    isPaused(trimmed) ||
    trimmed.toLowerCase() === 'false'
  ) {
    return undefined;
  }
  return `\`AGENTS_PAUSED\` is \`${trimmed}\`, which doesn't pause agents: set it to \`true\` to pause.`;
}

/**
 * Holds back a decision's runs while paused, noting each one it skipped. The
 * dispatcher passes every decision through this before acting on it.
 */
export function holdIfPaused(
  dispatch: Dispatch,
  config: Pick<DispatchConfig, 'paused'>,
): Dispatch {
  if (!config.paused) {
    return dispatch;
  }
  return {
    runs: [],
    notes: [
      ...dispatch.notes,
      ...dispatch.runs.map(
        (run) =>
          `Didn't start /${run.skill} for #${run.number}: AGENTS_PAUSED is on.`,
      ),
    ],
  };
}

/** One run of `skill` on #`number`. */
function agentRun(skill: Skill, number: number, kind: Run['kind']): Run {
  return { skill, number, kind, routine: config.routines.coding };
}

export interface IssueFacts {
  number: number;
  state: 'open' | 'closed';
  labels: string[];
  /** Open issues blocking this one. */
  blockedBy: number;
}

export interface PullFacts {
  number: number;
  state: 'open' | 'closed';
  headRef: string;
  headSha: string;
  /** Login of whoever opened the PR. */
  author: string;
  title: string;
  body: string;
  /** The PR's labels plus those of the issue it closes. */
  labels: string[];
  /**
   * The commit each agent review summary (`isAgentReview`) was posted on,
   * oldest first: one per review run, which posts it before it pushes.
   */
  agentReviews: string[];
  /** GitHub's `mergeable`: `false` on a conflict, `null` while it's still working it out. */
  mergeable: boolean | null;
  /** State of the issue the PR closes (`Closes #n`), or `null` if it closes none. */
  issueState: 'open' | 'closed' | null;
  /** The head commit's check runs. */
  checkRuns: CheckRun[];
}

/**
 * A PR for a closed issue is leftover work, such as one opened by a run that
 * was being cancelled. Agents don't spend runs on it; a human tidies it up.
 */
const closedIssueNote = (pull: PullFacts) =>
  `#${pull.number} closes an issue that is closed.`;

const READY = 'agent-ready';
const REVIEW = 'needs-review';

/** An issue was labelled: `agent-ready` starts `/implement` once nothing blocks it. */
export function onIssueLabeled(
  label: string,
  issue: IssueFacts,
  config: DispatchConfig,
): Dispatch {
  return holdIfPaused(issueLabeled(label, issue), config);
}

function issueLabeled(label: string, issue: IssueFacts): Dispatch {
  if (label !== READY || issue.state !== 'open') {
    return { runs: [], notes: [] };
  }
  if (issue.blockedBy > 0) {
    return {
      runs: [],
      notes: [
        `#${issue.number} has ${issue.blockedBy} open blocker(s); it starts when they close.`,
      ],
    };
  }
  return {
    runs: [agentRun('implement', issue.number, 'issue')],
    notes: [],
  };
}

/** An issue closed: start `/implement` on the `agent-ready` issues it was the last blocker of. */
export function onIssueClosed(
  dependents: readonly IssueFacts[],
  config: DispatchConfig,
): Dispatch {
  return holdIfPaused(issueClosed(dependents), config);
}

function issueClosed(dependents: readonly IssueFacts[]): Dispatch {
  const runs = dependents
    .filter(
      (issue) =>
        issue.state === 'open' &&
        issue.blockedBy === 0 &&
        issue.labels.includes(READY) &&
        !issue.labels.includes('agent-blocked'),
    )
    .map((issue) => agentRun('implement', issue.number, 'issue'));
  return { runs, notes: [] };
}

/** A PR was labelled: `needs-review` starts `/review-pr`. */
export function onPullLabeled(
  label: string,
  pull: PullFacts,
  config: DispatchConfig,
): Dispatch {
  return holdIfPaused(pullLabeled(label, pull), config);
}

function pullLabeled(label: string, pull: PullFacts): Dispatch {
  if (pull.state !== 'open') {
    return { runs: [], notes: [] };
  }
  if (pull.issueState === 'closed') {
    return { runs: [], notes: [closedIssueNote(pull)] };
  }
  if (label === REVIEW) {
    return {
      runs: [agentRun('review-pr', pull.number, 'pr')],
      notes: [],
    };
  }
  return { runs: [], notes: [] };
}

/**
 * An agent PR is abandoned when its issue was closed as not planned: the
 * work was called off, typically mid-run, and cancelling a run can lose the
 * race with it opening the PR. The dispatcher closes such PRs (agents may not
 * close PRs themselves); the branch stays, so closing is reversible.
 */
export function isAbandoned(
  pull: { state: 'open' | 'closed'; headRef: string },
  issue: { state: 'open' | 'closed'; stateReason: string | null } | undefined,
): boolean {
  return (
    pull.state === 'open' &&
    isAgentBranch(pull.headRef) &&
    issue?.state === 'closed' &&
    issue.stateReason === 'not_planned'
  );
}

/** A merge the merge gate made: the bot merged an agent branch. */
export const isGateMerge = (
  pull: Pick<MergedPullFacts, 'mergedBy' | 'headRef'>,
): boolean =>
  pull.mergedBy === AGENT_BOT && parseAgentBranch(pull.headRef) !== undefined;

const NOT_RED = new Set(['success', 'neutral', 'skipped', 'cancelled']);

/**
 * A finished run that turned its commit red: any conclusion not in
 * `NOT_RED`, so `timed_out` and `startup_failure` count.
 */
export const isRed = (conclusion: string | null): conclusion is string =>
  conclusion !== null && !NOT_RED.has(conclusion);

/** A finished Verify push run on `main`. */
export interface VerifyRun {
  sha: string;
  conclusion: string | null;
  /** Its commit is on `main` (see `MainCommitFacts.onMain`). Only these count. */
  onMain: boolean;
}

/** A run that left its commit green: neither red nor cancelled or skipped. */
const isGreen = (conclusion: string | null): boolean =>
  conclusion === 'success' || conclusion === 'neutral';

/** The runs on `main` that left their commit red or green, newest first. */
const redOrGreen = (runs: readonly VerifyRun[]): VerifyRun[] =>
  runs.filter(
    (run) => run.onMain && (isRed(run.conclusion) || isGreen(run.conclusion)),
  );

/**
 * The commit that broke `main`, from its Verify runs, newest first: the
 * oldest red one since the last green one. `undefined` if `main` is green
 * now (runs that are neither red nor green don't count), or if no green run
 * is listed, so the start of the red streak isn't known.
 */
export function breakingMerge(runs: readonly VerifyRun[]): string | undefined {
  const counted = redOrGreen(runs);
  const green = counted.findIndex((run) => isGreen(run.conclusion));
  return green > 0 ? counted[green - 1]?.sha : undefined;
}

/**
 * Where the review run is up to on the PR's head, from the latest `Agent
 * review` check there that started a run: `running`, `finished` (its retro completes the check,
 * and copies the result onto the head after a push: `StatusSync.finishCheck`),
 * or `none` with no check on the head.
 */
function reviewCheck(
  pull: Pick<PullFacts, 'checkRuns'>,
): 'none' | 'running' | 'finished' {
  const latest = pull.checkRuns
    // A queued check (left from before reviews stopped being queued) never started a run.
    .filter(
      (run) => run.name === checkName('review-pr') && run.status !== 'queued',
    )
    .reduce<CheckRun | undefined>(
      (last, run) => (!last || (run.id ?? 0) > (last.id ?? 0) ? run : last),
      undefined,
    );
  return !latest
    ? 'none'
    : latest.status === 'completed'
      ? 'finished'
      : 'running';
}

/**
 * A review run has posted its summary, and none is going on the PR's head.
 * The run posts it before it pushes, so a head it, or the harness supervisor,
 * pushed has no check of its own until the run's retro copies one there.
 */
export const reviewFinished = (
  pull: Pick<PullFacts, 'agentReviews' | 'checkRuns'>,
): boolean => pull.agentReviews.length > 0 && reviewCheck(pull) !== 'running';

/**
 * Whether the review budget still allows a second run: one review-and-fix
 * run per PR, and a second only when the first's push broke CI. The first
 * run posts its summary on the commit it reviewed before it pushes, so a head
 * past that commit is taken as its push. It may be someone else's (the
 * harness supervisor's, a human's) after a run that pushed nothing: that head
 * never gets an `Agent review` check, so no second run starts and no
 * `red-after-review` wake fires, and the supervisor's hourly run finds the PR.
 */
const secondRunLeft = (pull: PullFacts): boolean =>
  pull.agentReviews.length === 1 && pull.agentReviews[0] !== pull.headSha;

/** Why a PR's head isn't green, naming its checks: "isn't green at abc1234: …". */
function notGreenReason(
  pull: Pick<PullFacts, 'headSha'>,
  ci: CiStatus,
): string {
  const reasons = [
    ...(ci.failed.length > 0 ? [`${ci.failed.join(', ')} failed`] : []),
    ...(ci.pending.length > 0
      ? [
          `${ci.pending.join(', ')} ${ci.pending.length > 1 ? 'are' : 'is'} still running`,
        ]
      : []),
  ];
  return `isn't green at ${pull.headSha.slice(0, 7)}: ${reasons.length > 0 ? reasons.join('; ') : 'it has no checks'}`;
}

/** Why a PR's head isn't green, or `undefined` if it is. */
function notGreenNote(pull: PullFacts): string | undefined {
  const ci = ciStatus(pull.checkRuns);
  return ci.state === 'passed'
    ? undefined
    : `#${pull.number} ${notGreenReason(pull, ci)}.`;
}

/**
 * A CI workflow or a check on a PR's head finished: start the review run
 * where the budget allows (`reviewRun`). Each CI workflow triggers this, so
 * the last one to go green starts the review, and so does the first run's
 * `Agent review` check finishing on a head its push turned red.
 */
export function onCiCompleted(
  headSha: string,
  pulls: readonly PullFacts[],
  config: DispatchConfig,
): Dispatch {
  return holdIfPaused(ciCompleted(headSha, pulls), config);
}

function ciCompleted(headSha: string, pulls: readonly PullFacts[]): Dispatch {
  const runs: Run[] = [];
  const notes: string[] = [];
  for (const pull of pulls) {
    if (
      pull.state !== 'open' ||
      !isAgentBranch(pull.headRef) ||
      pull.headSha !== headSha
    ) {
      continue;
    }
    const note =
      pull.issueState === 'closed' ? closedIssueNote(pull) : reviewRun(pull);
    if (note === undefined) {
      runs.push(agentRun('review-pr', pull.number, 'pr'));
    } else {
      notes.push(note);
    }
  }
  return { runs, notes };
}

const reviewedNote = (pull: PullFacts) =>
  `#${pull.number} has had its review run.`;

/**
 * Whether to start a review run on an open agent PR's head: `undefined` to
 * start one, or why not. The first run starts once the head is green; a
 * second only once the first has finished and its push turned CI red
 * (`secondRunLeft`). Two CI runs on the head can finish together, and both
 * trigger this, so a run already going on the head starts none.
 */
function reviewRun(pull: PullFacts): string | undefined {
  const at = pull.headSha.slice(0, 7);
  const check = reviewCheck(pull);
  if (pull.labels.includes('agent-blocked')) {
    return `#${pull.number} is agent-blocked.`;
  }
  if (check === 'running') {
    return `#${pull.number} is already being reviewed at ${at}.`;
  }
  const ci = ciStatus(pull.checkRuns);
  if (pull.agentReviews.length === 0) {
    if (check === 'finished') {
      return `#${pull.number} already had a review run at ${at}.`;
    }
    return ci.state === 'passed' ? undefined : notGreenNote(pull);
  }
  if (!secondRunLeft(pull)) {
    return pull.agentReviews.length > 1
      ? `#${pull.number} has had both its review runs.`
      : reviewedNote(pull);
  }
  if (ci.state === 'pending') {
    return notGreenNote(pull);
  }
  if (ci.state === 'passed') {
    return reviewedNote(pull);
  }
  return check === 'finished'
    ? undefined
    : `#${pull.number}'s review run hasn't finished at ${at}.`;
}

/** A squash merge the harness supervisor makes as the bot (`mergeBody`). */
export interface Merge {
  number: number;
  /** The head commit the gate passed: GitHub refuses the merge if the head has moved since. */
  sha: string;
  title: string;
  message: string;
}

export interface MergeDecision {
  merge?: Merge;
  /** Why it passes, or the first condition it failed. */
  note: string;
}

/** The text of a PR body's `## <heading>` section, up to the next `## `. */
export const section = (body: string, heading: string): string | undefined =>
  new RegExp(`^## ${heading}[ \\t]*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm')
    .exec(body)?.[1]
    ?.trim();

/**
 * The squash commit's description: the `text` block under the PR body's
 * `## Commit message` (see docs/agents/issue-tracker.md), or else its
 * `## Summary`, or else none, so the PR's headings and Markdown stay out of
 * `main`'s history.
 */
const commitMessage = (body: string): string =>
  /^```text[ \t]*\n([\s\S]*?)\n```/m
    .exec(section(body, 'Commit message') ?? '')?.[1]
    ?.trim() ??
  section(body, 'Summary') ??
  '';

/** Labels that hold an agent PR's merge: it's flagged for the human, or blocked. */
export const HOLD_LABELS = ['needs-human', 'agent-blocked'];

/**
 * The merge gate (GLOSSARY.md): the minimum an agent PR's head needs before
 * the harness supervisor may merge it, and the merge to make. Four
 * conditions: CI is green, the review run has finished, there's no merge
 * conflict, and nothing flags it for a human (`HOLD_LABELS`). The supervisor
 * checks it before it merges (`cli/merge-gate.ts`), and may refuse
 * more than it does, never less.
 */
export function mergeGate(
  pull: Pick<
    PullFacts,
    | 'number'
    | 'headSha'
    | 'title'
    | 'body'
    | 'labels'
    | 'checkRuns'
    | 'agentReviews'
    | 'mergeable'
  >,
): MergeDecision {
  const at = pull.headSha.slice(0, 7);
  const refuse = (reason: string): MergeDecision => ({
    note: `Didn't merge #${pull.number}: ${reason}.`,
  });
  const held = HOLD_LABELS.filter((label) => pull.labels.includes(label));
  if (held.length > 0) {
    return refuse(`it is ${held.join(' and ')}`);
  }
  const ci = ciStatus(pull.checkRuns);
  if (ci.state !== 'passed') {
    return refuse(`it ${notGreenReason(pull, ci)}`);
  }
  if (!reviewFinished(pull)) {
    return refuse(`the review run hasn't finished at ${at}`);
  }
  if (pull.mergeable === false) {
    return refuse('it has a merge conflict');
  }
  if (pull.mergeable === null) {
    return refuse(
      "GitHub hasn't worked out yet whether it has a merge conflict",
    );
  }
  return {
    merge: {
      number: pull.number,
      sha: pull.headSha,
      title: `${pull.title} (#${pull.number})`,
      message: commitMessage(pull.body),
    },
    note: `#${pull.number} passed the merge gate at ${at}.`,
  };
}

/** The wakes the dispatcher sends for a finished check, and why. */
export interface MergeOutcome {
  /** Gated PRs whose merge the harness supervisor decides (`isMergeCandidate`). */
  reasons: WakeReason[];
  notes: string[];
}

/**
 * Whether the harness supervisor may merge a PR now (`cli/merge-gate.ts`):
 * it's an open agent PR and passes the merge gate. Legacy `claude/`
 * branches count as agent work elsewhere, but only the current naming
 * merges. The kill switch isn't checked here: the supervisor stops while
 * it's on, and isn't woken (`wakeSupervisor`).
 */
export function supervisorMerge(pull: PullFacts): MergeDecision {
  if (pull.state !== 'open') {
    return { note: `Didn't merge #${pull.number}: it isn't open.` };
  }
  if (parseAgentBranch(pull.headRef) === undefined) {
    return {
      note: `Didn't merge #${pull.number}: ${pull.headRef} isn't an agent branch.`,
    };
  }
  return mergeGate(pull);
}

/**
 * An open agent PR whose merge is the harness supervisor's to decide (ADR
 * 0003): it passes `supervisorMerge`, and agents aren't paused.
 */
export function isMergeCandidate(
  pull: PullFacts,
  config: Pick<DispatchConfig, 'paused'>,
): boolean {
  return !config.paused && supervisorMerge(pull).merge !== undefined;
}

/**
 * A check on a gated PR's head finished (a CI workflow, or any other app's
 * check, the `Agent review` check included). Agent PRs whose merge is the
 * harness supervisor's to decide (`isMergeCandidate`) wake it, and so do
 * those left red once the review budget is spent (`red-after-review`); the
 * dispatcher merges nothing itself. Every check triggers this, so
 * whichever finishes last does it.
 */
export function onMergeCheck(
  headSha: string,
  pulls: readonly PullFacts[],
  config: Pick<DispatchConfig, 'paused'>,
): MergeOutcome {
  const outcome: MergeOutcome = { reasons: [], notes: [] };
  for (const pull of pulls) {
    if (pull.headSha !== headSha || !isAgentBranch(pull.headRef)) {
      continue;
    }
    const decision = mergeGate(pull);
    const at = pull.headSha.slice(0, 7);
    if (isMergeCandidate(pull, config)) {
      outcome.reasons.push({ kind: 'mergeable', number: pull.number });
      outcome.notes.push(
        `#${pull.number} passed the merge gate at ${at}: the harness supervisor decides its merge.`,
      );
    } else if (
      !config.paused &&
      reviewFinished(pull) &&
      !secondRunLeft(pull) &&
      ciStatus(pull.checkRuns).state === 'failed'
    ) {
      outcome.reasons.push({ kind: 'red-after-review', number: pull.number });
      outcome.notes.push(
        `#${pull.number} is red at ${at} after its review runs: the harness supervisor decides what next.`,
      );
    } else {
      outcome.notes.push(
        config.paused
          ? `Didn't hand #${pull.number} to the harness supervisor: AGENTS_PAUSED is on.`
          : decision.note,
      );
    }
  }
  return outcome;
}

/** The body of the merge call (`PUT repos/{owner}/{repo}/pulls/{n}/merge`) for a merge the gate passed. */
export function mergeBody(merge: Merge): Record<string, string> {
  return {
    merge_method: 'squash',
    sha: merge.sha,
    commit_title: merge.title,
    commit_message: merge.message,
  };
}

/** A PR merged into `main`, as `onMainVerified` sees it. */
export interface MergedPullFacts {
  number: number;
  headRef: string;
  title: string;
  /** Login of whoever merged it: the agent App when the merge gate did. */
  mergedBy: string | null;
}

/** A `main` commit whose Verify run finished. */
export interface MainCommitFacts {
  sha: string;
  /** The Verify run's conclusion. */
  conclusion: string | null;
  runUrl: string;
  /** The PR merged as this commit, or `null` if it was pushed directly. */
  pull: MergedPullFacts | null;
  /**
   * The merge that broke `main` (`breakingMerge`), from its Verify runs, or
   * `undefined` if no green run is listed to start the red streak from.
   */
  breaking: BreakingMerge | undefined;
  /**
   * The commit is on `main`. A run's branch name alone doesn't say so: a tag
   * or other ref can be named `main` too.
   */
  onMain: boolean;
}

/** How a red commit got onto `main`: the merge gate, a human, or a push (`null`). */
export type MainMerge = 'merge-gate' | 'human' | null;

/** The commit that broke `main` (`breakingMerge`), and the PR merged as it, or `null` for a push. */
export interface BreakingMerge {
  sha: string;
  pr: number | null;
}

/** What the dispatcher does about Verify on `main`. */
export interface MainDecision {
  /** Wake the harness supervisor, which decides how to get `main` green. */
  reason?: WakeReason;
  note: string;
}

/**
 * Verify finished on a `main` commit (see "Main is red" in
 * docs/agents/runners.md). A red one only wakes the harness supervisor, which
 * gets `main` green: the dispatcher never pauses by itself.
 */
export function onMainVerified(commit: MainCommitFacts): MainDecision {
  const at = commit.sha.slice(0, 7);
  if (!commit.onMain) {
    return {
      note: `Verify finished on a ref named main at ${at}, but that commit isn't on main, so it's ignored.`,
    };
  }
  const { pull } = commit;
  if (!isRed(commit.conclusion)) {
    return {
      note: `Verify on main at ${at}: ${commit.conclusion ?? 'no conclusion'}.`,
    };
  }
  // One cascade for both, so who merged it and how the note says so can't drift apart.
  const [by, what]: [MainMerge, string] = !pull
    ? [null, ', pushed without a PR']
    : isGateMerge(pull)
      ? ['merge-gate', `, the merge gate's merge of #${pull.number}`]
      : ['human', `, a human's merge of #${pull.number}`];
  return {
    reason: {
      kind: 'main-red',
      sha: commit.sha,
      runUrl: commit.runUrl,
      pr: pull?.number ?? null,
      by,
      breaking: commit.breaking ?? null,
    },
    note: `Verify failed on main at ${at}${what}: the harness supervisor gets main green.`,
  };
}

/**
 * Why the dispatcher wakes the harness supervisor straight away: an urgent
 * event it handled, or a routine fire that failed (`fire-failed`). The tick
 * (supervisor-tick.ts) fires it hourly with none.
 */
export type WakeReason =
  | { kind: 'blocked'; number: number }
  | { kind: 'run-failed'; number: number; check: string; conclusion: string }
  /**
   * Verify failed on `main` at `sha` (`runUrl`), PR `pr`'s merge, made `by`
   * the merge gate or a human (`null`: pushed without a PR).
   * `breaking` is the merge that broke `main` (`breakingMerge`), if known.
   */
  | {
      kind: 'main-red';
      sha: string;
      runUrl: string;
      pr: number | null;
      by: MainMerge;
      breaking: BreakingMerge | null;
    }
  /** The dispatcher's routine fire for `skill` on #n still failed after its retries (cli/fire-routine.ts). */
  | { kind: 'fire-failed'; number: number; skill: string }
  /** Agent PR #n's merge is the harness supervisor's to decide (`isMergeCandidate`). */
  | { kind: 'mergeable'; number: number }
  /** Agent PR #n's head is red, and its review budget is spent (`onMergeCheck`). */
  | { kind: 'red-after-review'; number: number }
  /** A person commented on issue or PR #n, or reviewed it (`isHuman`). */
  | { kind: 'comment'; number: number };

/** An event the dispatcher handled, as `urgentReasons` sees it. */
export type UrgentEvent =
  | { kind: 'labeled'; label: string; number: number }
  /** A check run finished: `app` is the slug of the App that made it. */
  | {
      kind: 'check';
      name: string;
      app: string | undefined;
      conclusion: string | null;
      pulls: readonly number[];
    }
  /** A conversation comment, a review or a review comment on issue or PR #`number`. */
  | {
      kind: 'comment';
      number: number;
      comment: Commenter;
    };

/** The agent run checks (`checkName`). */
const AGENT_RUN_CHECKS = new Set([checkName('review-pr')]);

/**
 * Check conclusions that mean an agent run failed rather than finished:
 * `stale`, which GitHub gives a check left running for 14 days. A finished run's
 * conclusions (`describeOutcome`) never wake it: a blocked
 * run adds `agent-blocked`, which wakes the harness supervisor itself.
 */
const FAILED_RUN_CONCLUSIONS = new Set(['stale']);

/** Whether an agent's run check (`Agent review`) ended as a failed run. */
const isFailedRun = (name: string, conclusion: string | null): boolean =>
  AGENT_RUN_CHECKS.has(name) && FAILED_RUN_CONCLUSIONS.has(conclusion ?? '');

/**
 * The urgent events that wake the harness supervisor straight away:
 * `agent-blocked` added, an agent run failing, and a person's comment
 * (`isHuman`: a collaborator's, never a bot's, so the harness supervisor's own
 * replies can't loop) on any issue or PR, whatever its labels. `main` going red wakes it through
 * `onMainVerified`.
 */
export function urgentReasons(event: UrgentEvent): WakeReason[] {
  switch (event.kind) {
    case 'labeled':
      return event.label === 'agent-blocked'
        ? [{ kind: 'blocked', number: event.number }]
        : [];
    case 'check':
      return event.app === AGENT_APP &&
        isFailedRun(event.name, event.conclusion)
        ? event.pulls.map((number) => ({
            kind: 'run-failed' as const,
            number,
            check: event.name,
            conclusion: event.conclusion ?? '',
          }))
        : [];
    case 'comment':
      return isHuman(event.comment)
        ? [{ kind: 'comment', number: event.number }]
        : [];
  }
}

export interface SupervisorConfig {
  /** The kill switch is on (`isPaused`). */
  paused?: boolean;
  /** The harness supervisor routine's URL and token secrets are set. */
  supervisorConfigured: boolean;
}

/** The payload the harness supervisor routine is fired with. */
export interface SupervisorWake {
  skill: 'supervise';
  /**
   * The kill switch, which the harness supervisor can't read from its cloud
   * session (the proxy refuses Actions variables). Anything but
   * `paused: false` counts as paused (`/supervise`, **Start**).
   */
  paused: boolean;
  reasons: WakeReason[];
}

export interface SupervisorDecision {
  wake?: SupervisorWake;
  notes: string[];
}

const describeReason = (reason: WakeReason): string => {
  switch (reason.kind) {
    case 'blocked':
      return `#${reason.number} is agent-blocked`;
    case 'run-failed':
      return `${reason.check} on #${reason.number} ended ${reason.conclusion}`;
    case 'main-red': {
      const merge = reason.pr === null ? 'a push' : `#${reason.pr}'s merge`;
      const { breaking } = reason;
      const broke = breaking
        ? `; main broke at ${breaking.sha.slice(0, 7)}, ${breaking.pr === null ? 'a push' : `#${breaking.pr}'s merge`}`
        : '';
      return `Verify failed on main at ${reason.sha.slice(0, 7)} (${merge}${broke})`;
    }
    case 'fire-failed':
      return `the routine fire for /${reason.skill} on #${reason.number} failed, so it didn't start`;
    case 'mergeable':
      return `#${reason.number}'s merge is the harness supervisor's to decide`;
    case 'red-after-review':
      return `#${reason.number} is red after its review runs`;
    case 'comment':
      return `a person commented on #${reason.number}`;
  }
};

/**
 * Whether to fire the harness supervisor routine for an event's urgent
 * reasons (`urgentReasons`). Nothing fires while paused, or before the routine's
 * secrets are set, so nothing breaks before it's set up.
 */
export function wakeSupervisor(
  reasons: readonly WakeReason[],
  config: SupervisorConfig,
): SupervisorDecision {
  if (reasons.length === 0) {
    return { notes: [] };
  }
  const why = reasons.map(describeReason).join('; ');
  const skip = (because: string): SupervisorDecision => ({
    notes: [`Didn't wake the harness supervisor (${why}): ${because}.`],
  });
  if (config.paused) {
    return skip('AGENTS_PAUSED is on');
  }
  if (!config.supervisorConfigured) {
    return skip(
      "it isn't configured yet (the ROUTINE_HARNESS_SUPERVISOR_URL and _TOKEN secrets aren't set; see docs/agents/cloud-routines.md)",
    );
  }
  return {
    wake: { skill: 'supervise', paused: false, reasons: [...reasons] },
    notes: [`Waking the harness supervisor: ${why}.`],
  };
}
