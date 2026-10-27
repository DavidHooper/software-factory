import {
  AGENT_APP,
  AGENT_BOT,
  checkName,
  describeOutcome,
  isAgentReview,
  parseRetro,
  StatusSync,
  updateStatusComment,
  type GhApi,
} from './agent-status.ts';
import { describe, expect, it } from './test/expect.ts';

const retroBody = (data: object) =>
  `<!-- agent-retro v1 -->\n## Agent retro\n\n<details><summary>Data</summary>\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n\n</details>\n<!-- agent -->`;

describe('parseRetro', () => {
  it('reads the facts from a retro comment', () => {
    expect(
      parseRetro(
        retroBody({
          skill: 'review-pr',
          pr: 14,
          issue: 13,
          outcome: 'reviewed',
          session: 'https://s',
        }),
      ),
    ).toEqual({
      skill: 'review-pr',
      pr: 14,
      issue: 13,
      outcome: 'reviewed',
      session: 'https://s',
    });
  });

  it('reads the same facts from a run report, posted when retros are off', () => {
    const report = retroBody({
      skill: 'implement',
      issue: 7,
      outcome: 'pr-opened',
    }).replace(
      '<!-- agent-retro v1 -->\n## Agent retro',
      '<!-- agent-run v1 -->\n## Agent run',
    );
    expect(parseRetro(report)).toEqual({
      skill: 'implement',
      issue: 7,
      pr: undefined,
      outcome: 'pr-opened',
      session: undefined,
    });
  });

  it('ignores other comments', () => {
    expect(parseRetro('Just a comment')).toBeUndefined();
    expect(
      parseRetro('<!-- agent-retro v1 -->\n```json\nnot json\n```'),
    ).toBeUndefined();
  });
});

describe('the agent bot', () => {
  it('is the App named by `bot` in the config', () => {
    expect(AGENT_APP).toBe('example-agent');
    expect(AGENT_BOT).toBe('example-agent[bot]');
  });
});

describe('describeOutcome', () => {
  it.each([
    ['pr-opened', 'success'],
    ['reviewed', 'success'],
    ['blocked', 'action_required'],
    ['waiting', 'neutral'],
    ['abandoned', 'cancelled'],
    ['supervised-run', 'success'],
  ])('maps %s to %s', (outcome, conclusion) => {
    expect(describeOutcome({ skill: 'implement', outcome }).conclusion).toBe(
      conclusion,
    );
  });

  it("names the harness supervisor's outcome", () => {
    expect(
      describeOutcome({ skill: 'supervise', outcome: 'supervised-run' }).text,
    ).toBe('✅ Supervised the workflow');
  });
});

describe('updateStatusComment', () => {
  it('keeps a log under the current state', () => {
    const first = updateStatusComment(
      undefined,
      'Running',
      new Date('2026-10-20T06:32:00Z'),
    );
    const second = updateStatusComment(
      first,
      'Opened PR #16',
      new Date('2026-10-20T06:41:00Z'),
    );
    expect(second).toContain('**Agent status:** Opened PR #16');
    expect(second).toContain(
      '- 06:32 UTC · Running\n- 06:41 UTC · Opened PR #16',
    );
    expect(second.startsWith('<!-- agent-status -->')).toBe(true);
  });
});

/** A fake `gh api` over canned responses, recording every write. */
function fakeGh(responses: Record<string, unknown>) {
  const writes: { method: string; path: string; input: unknown }[] = [];
  const gh: GhApi = (args, input) => {
    const method = args[0] === '-X' ? (args[1] ?? '') : 'GET';
    const path = args[0] === '-X' ? (args[2] ?? '') : (args[0] ?? '');
    if (method !== 'GET') {
      writes.push({ method, path, input });
      return '{}';
    }
    const key = Object.keys(responses).find((k) => path.startsWith(k));
    if (key === undefined) {
      throw new Error(`unexpected GET ${path}`);
    }
    const value = responses[key];
    return args.includes('.head.sha') ? String(value) : JSON.stringify(value);
  };
  return { gh, writes };
}

