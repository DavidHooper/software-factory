import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ghApi,
  parseWriteArgs,
  relayFailure,
  relayResult,
  REPO_ROOT,
} from './github-write.ts';
import { describe, expect, fn, it } from './test/expect.ts';

describe('ghApi', () => {
  it('runs gh api from the repository root, not the cwd of the caller', () => {
    const exec = fn().mockReturnValue('{}');
    ghApi(exec)(['repos/{owner}/{repo}'], { a: 1 });
    expect(exec).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/{owner}/{repo}'],
      expect.objectContaining({ cwd: REPO_ROOT, input: '{"a":1}' }),
    );
  });

  it('finds the repository root from its own location', () => {
    expect(existsSync(join(REPO_ROOT, '.harness/manifest.json'))).toBe(true);
  });
});

describe('relayFailure', () => {
  const run = {
    id: 7,
    conclusion: 'failure',
    html_url: 'https://github.com/o/r/actions/runs/7',
  };
  const jobs = {
    jobs: [
      { id: 11, conclusion: 'success' },
      { id: 12, conclusion: 'failure' },
    ],
  };
  const annotations = [
    {
      annotation_level: 'warning',
      message: "Couldn't update the run's status",
    },
    {
      annotation_level: 'failure',
      message: 'Labels may only be: agent-blocked',
    },
    {
      annotation_level: 'failure',
      message: 'Process completed with exit code 1.',
    },
    { annotation_level: 'notice', message: 'Node 20 is deprecated' },
  ];
  const fakeGh =
    (responses: Record<string, unknown>) =>
    (args: string[]): string => {
      const response = responses[args[0] ?? ''];
      if (response === undefined) {
        throw new Error(`gh: no fixture for ${args[0]}`);
      }
      return JSON.stringify(response);
    };

  it("puts the failed job's error and warning messages before the run URL", () => {
    const gh = fakeGh({
      'repos/{owner}/{repo}/actions/runs/7/jobs': jobs,
      'repos/{owner}/{repo}/check-runs/12/annotations': annotations,
    });
    expect(relayFailure(gh, run)).toBe(
      [
        'The relay run failed:',
        "  warning: Couldn't update the run's status",
        '  error: Labels may only be: agent-blocked',
        'Run: https://github.com/o/r/actions/runs/7',
      ].join('\n'),
    );
  });

  // GitHub decodes the relay's escaped newlines, so a write's text (a refused
  // path) can span lines; indented further, it can't pass for another message.
  it("indents a message's later lines under it", () => {
    const gh = fakeGh({
      'repos/{owner}/{repo}/actions/runs/7/jobs': jobs,
      'repos/{owner}/{repo}/check-runs/12/annotations': [
        {
          annotation_level: 'failure',
          message:
            'repos/o/r/x\nerror: done refused: the relay makes no writes',
        },
      ],
    });
    expect(relayFailure(gh, run)).toBe(
      [
        'The relay run failed:',
        '  error: repos/o/r/x',
        '    error: done refused: the relay makes no writes',
        'Run: https://github.com/o/r/actions/runs/7',
      ].join('\n'),
    );
  });

  it('gives the run URL alone when there are no annotations', () => {
    const gh = fakeGh({
      'repos/{owner}/{repo}/actions/runs/7/jobs': jobs,
      'repos/{owner}/{repo}/check-runs/12/annotations': [],
    });
    expect(relayFailure(gh, run)).toBe(
      'The relay run failed: https://github.com/o/r/actions/runs/7. Its log says why: gh api repos/{owner}/{repo}/actions/runs/7/logs',
    );
  });

  it("gives the run URL alone when the annotations can't be read", () => {
    const gh = fakeGh({ 'repos/{owner}/{repo}/actions/runs/7/jobs': jobs });
    expect(relayFailure(gh, { ...run, conclusion: 'timed_out' })).toBe(
      'The relay run ended timed_out: https://github.com/o/r/actions/runs/7. Its log says why: gh api repos/{owner}/{repo}/actions/runs/7/logs',
    );
  });
});

