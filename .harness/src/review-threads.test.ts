import {
  parseThreadResolutions,
  threadsAwaitingAnswer,
  type ThreadResolution,
} from './review-threads.ts';
import { describe, expect, it } from './test/expect.ts';

const bot = { login: 'example-agent[bot]' };
const human = { login: 'octocat' };

let nextId = 100;
const reviewComment = (
  user: { login: string },
  body: string,
  createdAt: string,
  root?: number,
) => ({
  id: nextId++,
  in_reply_to_id: root ?? null,
  user,
  author_association: user.login.endsWith('[bot]') ? 'NONE' : 'COLLABORATOR',
  body,
  created_at: createdAt,
  path: '.harness/src/relay.ts',
  line: 12,
  original_line: 12,
});

/** A reviewer agent's finding, and an agent's question in reply. */
function askedThread() {
  const finding = reviewComment(
    bot,
    '[blocking] This drops the error.\n\n<!-- agent -->',
    '2026-10-22T09:00:00Z',
  );
  const question = reviewComment(
    bot,
    'Should it retry, or fail the run?\n\n<!-- agent -->',
    '2026-10-22T10:00:00Z',
    finding.id,
  );
  return { finding, question };
}

const roots = (threads: { root_id: number }[]) => threads.map((t) => t.root_id);

describe('threadsAwaitingAnswer', () => {
  it('includes a finding nobody has replied to', () => {
    const { finding } = askedThread();
    expect(roots(threadsAwaitingAnswer([finding]))).toEqual([finding.id]);
  });

  it("excludes a thread whose only comment is from someone who isn't a collaborator", () => {
    const outsider = {
      ...reviewComment(
        { login: 'passer-by' },
        'This drops the error.',
        '2026-10-22T09:00:00Z',
      ),
      author_association: 'NONE',
    };
    expect(threadsAwaitingAnswer([outsider])).toEqual([]);
  });

  it("excludes a thread whose only comment is another bot's, even with the agent mark", () => {
    const other = reviewComment(
      { login: 'lint-bot[bot]' },
      'This drops the error.\n\n<!-- agent -->',
      '2026-10-22T09:00:00Z',
    );
    expect(threadsAwaitingAnswer([other])).toEqual([]);
  });

  it("excludes a thread whose only comment is the agent bot's without the agent mark", () => {
    const unmarked = reviewComment(
      bot,
      'This drops the error.',
      '2026-10-22T09:00:00Z',
    );
    expect(threadsAwaitingAnswer([unmarked])).toEqual([]);
  });

  it("includes a thread whose only comment is a collaborator's", () => {
    const comment = reviewComment(
      human,
      'This drops the error.',
      '2026-10-22T09:00:00Z',
    );
    expect(roots(threadsAwaitingAnswer([comment]))).toEqual([comment.id]);
  });

  it('includes a thread a human spoke last on', () => {
    const { finding, question } = askedThread();
    const reply = reviewComment(
      human,
      'Fail it.',
      '2026-10-22T11:00:00Z',
      finding.id,
    );
    expect(roots(threadsAwaitingAnswer([finding, question, reply]))).toEqual([
      finding.id,
    ]);
  });

  it('excludes a thread an agent spoke last on', () => {
    const { finding, question } = askedThread();
    expect(threadsAwaitingAnswer([finding, question])).toEqual([]);
  });

  it("excludes a thread whose last comment is a collaborator's with the agent mark, as an interactive agent session posts", () => {
    const { finding, question } = askedThread();
    const interactive = reviewComment(
      human,
      'Fixed in abc123.\n\n<!-- agent -->',
      '2026-10-22T11:00:00Z',
      finding.id,
    );
    expect(threadsAwaitingAnswer([finding, question, interactive])).toEqual([]);
  });

  it("excludes a thread whose last comment is the bot's without the agent mark", () => {
    const { finding, question } = askedThread();
    const unmarked = reviewComment(
      bot,
      'Fail it.',
      '2026-10-22T11:00:00Z',
      finding.id,
    );
    expect(threadsAwaitingAnswer([finding, question, unmarked])).toEqual([]);
  });

  it("excludes a thread whose last comment is from someone who isn't a collaborator", () => {
    const { finding, question } = askedThread();
    const outsider = {
      ...reviewComment(
        { login: 'passer-by' },
        'Fail it.',
        '2026-10-22T11:00:00Z',
        finding.id,
      ),
      author_association: 'NONE',
    };
    expect(threadsAwaitingAnswer([finding, question, outsider])).toEqual([]);
  });

  it("doesn't count an outsider's comment as an agent's, even with the agent mark", () => {
    const { finding, question } = askedThread();
    const outsider = {
      ...reviewComment(
        { login: 'passer-by' },
        'Fixed in abc123.\n\n<!-- agent -->',
        '2026-10-22T11:00:00Z',
        finding.id,
      ),
      author_association: 'NONE',
    };
    const [thread] = threadsAwaitingAnswer([finding, question, outsider], {
      all: true,
    });
    expect(thread?.comments.map((c) => c.agent)).toEqual([true, true, false]);
  });

  it('lists every thread with `all`, oldest comment first', () => {
    const { finding, question } = askedThread();
    expect(threadsAwaitingAnswer([question, finding], { all: true })).toEqual([
      {
        root_id: finding.id,
        path: '.harness/src/relay.ts',
        line: 12,
        resolved: null,
        comments: [
          { user: bot.login, body: finding.body, agent: true },
          { user: bot.login, body: question.body, agent: true },
        ],
      },
    ]);
  });

  it('reports each thread resolved or not, as the route read gives it', () => {
    const { finding, question } = askedThread();
    const open = reviewComment(human, 'Rename this.', '2026-10-22T09:30:00Z');
    const threads = threadsAwaitingAnswer([finding, question, open], {
      all: true,
      resolved: [
        { resolved: true, comment_ids: [finding.id, question.id] },
        { resolved: false, comment_ids: [open.id] },
      ],
    });
    expect(
      threads.map((t) => ({ root_id: t.root_id, resolved: t.resolved })),
    ).toEqual([
      { root_id: finding.id, resolved: true },
      { root_id: open.id, resolved: false },
    ]);
  });

  it('reports null for every thread when the route read failed, and for one it leaves out', () => {
    const { finding, question } = askedThread();
    const open = reviewComment(human, 'Rename this.', '2026-10-22T09:30:00Z');
    const resolvedStates = (resolved: ThreadResolution[] | null) =>
      threadsAwaitingAnswer([finding, question, open], {
        all: true,
        resolved,
      }).map((t) => t.resolved);
    expect(resolvedStates(null)).toEqual([null, null]);
    expect(
      resolvedStates([{ resolved: true, comment_ids: [open.id] }]),
    ).toEqual([null, true]);
  });
});

describe('parseThreadResolutions', () => {
  it("reads the route's threads", () => {
    expect(
      parseThreadResolutions([
        {
          resolved: false,
          outdated: false,
          path: '.harness/src/relay.ts',
          line: 12,
          comment_ids: [100, 101],
        },
      ]),
    ).toEqual([{ resolved: false, comment_ids: [100, 101] }]);
  });

  it.each([
    ['an error', { message: 'Not Found' }],
    ['a thread without a resolved state', [{ comment_ids: [100] }]],
    ['a thread without comment ids', [{ resolved: true }]],
    ['a non-numeric comment id', [{ resolved: true, comment_ids: ['100'] }]],
  ])('reads null from %s', (_, json) => {
    expect(parseThreadResolutions(json)).toBeNull();
  });
});