describe('StatusSync', () => {
  const repo = 'o/r';

  it('starts a PR run as an in-progress check linking to the session', () => {
    const { gh, writes } = fakeGh({
      'repos/o/r/pulls/16': 'abc',
      'repos/o/r/commits/abc/check-runs': { check_runs: [] },
    });
    new StatusSync(gh, repo).startRun(
      'review-pr',
      'pr',
      16,
      'https://claude.ai/code/s',
    );
    expect(writes).toEqual([
      {
        method: 'POST',
        path: 'repos/o/r/check-runs',
        input: expect.objectContaining({
          name: 'Agent review',
          head_sha: 'abc',
          status: 'in_progress',
          details_url: 'https://claude.ai/code/s',
        }) as unknown,
      },
    ]);
  });

  it('starts and finishes an issue run in one status comment', () => {
    const { gh, writes } = fakeGh({ 'repos/o/r/issues/15/comments': [] });
    new StatusSync(gh, repo).startRun('implement', 'issue', 15, 'https://s');
    expect(writes[0]).toMatchObject({
      method: 'POST',
      path: 'repos/o/r/issues/15/comments',
    });

    const existing = {
      id: 9,
      body: (writes[0]?.input as { body: string }).body,
    };
    const later = fakeGh({ 'repos/o/r/issues/15/comments': [existing] });
    new StatusSync(later.gh, repo).finishRun({
      skill: 'implement',
      issue: 15,
      pr: 16,
      outcome: 'pr-opened',
    });
    expect(later.writes[0]).toMatchObject({
      method: 'PATCH',
      path: 'repos/o/r/issues/comments/9',
    });
    expect((later.writes[0]?.input as { body: string }).body).toContain(
      '**Agent status:** ✅ Opened PR #16',
    );
  });

  it('completes the running check on the head commit', () => {
    const { gh, writes } = fakeGh({
      'repos/o/r/pulls/14': 'head',
      'repos/o/r/commits/head/check-runs': {
        check_runs: [{ id: 5, status: 'in_progress', head_sha: 'head' }],
      },
    });
    new StatusSync(gh, repo).finishRun({
      skill: 'review-pr',
      pr: 14,
      outcome: 'reviewed',
    });
    expect(writes).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: 'repos/o/r/check-runs/5',
      }),
    ]);
  });

  it('leaves a result already on the head commit alone', () => {
    const { gh, writes } = fakeGh({
      'repos/o/r/pulls/14': 'head',
      'repos/o/r/commits/head/check-runs': {
        check_runs: [{ id: 5, status: 'completed', head_sha: 'head' }],
      },
    });
    new StatusSync(gh, repo).finishRun({
      skill: 'review-pr',
      pr: 14,
      outcome: 'reviewed',
    });
    expect(writes).toEqual([]);
  });

  it('after a review run pushed, completes the check on the old commit and shows the result on the new one', () => {
    const { gh, writes } = fakeGh({
      'repos/o/r/pulls/14/commits': [{ sha: 'old' }, { sha: 'new' }],
      'repos/o/r/pulls/14': 'new',
      'repos/o/r/commits/new/check-runs': { check_runs: [] },
      'repos/o/r/commits/old/check-runs': {
        check_runs: [{ id: 3, status: 'in_progress', head_sha: 'old' }],
      },
    });
    new StatusSync(gh, repo).finishRun({
      skill: 'review-pr',
      pr: 14,
      outcome: 'reviewed',
    });
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      'PATCH repos/o/r/check-runs/3',
      'POST repos/o/r/check-runs',
    ]);
    expect(writes[1]?.input).toMatchObject({
      name: checkName('review-pr'),
      head_sha: 'new',
      conclusion: 'success',
    });
  });

  it("completes a second run's check on a head that has the first run's result", () => {
    const { gh, writes } = fakeGh({
      'repos/o/r/pulls/14': 'head',
      'repos/o/r/commits/head/check-runs': {
        check_runs: [
          { id: 5, status: 'completed', head_sha: 'head' },
          { id: 6, status: 'in_progress', head_sha: 'head' },
        ],
      },
    });
    new StatusSync(gh, repo).finishRun({
      skill: 'review-pr',
      pr: 14,
      outcome: 'reviewed',
    });
    expect(writes).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: 'repos/o/r/check-runs/6',
      }),
    ]);
  });
});

describe('isAgentReview', () => {
  const review = (login: string, body: string | null) => ({
    user: { login },
    body,
  });

  it('counts a marked review from the agent bot', () => {
    expect(
      isAgentReview(review(`${AGENT_APP}[bot]`, '<!-- agent-review -->\nOK')),
    ).toBe(true);
  });

  it("ignores someone else's review with the marker, and unmarked ones", () => {
    expect(isAgentReview(review('octocat', '<!-- agent-review -->'))).toBe(
      false,
    );
    expect(isAgentReview(review(`${AGENT_APP}[bot]`, 'Looks good'))).toBe(
      false,
    );
    expect(isAgentReview({ user: null, body: null })).toBe(false);
  });
});
