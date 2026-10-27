/**
 * Which inline review threads on a PR are still waiting for an answer. A
 * thread is a root comment and its replies (replies carry the root's id in
 * `in_reply_to_id`). One waits when:
 *
 * - nobody has replied to its root, and the root is an agent's (a reviewer
 *   agent's finding) or a collaborator's, or
 * - a human spoke last: its latest comment is a collaborator's, not a bot's
 *   (`isHuman`), without the agent mark.
 *
 * Agents mark their comments with `<!-- agent -->`; an interactive agent
 * session posts as its human, so the mark is what sets its replies apart. A
 * comment is an agent's only when it has the mark and its author is the agent
 * bot or a collaborator. Another bot or an outsider never speaks for a human
 * or an agent, mark or not, so it never makes a thread wait.
 */

import { AGENT_BOT } from './agent-status.ts';
import { isHuman, type Commenter } from './dispatch.ts';

export interface ReviewComment extends Commenter {
  id: number;
  body: string | null;
  created_at: string;
  /** Set on a reply in a thread: its root comment's id. */
  in_reply_to_id?: number | null;
  path: string;
  line?: number | null;
  original_line?: number | null;
}

export interface ReviewThread {
  root_id: number;
  path: string;
  line: number | null;
  /**
   * Whether GitHub has it resolved, or `null` when that couldn't be read:
   * the route failed, or didn't list this thread.
   */
  resolved: boolean | null;
  comments: { user: string | undefined; body: string | null; agent: boolean }[];
}

/**
 * A thread as the agent proxy's `pulls/<n>/ccr/review_threads` route reports
 * it: whether it's resolved, and its comments' ids, root first. Cloud sessions
 * refuse GraphQL, where GitHub otherwise keeps this, so the listing reads the
 * route instead.
 */
export interface ThreadResolution {
  resolved: boolean;
  comment_ids: number[];
}

/**
 * The route's response as `ThreadResolution`s, or `null` when it isn't a list of
 * threads each with a boolean `resolved` and numeric `comment_ids`, so an
 * unexpected answer reads as unknown rather than as resolved.
 */
export function parseThreadResolutions(
  json: unknown,
): ThreadResolution[] | null {
  if (!Array.isArray(json)) {
    return null;
  }
  const threads: ThreadResolution[] = [];
  for (const thread of json as unknown[]) {
    const { resolved, comment_ids } = (thread ?? {}) as Record<string, unknown>;
    if (
      typeof resolved !== 'boolean' ||
      !Array.isArray(comment_ids) ||
      !comment_ids.every((id) => typeof id === 'number')
    ) {
      return null;
    }
    threads.push({ resolved, comment_ids });
  }
  return threads;
}

const AGENT_MARK = '<!-- agent -->';

/**
 * The threads on a PR, from its review comments, waiting for an answer, or
 * every thread with `all`, each oldest comment first. `resolved` is the route's read of the PR's threads, or `null` when it
 * failed; each thread takes its resolved state from it, and `null` otherwise.
 */
export function threadsAwaitingAnswer(
  comments: readonly ReviewComment[],
  options: {
    all?: boolean;
    resolved?: readonly ThreadResolution[] | null;
  } = {},
): ReviewThread[] {
  const resolvedById = new Map<number, boolean>();
  for (const thread of options.resolved ?? []) {
    for (const id of thread.comment_ids) {
      resolvedById.set(id, thread.resolved);
    }
  }
  const byRoot = new Map<number, ReviewComment[]>();
  for (const comment of comments) {
    const root = comment.in_reply_to_id ?? comment.id;
    byRoot.set(root, [...(byRoot.get(root) ?? []), comment]);
  }
  return [...byRoot].flatMap(([rootId, thread]) => {
    const sorted = [...thread].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
    const [first] = sorted;
    const last = sorted.at(-1);
    if (!first || !last) {
      return [];
    }
    const isAgentComment = (c: ReviewComment) =>
      (c.user?.login === AGENT_BOT || isHuman(c)) &&
      (c.body ?? '').includes(AGENT_MARK);
    const waiting =
      (sorted.length === 1 &&
        (isHuman(first) ||
          (first.user?.login === AGENT_BOT && isAgentComment(first)))) ||
      (isHuman(last) && !isAgentComment(last));
    return options.all || waiting
      ? [
          {
            root_id: rootId,
            path: first.path,
            line: first.line ?? first.original_line ?? null,
            resolved: resolvedById.get(rootId) ?? null,
            comments: sorted.map((c) => ({
              user: c.user?.login,
              body: c.body,
              agent: isAgentComment(c),
            })),
          },
        ]
      : [];
  });
}
