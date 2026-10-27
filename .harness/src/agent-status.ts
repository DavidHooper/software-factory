/**
 * Shows where agent work is up to on GitHub, so it isn't a black box:
 *
 * - On a PR, runs show as checks on the head commit (`Agent review`): in
 *   progress, with the session as Details, from when the dispatcher starts
 *   the run; then a result. The dispatcher reads that result as the review
 *   run having finished (`reviewCheck` in dispatch.ts).
 * - On an issue, which can't have checks, one status comment is kept up to
 *   date: picked up, then the outcome.
 *
 * The dispatcher starts the status (`startRun`). Runs finish it without
 * thinking about it: the relay finishes every run's status when its retro is
 * posted (`finishRun`).
 */

import { config } from './config.ts';
import { readPages } from './github-pages.ts';

export const STATUS_MARKER = '<!-- agent-status -->';

/** The agent GitHub App (`bot` in the config): only its status comments and checks link sessions. */
export const AGENT_APP = config.bot;
/** The agent App's login on GitHub, as the author of its comments and merges. */
export const AGENT_BOT = `${AGENT_APP}[bot]`;
/** How a retro comment starts (`/retro`). */
export const RETRO_MARKER = '<!-- agent-retro v1 -->';
/**
 * How a run report starts: what `/retro` posts instead of a retro when the
 * config's `retros` is off. It carries the same data, without events, so the
 * relay still finishes the run's status from it.
 */
export const RUN_REPORT_MARKER = '<!-- agent-run v1 -->';

export type RunKind = 'issue' | 'pr';

export type CheckConclusion =
  'success' | 'failure' | 'neutral' | 'cancelled' | 'action_required';

export const checkName = (skill: string): string =>
  `Agent ${skill.replace(/-pr$/, '')}`;

export interface RetroFacts {
  skill: string;
  issue?: number;
  pr?: number;
  outcome: string;
  session?: string;
}

/** Whether a comment is a retro or a run report (see the retro skill). */
const isRetro = (body: string): boolean =>
  body.includes(RETRO_MARKER) || body.includes(RUN_REPORT_MARKER);

/** The facts from a retro or run report (see the retro skill), or `undefined` if it's neither. */
export function parseRetro(body: string): RetroFacts | undefined {
  if (!isRetro(body)) {
    return undefined;
  }
  const json = /```json\s*\n([\s\S]*?)\n\s*```/.exec(body)?.[1];
  try {
    const data = JSON.parse(json ?? '') as Record<string, unknown>;
    if (typeof data.skill !== 'string' || typeof data.outcome !== 'string') {
      return undefined;
    }
    const num = (value: unknown) =>
      typeof value === 'number' && value > 0 ? value : undefined;
    return {
      skill: data.skill,
      issue: num(data.issue),
      pr: num(data.pr),
      outcome: data.outcome,
      session: typeof data.session === 'string' ? data.session : undefined,
    };
  } catch {
    return undefined;
  }
}

export interface Outcome {
  conclusion: CheckConclusion;
  /** One line for a check title or the status comment. */
  text: string;
}

export function describeOutcome(retro: RetroFacts): Outcome {
  switch (retro.outcome) {
    case 'pr-opened':
      return {
        conclusion: 'success',
        text: retro.pr ? `✅ Opened PR #${retro.pr}` : '✅ Opened a PR',
      };
    case 'reviewed':
      return { conclusion: 'success', text: '✅ Reviewed' };
    case 'blocked':
      return {
        conclusion: 'action_required',
        text: '⛔ Blocked: the agent needs an answer (see its latest comment)',
      };
    case 'waiting':
      return {
        conclusion: 'neutral',
        text: '⏸️ Waiting for a blocking issue to close',
      };
    case 'abandoned':
      return {
        conclusion: 'cancelled',
        text: '⚪ Stopped: the work was called off',
      };
    case 'supervised-run':
      return { conclusion: 'success', text: '✅ Supervised the workflow' };
    default:
      return { conclusion: 'neutral', text: `Finished: ${retro.outcome}` };
  }
}

const time = (now: Date) => `${now.toISOString().slice(11, 16)} UTC`;

/**
 * The issue's status comment with a new line added: the current state at the
 * top, and a log of what happened underneath.
 */