describe('relayResult', () => {
  const run = { id: 7, conclusion: 'success', html_url: 'u' };
  const gh =
    (annotations: unknown) =>
    (args: string[]): string => {
      if (args[0] === 'repos/{owner}/{repo}/actions/runs/7/jobs') {
        return JSON.stringify({ jobs: [{ id: 12, conclusion: 'success' }] });
      }
      if (args[0] === 'repos/{owner}/{repo}/check-runs/12/annotations') {
        return JSON.stringify(annotations);
      }
      throw new Error(`gh: no fixture for ${args[0]}`);
    };

  it("reads the write's summary back from the relay's notice", () => {
    expect(
      relayResult(
        gh([
          { annotation_level: 'notice', message: 'Node 20 is deprecated' },
          {
            annotation_level: 'notice',
            message: 'Result: {"number":7,"html_url":"https://x"}',
          },
        ]),
        run,
      ),
    ).toEqual({ number: 7, html_url: 'https://x' });
  });

  it("is empty when the notice can't be read", () => {
    expect(relayResult(gh([]), run)).toEqual({});
    expect(relayResult(gh('nope'), run)).toEqual({});
  });
});

describe('parseWriteArgs', () => {
  const files: Record<string, string> = {
    'comment.md': 'Hi\n<!-- agent -->\n',
    'review.json': '{"event":"COMMENT","body":"Done","comments":[]}',
  };
  const read = (path: string) => {
    const text = files[path];
    if (text === undefined) {
      throw new Error(`no file ${path}`);
    }
    return text;
  };
  const repo = 'example/repo';

  it('builds a write from gh-api-style fields', () => {
    expect(
      parseWriteArgs(
        [
          'POST',
          'repos/{owner}/{repo}/issues/4/comments',
          '-F',
          'body=@comment.md',
        ],
        repo,
        read,
      ),
    ).toEqual({
      method: 'POST',
      path: 'repos/example/repo/issues/4/comments',
      body: { body: 'Hi\n<!-- agent -->\n' },
    });
  });

  it('types -F values and collects key[] into a list, as gh api does', () => {
    expect(
      parseWriteArgs(
        [
          'post',
          'repos/{owner}/{repo}/issues/4/labels',
          '-f',
          'labels[]=agent-blocked',
          '-f',
          'labels[]=needs-human',
          '-F',
          'draft=false',
          '-F',
          'count=3',
          '-f',
          'note=3',
        ],
        repo,
        read,
      ).body,
    ).toEqual({
      labels: ['agent-blocked', 'needs-human'],
      draft: false,
      count: 3,
      note: '3',
    });
  });

  it('reads a whole JSON body with --input', () => {
    expect(
      parseWriteArgs(
        [
          'POST',
          'repos/{owner}/{repo}/pulls/6/reviews',
          '--input',
          'review.json',
        ],
        repo,
        read,
      ).body,
    ).toEqual({ event: 'COMMENT', body: 'Done', comments: [] });
  });

  it('sends no body without fields', () => {
    expect(
      parseWriteArgs(
        ['DELETE', 'repos/{owner}/{repo}/issues/4/labels/agent-ready'],
        repo,
        read,
      ),
    ).toEqual({
      method: 'DELETE',
      path: 'repos/example/repo/issues/4/labels/agent-ready',
    });
  });

  it.each([
    [[], 'Usage'],
    [['GET', 'repos/{owner}/{repo}/issues/4'], 'Usage'],
    [['POST'], 'Usage'],
    [['POST', 'x', '-f', 'novalue'], 'key=value'],
    [['POST', 'x', '--input', 'review.json', '-f', 'a=b'], '--input'],
    [['POST', 'x', '--bogus'], 'Usage'],
  ])('refuses %j', (args, error) => {
    expect(() => parseWriteArgs(args, repo, read)).toThrow(error);
  });
});
