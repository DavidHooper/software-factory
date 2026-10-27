import { retryRateLimited } from './rate-limit.ts';
import { describe, expect, it } from './test/expect.ts';

/** An error shaped like a failed `gh api` from `execFileSync`. */
const ghError = (stderr: string) =>
  Object.assign(new Error('Command failed: gh api repos/o/r/pulls/62'), {
    stderr,
  });

const rateLimited = () =>
  ghError(
    'gh: API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID. (HTTP 403)',
  );

/** A read that fails with each of `failures` in turn, then returns `data`. */
function readFailing<T>(failures: Error[], data: T) {
  let calls = 0;
  const read = (): T => {
    const failure = failures[calls++];
    if (failure) {
      throw failure;
    }
    return data;
  };
  return { read, calls: () => calls };
}

/** A clock that `sleep` moves on, recording each wait, with a fresh run's budget. */
function clock(start = 1_000_000) {
  let time = start;
  const waits: number[] = [];
  return {
    budget: { waitedMs: 0 },
    now: () => time,
    sleep: (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    waits,
  };
}

describe('retryRateLimited', () => {
  it('returns the data of a read that succeeds after one rate-limit 403, having waited for the reset', () => {
    const { read, calls } = readFailing([rateLimited()], { number: 62 });
    const time = clock();
    const data = retryRateLimited(read, {
      ...time,
      resetAt: () => time.now() + 30_000,
    });
    expect(data).toEqual({ number: 62 });
    expect(calls()).toBe(2);
    expect(time.waits).toEqual([31_000]);
  });

  it('throws an error naming the rate limit when it keeps getting limited past the bound', () => {
    const { read } = readFailing(
      Array.from({ length: 10 }, rateLimited),
      'never',
    );
    const time = clock();
    expect(() =>
      retryRateLimited(read, { ...time, resetAt: () => time.now() + 50_000 }),
    ).toThrow(
      /^GitHub's API rate limit didn't clear within 2 minutes \(Command failed: gh api repos\/o\/r\/pulls\/62\): gh: API rate limit exceeded for installation/,
    );
    expect(time.waits).toEqual([51_000, 51_000]);
  });

  it('throws at once, without waiting, when the limit resets later than the bound allows', () => {
    const { read, calls } = readFailing([rateLimited()], 'never');
    const time = clock();
    expect(() =>
      retryRateLimited(read, {
        ...time,
        resetAt: () => time.now() + 30 * 60_000,
      }),
    ).toThrow(/rate limit didn't clear within 2 minutes/);
    expect(calls()).toBe(1);
    expect(time.waits).toEqual([]);
  });

  it('waits a minute for a secondary rate limit, which leaves the primary limit unexhausted', () => {
    const { read } = readFailing(
      [
        ghError(
          'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)',
        ),
      ],
      [],
    );
    const time = clock();
    expect(
      retryRateLimited(read, { ...time, resetAt: () => undefined }),
    ).toEqual([]);
    expect(time.waits).toEqual([60_000]);
  });

  it('shares the bound between the reads of one run, so the run fails before its job times out', () => {
    const time = clock();
    const resetAt = () => time.now() + 50_000;
    const first = readFailing([rateLimited(), rateLimited()], 1);
    expect(retryRateLimited(first.read, { ...time, resetAt })).toBe(1);
    const second = readFailing([rateLimited()], 2);
    expect(() => retryRateLimited(second.read, { ...time, resetAt })).toThrow(
      /rate limit didn't clear within 2 minutes/,
    );
    expect(time.waits).toEqual([51_000, 51_000]);
  });

  it('retries a GraphQL rate limit, which gh reports with no HTTP status', () => {
    const { read } = readFailing(
      [ghError('gh: API rate limit exceeded for installation ID 12345.')],
      { data: {} },
    );
    const time = clock();
    expect(
      retryRateLimited(read, { ...time, resetAt: () => time.now() + 10_000 }),
    ).toEqual({ data: {} });
    expect(time.waits).toEqual([11_000]);
  });

  it('returns the data of a read that succeeds after one transient HTTP 502, having backed off briefly', () => {
    const { read, calls } = readFailing(
      [ghError('gh: Server Error (HTTP 502)')],
      { number: 156 },
    );
    const time = clock();
    expect(
      retryRateLimited(read, { ...time, resetAt: () => undefined }),
    ).toEqual({ number: 156 });
    expect(calls()).toBe(2);
    expect(time.waits).toEqual([2_000]);
  });

  it("retries a git fetch that failed with a transient server error, in git's wording", () => {
    const { read, calls } = readFailing(
      [
        ghError(
          "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 502",
        ),
      ],
      '',
    );
    const time = clock();
    expect(retryRateLimited(read, { ...time, resetAt: () => undefined })).toBe(
      '',
    );
    expect(calls()).toBe(2);
    expect(time.waits).toEqual([2_000]);
  });

  it.each(['500', '502', '503', '504'])(
    'throws a read that keeps failing with HTTP %s as it came, after two retries',
    (status) => {
      const failure = ghError(`gh: Server Error (HTTP ${status})`);
      const { read, calls } = readFailing(
        Array.from({ length: 10 }, () => failure),
        'never',
      );
      const time = clock();
      expect(() =>
        retryRateLimited(read, { ...time, resetAt: () => undefined }),
      ).toThrow(failure);
      expect(calls()).toBe(3);
      expect(time.waits).toEqual([2_000, 4_000]);
    },
  );

  it('throws a transient server error at once when the run has spent its wait budget', () => {
    const failure = ghError('gh: Server Error (HTTP 502)');
    const { read, calls } = readFailing([failure], 'never');
    const time = clock();
    time.budget.waitedMs = 119_000;
    expect(() =>
      retryRateLimited(read, { ...time, resetAt: () => undefined }),
    ).toThrow(failure);
    expect(calls()).toBe(1);
    expect(time.waits).toEqual([]);
  });

  it.each([
    [
      "a 403 that isn't the rate limit",
      'gh: Resource not accessible by integration (HTTP 403)',
    ],
    ['a 404', 'gh: Not Found (HTTP 404)'],
    ['a 501', 'gh: Not Implemented (HTTP 501)'],
    ['an auth failure', 'gh: Bad credentials (HTTP 401)'],
    [
      'a 422 that mentions the rate limit',
      'gh: Validation Failed: rate limit field is invalid (HTTP 422)',
    ],
  ])('throws %s at once, without waiting', (_, stderr) => {
    const failure = ghError(stderr);
    const { read, calls } = readFailing([failure], 'never');
    const time = clock();
    expect(() =>
      retryRateLimited(read, { ...time, resetAt: () => time.now() }),
    ).toThrow(failure);
    expect(calls()).toBe(1);
    expect(time.waits).toEqual([]);
  });
});
