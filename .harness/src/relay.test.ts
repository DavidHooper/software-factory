import {
  applyWrite,
  defaultCodeOwners,
  parseRelayPayload,
  refusedWrite,
  writeSummary,
  type RelayWrite,
} from './relay.ts';
import { describe, expect, fn, it } from './test/expect.ts';

const repo = 'example/repo';
const base = `repos/${repo}`;

describe('parseRelayPayload', () => {
  it('passes any REST write on this repository through as it was sent', () => {
    const write = {
      method: 'POST',
      path: `${base}/issues/4/comments`,
      body: { body: 'Hi <!-- agent -->' },
    };
    expect(parseRelayPayload({ id: 'x', write }, repo)).toEqual(write);
    const remove = {
      method: 'DELETE',
      path: `${base}/issues/4/labels/agent-ready`,
    };
    expect(parseRelayPayload({ write: remove }, repo)).toEqual(remove);
  });

  it.each([
    [undefined, 'the payload needs a write'],
    [{ method: 'GET', path: `${base}/issues/4` }, 'method must be one of'],
    [{ method: 'POST' }, 'path must be'],
    [{ method: 'POST', path: `${base}/issues`, body: 'x' }, 'body must be'],
  ])('refuses a malformed write %j', (write, error) => {
    expect(() => parseRelayPayload({ write }, repo)).toThrow(error);
  });

  it('refuses the settings class', () => {
    expect(() =>
      parseRelayPayload(
        {
          write: {
            method: 'PATCH',
            path: `${base}/actions/variables/AGENTS_PAUSED`,
            body: { value: 'false' },
          },
        },
        repo,
      ),
    ).toThrow('Actions variables, secrets or repository settings');
  });
});

describe('refusedWrite', () => {
  const write = (method: RelayWrite['method'], path: string): RelayWrite => ({
    method,
    path,
  });

  it.each([
    ['POST', `${base}/issues/4/comments`],
    ['PATCH', `${base}/issues/comments/9`],
    ['POST', `${base}/pulls`],
    ['PATCH', `${base}/pulls/6`],
    ['POST', `${base}/pulls/6/reviews`],
    ['POST', `${base}/pulls/6/comments/3/replies`],
    ['POST', `${base}/issues/4/labels`],
    ['DELETE', `${base}/issues/4/labels/agent-ready`],
    ['PUT', `${base}/pulls/6/merge`],
    ['POST', `${base}/issues`],
    ['POST', `${base}/actions/runs/5/rerun`],
    ['POST', `/repos/Example/Repo/issues/4/comments?x=1`],
  ] as const)('passes %s %s', (method, path) => {
    expect(refusedWrite(write(method, path), repo)).toBeUndefined();
  });

  it.each([
    ['PATCH', `${base}/actions/variables/AGENTS_PAUSED`],
    ['DELETE', `${base}/actions/variables/AGENTS_PAUSED`],
    ['POST', `${base}/actions/variables`],
    ['PUT', `${base}/actions/secrets/AGENT_APP_PRIVATE_KEY`],
    ['PUT', `${base}/actions/permissions`],
    ['PUT', `${base}/environments/supervisor/secrets/KEY`],
    ['PUT', `${base}/dependabot/secrets/KEY`],
    ['PATCH', base],
    ['DELETE', `${base}/`],
    ['PUT', `${base}/branches/main/protection`],
    ['PUT', `${base}/branches/feat/13-x/protection`],
    ['DELETE', `${base}/branches/feat%2F13-x/protection/enforce_admins`],
    ['PATCH', `${base}/code-scanning/default-setup`],
    ['POST', `${base}/rulesets`],
    ['POST', `${base}/hooks`],
    ['PUT', `${base}/collaborators/someone`],
    ['POST', `${base}/keys`],
    ['POST', `${base}/transfer`],
    ['PUT', `${base}/topics`],
    ['PATCH', `${base}/issues/../actions/variables/AGENTS_PAUSED`],
    ['PATCH', `${base}/issues/%2e%2e/actions/variables/AGENTS_PAUSED`],
    ['PATCH', `${base}//actions/variables/AGENTS_PAUSED`],
    ['PATCH', `${base}/Actions/Variables/AGENTS_PAUSED`],
    ['PATCH', `${base}/actions%2Fvariables/AGENTS_PAUSED`],
    ['PUT', `${base}/actions/workflows/agent-relay.yml/disable`],
  ] as const)('refuses %s %s', (method, path) => {
    expect(refusedWrite(write(method, path), repo)).toMatch(
      /Actions variables, secrets or repository settings/,
    );
  });

  it.each([
    'graphql',
    'repos/other-org/lib/issues/4/comments',
    'orgs/example/actions/variables/AGENTS_PAUSED',
    'user/repos',
  ])("refuses %s, which isn't this repository's REST API", (path) => {
    expect(refusedWrite(write('POST', path), repo)).toMatch(
      /only to this repository's REST API/,
    );
  });
});

