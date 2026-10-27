import { pr79CheckRuns } from './ci-status.fixtures.ts';
import { ciReport, ciStatus } from './ci-status.ts';
import { describe, expect, it } from './test/expect.ts';

const run = (
  name: string,
  status: string,
  conclusion: string | null = null,
) => ({
  name,
  status,
  conclusion,
});

describe('ciStatus', () => {
  it('is pending until a check run exists', () => {
    expect(ciStatus([])).toEqual({ state: 'pending', failed: [], pending: [] });
  });

  it('is pending while any run is unfinished', () => {
    expect(
      ciStatus([
        run('Verify', 'completed', 'success'),
        run('Harness guard', 'in_progress'),
      ]),
    ).toEqual({ state: 'pending', failed: [], pending: ['Harness guard'] });
  });

  it('names both the failed and the unfinished runs while others are running', () => {
    expect(
      ciStatus([
        run('Verify', 'queued'),
        run('Harness guard', 'completed', 'failure'),
      ]),
    ).toEqual({
      state: 'pending',
      failed: ['Harness guard'],
      pending: ['Verify'],
    });
  });

  it('passes when every run succeeded, was skipped or was neutral', () => {
    expect(
      ciStatus([
        run('Verify', 'completed', 'success'),
        run('Harness guard', 'completed', 'skipped'),
        run('Other', 'completed', 'neutral'),
      ]),
    ).toEqual({ state: 'passed', failed: [], pending: [] });
  });

  it('fails, naming the failed runs, when any finished badly', () => {
    expect(
      ciStatus([
        run('Verify', 'completed', 'failure'),
        run('Harness guard', 'completed', 'success'),
        run('Lint', 'completed', 'timed_out'),
      ]),
    ).toEqual({ state: 'failed', failed: ['Verify', 'Lint'], pending: [] });
  });

  it('counts only the latest run of each check', () => {
    const guard = (id: number, status: string, conclusion: string | null) => ({
      ...run('Harness guard', status, conclusion),
      id,
    });
    expect(
      ciStatus([
        guard(2, 'completed', 'success'),
        guard(1, 'completed', 'cancelled'),
        run('Verify', 'completed', 'success'),
      ]),
    ).toEqual({ state: 'passed', failed: [], pending: [] });
    expect(
      ciStatus([
        guard(1, 'completed', 'success'),
        guard(2, 'completed', 'failure'),
      ]),
    ).toEqual({ state: 'failed', failed: ['Harness guard'], pending: [] });
    expect(
      ciStatus([
        guard(1, 'completed', 'cancelled'),
        guard(2, 'in_progress', null),
      ]),
    ).toEqual({ state: 'pending', failed: [], pending: ['Harness guard'] });
  });

  describe('with a cancelled run of a check (#83)', () => {
    const guard = (id: number, conclusion: string) => ({
      ...run('Harness guard', 'completed', conclusion),
      id,
    });
    const verify = run('Verify', 'completed', 'success');

    it('passes when a later skipped or successful run superseded it', () => {
      for (const later of ['skipped', 'success']) {
        expect(
          ciStatus([guard(1, 'cancelled'), guard(2, later), verify]),
        ).toEqual({ state: 'passed', failed: [], pending: [] });
      }
    });

    it("fails when it's the check's only run", () => {
      expect(ciStatus([guard(1, 'cancelled'), verify])).toEqual({
        state: 'failed',
        failed: ['Harness guard'],
        pending: [],
      });
    });

    it('fails when a later run failed', () => {
      expect(ciStatus([guard(1, 'cancelled'), guard(2, 'failure')])).toEqual({
        state: 'failed',
        failed: ['Harness guard'],
        pending: [],
      });
    });

    it("judges a check by its latest run, even when that's the cancelled one", () => {
      expect(ciStatus([guard(1, 'success'), guard(2, 'cancelled')])).toEqual({
        state: 'failed',
        failed: ['Harness guard'],
        pending: [],
      });
    });

    it("passes on PR #79's real check runs", () => {
      expect(ciStatus(pr79CheckRuns)).toEqual({
        state: 'passed',
        failed: [],
        pending: [],
      });
    });
  });

  it("ignores the agents' own status checks", () => {
    expect(
      ciStatus([
        run('Verify', 'completed', 'success'),
        run('Agent implement', 'in_progress'),
        run('Agent review', 'completed', 'failure'),
      ]),
    ).toEqual({ state: 'passed', failed: [], pending: [] });
  });
});

describe('ciReport', () => {
  const sha = '0123456789abcdef';

  it('lists each check that ran once, then counts the skipped ones', () => {
    expect(
      ciReport(sha, [
        { ...run('Verify', 'completed', 'success'), id: 1 },
        { ...run('Verify', 'completed', 'success'), id: 2 },
        run('Harness guard', 'completed', 'success'),
        run(
          'Cloud · ${{ matrix.run.skill }} #${{ matrix.run.number }}',
          'completed',
          'skipped',
        ),
        run('Agent review', 'completed', 'success'),
      ]),
    ).toBe('CI passed on 0123456: Verify, Harness guard; 1 skipped.');
  });

  it('leaves out the skipped count when nothing was skipped', () => {
    expect(ciReport(sha, [run('Verify', 'completed', 'success')])).toBe(
      'CI passed on 0123456: Verify.',
    );
  });

  it('only counts the skipped checks when every check was skipped', () => {
    expect(ciReport(sha, [run('Verify', 'completed', 'skipped')])).toBe(
      'CI passed on 0123456: 1 skipped.',
    );
  });

  it('gives each failed check its output title, when it has one', () => {
    expect(
      ciReport(sha, [
        {
          ...run('Verify', 'completed', 'failure'),
          output: { title: 'harness:test failed' },
        },
        { ...run('Lint', 'completed', 'timed_out'), output: { title: null } },
        run('Harness guard', 'completed', 'success'),
      ]),
    ).toBe(
      "CI failed on 0123456: Verify (harness:test failed), Lint. Read the failing run's log with gh api repos/{owner}/{repo}/actions/runs.",
    );
  });

  it('has nothing to report while checks are running', () => {
    expect(ciReport(sha, [run('Verify', 'in_progress')])).toBeUndefined();
  });
});
