import {
  closedIssueNumbers,
  isAgentBranch,
  parseAgentBranch,
  prIssue,
} from './branches.ts';
import { describe, expect, it } from './test/expect.ts';

describe('parseAgentBranch', () => {
  it('reads type, issue and slug', () => {
    expect(parseAgentBranch('feat/13-health-check')).toEqual({
      type: 'feat',
      issue: 13,
      slug: 'health-check',
    });
    expect(parseAgentBranch('refs/heads/fix/7-login')).toMatchObject({
      type: 'fix',
      issue: 7,
    });
  });

  it.each([
    'main',
    'feature/13-health',
    'feat/health-check',
    'feat/13',
    'feat/13-Health',
    'feat/13-one-two-three-four-five',
    'feat/13-a-much-too-long-slug-for-a-branch',
    'claude/issue-13-health',
  ])('rejects %s', (ref) => {
    expect(parseAgentBranch(ref)).toBeUndefined();
  });
});

describe('isAgentBranch', () => {
  it('accepts the naming and legacy claude/ branches', () => {
    expect(isAgentBranch('chore/4-bump-deps')).toBe(true);
    expect(isAgentBranch('claude/issue-13-health')).toBe(true);
    expect(isAgentBranch('main')).toBe(false);
    expect(isAgentBranch('my-branch')).toBe(false);
  });
});

describe('closedIssueNumbers', () => {
  it.each([
    ['Closes #4', [4]],
    ['fixes #12 and more', [12]],
    ['Resolved #7', [7]],
    ['Closes: #7', [7]],
    ['<!-- Fixes #7 -->\nCloses #4', [7, 4]],
    ['fixes example/repo#7', [7]],
    ['Fixes Example/Repo#7', [7]],
    ['Resolves https://github.com/example/repo/issues/7', [7]],
    ['Fixes other-org/lib#7', []],
    ['Resolves https://github.com/other-org/lib/issues/7', []],
    ['Refs #4', []],
    [null, []],
  ])('reads %j as %j', (body, numbers) => {
    expect(closedIssueNumbers(body, 'example/repo')).toEqual(numbers);
  });
});

describe('prIssue', () => {
  const repo = 'example/repo';

  it.each([
    ['feat/4-x', 'Closes #4', 4],
    ['feat/4-x', 'Closes #7\nCloses #4', 4],
    ['feat/4-x', 'Closes #7', undefined],
    ['feat/4-x', 'Fixes other-org/lib#4', undefined],
    ['feat/4-x', null, undefined],
    ['my-branch', 'Closes #4', undefined],
  ])('reads %j with %j as %j', (head, body, issue) => {
    expect(prIssue({ head, body }, repo)).toBe(issue);
  });
});