describe('applyWrite', () => {
  type Call = { args: string[]; input: unknown };

  const fakeGh = (responses: Record<string, unknown> = {}) => {
    const calls: Call[] = [];
    const gh = (args: string[], input?: unknown): string => {
      calls.push({ args, input });
      const path = args.find((a) => a.startsWith('repos/')) ?? '';
      const response = responses[path];
      if (response instanceof Error) {
        throw response;
      }
      return response === undefined ? '' : JSON.stringify(response);
    };
    return { gh, calls };
  };

  it('makes the call as it was sent and returns the response', () => {
    const { gh, calls } = fakeGh({
      [`${base}/issues/4/comments`]: { id: 9, html_url: 'u' },
    });
    const response = applyWrite(
      {
        method: 'POST',
        path: `${base}/issues/4/comments`,
        body: { body: 'Hi' },
      },
      { gh, reviewers: [], finishRun: fn() },
    );
    expect(calls).toEqual([
      {
        args: ['-X', 'POST', `${base}/issues/4/comments`, '--input', '-'],
        input: { body: 'Hi' },
      },
    ]);
    expect(response).toEqual({ id: 9, html_url: 'u' });
  });

  it('sends a write with no body without input', () => {
    const { gh, calls } = fakeGh();
    applyWrite(
      { method: 'DELETE', path: `${base}/issues/4/labels/agent-ready` },
      { gh, reviewers: [], finishRun: fn() },
    );
    expect(calls[0]?.args).toEqual([
      '-X',
      'DELETE',
      `${base}/issues/4/labels/agent-ready`,
    ]);
    expect(calls[0]?.input).toBeUndefined();
  });

  it("finishes the run's status when the comment is a retro", () => {
    const { gh } = fakeGh();
    const finishRun = fn();
    const retro = [
      '<!-- agent-retro v1 -->',
      '```json',
      '{"skill":"implement","issue":4,"outcome":"pr-opened"}',
      '```',
    ].join('\n');
    applyWrite(
      {
        method: 'POST',
        path: `${base}/issues/4/comments`,
        body: { body: retro },
      },
      { gh, reviewers: [], finishRun },
    );
    expect(finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'implement', issue: 4 }),
    );
    applyWrite(
      {
        method: 'POST',
        path: `${base}/issues/4/comments`,
        body: { body: 'Not a retro' },
      },
      { gh, reviewers: [], finishRun },
    );
    expect(finishRun).toHaveBeenCalledTimes(1);
  });

  it("finishes the run's status from a run report, posted when retros are off", () => {
    const { gh } = fakeGh();
    const finishRun = fn();
    const report = [
      '<!-- agent-run v1 -->',
      '## Agent run',
      '```json',
      '{"skill":"review-pr","pr":5,"outcome":"reviewed"}',
      '```',
    ].join('\n');
    applyWrite(
      {
        method: 'POST',
        path: `${base}/issues/5/comments`,
        body: { body: report },
      },
      { gh, reviewers: [], finishRun },
    );
    expect(finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'review-pr', pr: 5 }),
    );
  });

  it('asks the code owners for review once a review is posted', () => {
    const { gh, calls } = fakeGh();
    applyWrite(
      {
        method: 'POST',
        path: `${base}/pulls/6/reviews`,
        body: { event: 'COMMENT', body: 'Fixed two things' },
      },
      {
        gh,
        reviewers: ['example-user', 'example/core'],
        finishRun: fn(),
      },
    );
    expect(calls[1]).toEqual({
      args: [
        '-X',
        'POST',
        `${base}/pulls/6/requested_reviewers`,
        '--input',
        '-',
      ],
      input: { reviewers: ['example-user'], team_reviewers: ['core'] },
    });
  });

  it("doesn't fail the write when asking for review fails", () => {
    const { gh } = fakeGh({
      [`${base}/pulls/6/requested_reviewers`]: new Error('422'),
    });
    expect(() =>
      applyWrite(
        { method: 'POST', path: `${base}/pulls/6/reviews`, body: {} },
        { gh, reviewers: ['example-user'], finishRun: fn() },
      ),
    ).not.toThrow();
  });

  it('fails when the call fails', () => {
    const { gh } = fakeGh({ [`${base}/issues/4/comments`]: new Error('404') });
    expect(() =>
      applyWrite(
        { method: 'POST', path: `${base}/issues/4/comments`, body: {} },
        { gh, reviewers: [], finishRun: fn() },
      ),
    ).toThrow('404');
  });
});

describe('writeSummary', () => {
  it("keeps a response's number, id and URL", () => {
    expect(
      writeSummary({ number: 7, id: 3, html_url: 'u', body: 'long' }),
    ).toEqual({ number: 7, id: 3, html_url: 'u' });
  });

  it('keeps whether a merge happened', () => {
    expect(writeSummary({ merged: true, sha: 'abc', message: 'm' })).toEqual({
      merged: true,
      sha: 'abc',
      message: 'm',
    });
  });

  it('is empty for no response or a list', () => {
    expect(writeSummary(undefined)).toEqual({});
    expect(writeSummary([{ id: 1 }])).toEqual({});
  });
});

describe('defaultCodeOwners', () => {
  it('reads the catch-all owners from CODEOWNERS', () => {
    expect(
      defaultCodeOwners('# c\n*   @example-user @example/core\n/docs/ @x\n'),
    ).toEqual(['example-user', 'example/core']);
    expect(defaultCodeOwners('/docs/ @x\n')).toEqual([]);
  });
});