export function updateStatusComment(
  existing: string | undefined,
  current: string,
  now: Date,
): string {
  const log = (existing ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- '));
  return [
    STATUS_MARKER,
    `**Agent status:** ${current}`,
    '',
    ...log,
    `- ${time(now)} · ${current}`,
    '',
    '<!-- agent -->',
  ].join('\n');
}

const startedText = (skill: string, url: string | undefined) =>
  `🟡 \`/${skill}\` is running${url ? ` ([watch it](${url}))` : ''}`;

/** An item's status comment: the first one carrying `STATUS_MARKER`. */
export const findStatusComment = <T extends { body: string | null }>(
  comments: T[],
): T | undefined =>
  comments.find((c) => (c.body ?? '').startsWith(STATUS_MARKER));

/**
 * A review the agent bot posted with `/review-pr`'s `<!-- agent-review -->`
 * marker. Anyone can copy the marker, so the author decides.
 */
export const isAgentReview = (review: {
  body: string | null;
  user: { login: string } | null;
}): boolean =>
  review.user?.login === AGENT_BOT &&
  (review.body ?? '').includes('<!-- agent-review -->');

/** Calls `gh api` with the given arguments and optional JSON input, returning stdout. */
export type GhApi = (args: string[], input?: unknown) => string;

interface CheckRun {
  id: number;
  status: string;
  head_sha: string;
}

interface Comment {
  id: number;
  body: string | null;
}

export class StatusSync {
  private readonly gh: GhApi;
  private readonly repo: string;
  private readonly now: () => Date;

  constructor(gh: GhApi, repo: string, now: () => Date = () => new Date()) {
    this.gh = gh;
    this.repo = repo;
    this.now = now;
  }

  private json<T>(args: string[], input?: unknown): T {
    return JSON.parse(this.gh(args, input) || 'null') as T;
  }

  private headSha(pr: number): string {
    return this.gh([
      `repos/${this.repo}/pulls/${pr}`,
      '--jq',
      '.head.sha',
    ]).trim();
  }

  private checks(sha: string, name: string): CheckRun[] {
    return this.json<{ check_runs: CheckRun[] }>([
      `repos/${this.repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}`,
    ]).check_runs;
  }

  private createCheck(
    sha: string,
    name: string,
    fields: Record<string, unknown>,
  ) {
    this.gh(['-X', 'POST', `repos/${this.repo}/check-runs`, '--input', '-'], {
      name,
      head_sha: sha,
      ...fields,
    });
  }

  private completeFields(outcome: Outcome, url: string | undefined) {
    return {
      status: 'completed',
      conclusion: outcome.conclusion,
      ...(url ? { details_url: url } : {}),
      output: { title: outcome.text, summary: outcome.text },
    };
  }

  /** Marks a run as started, when the dispatcher hands it to a runner. */
  startRun(skill: string, kind: RunKind, number: number, url?: string): void {
    const text = startedText(skill, url);
    if (kind === 'pr') {
      const name = checkName(skill);
      const head = this.headSha(number);
      this.createCheck(head, name, {
        status: 'in_progress',
        ...(url ? { details_url: url } : {}),
        output: { title: 'Running', summary: text },
      });
    } else {
      this.updateIssue(number, text);
    }
  }

  /**
   * Completes a PR's run check. A review run that fixes things pushes new
   * commits, so the run's check may be on an older commit: complete it there,
   * and show the result on the head commit too, where the dispatcher reads
   * it. Does nothing if the head already has a result and no run going.
   */
  finishCheck(skill: string, pr: number, outcome: Outcome, url?: string): void {
    const name = checkName(skill);
    const head = this.headSha(pr);
    const onHead = this.checks(head, name);
    const running = onHead.find((c) => c.status === 'in_progress');
    if (running) {
      this.gh(
        [
          '-X',
          'PATCH',
          `repos/${this.repo}/check-runs/${running.id}`,
          '--input',
          '-',
        ],
        this.completeFields(outcome, url),
      );
      return;
    }
    if (onHead.some((c) => c.status === 'completed')) {
      return;
    }
    const commits = this.json<{ sha: string }[]>([
      `repos/${this.repo}/pulls/${pr}/commits?per_page=100`,
    ]);
    for (const { sha } of commits.reverse().slice(1)) {
      const earlier = this.checks(sha, name).find(
        (c) => c.status === 'in_progress',
      );
      if (earlier) {
        this.gh(
          [
            '-X',
            'PATCH',
            `repos/${this.repo}/check-runs/${earlier.id}`,
            '--input',
            '-',
          ],
          this.completeFields(outcome, url),
        );
        break;
      }
    }
    this.createCheck(head, name, this.completeFields(outcome, url));
  }

  /** Marks a run as finished, from its retro. */
  finishRun(retro: RetroFacts): void {
    const outcome = describeOutcome(retro);
    if (retro.skill === 'implement' && retro.issue) {
      this.updateIssue(retro.issue, outcome.text);
    } else if (retro.pr) {
      this.finishCheck(retro.skill, retro.pr, outcome, retro.session);
    }
  }

  private updateIssue(number: number, current: string): void {
    const comments = readPages(
      `repos/${this.repo}/issues/${number}/comments?per_page=100`,
      (page) => this.json<Comment[]>([page]),
    );
    const existing = findStatusComment(comments);
    const body = updateStatusComment(
      existing?.body ?? undefined,
      current,
      this.now(),
    );
    if (existing) {
      this.gh(
        [
          '-X',
          'PATCH',
          `repos/${this.repo}/issues/comments/${existing.id}`,
          '--input',
          '-',
        ],
        { body },
      );
    } else {
      this.gh(
        [
          '-X',
          'POST',
          `repos/${this.repo}/issues/${number}/comments`,
          '--input',
          '-',
        ],
        { body },
      );
    }
  }
}
