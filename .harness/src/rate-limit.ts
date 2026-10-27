/**
 * Retries a GitHub read that hit the API rate limit (#137), so a burst of
 * events doesn't crash the dispatcher on the first limited response. `gh api`
 * doesn't show a failed response's headers, so the wait comes from the
 * `rate_limit` endpoint's reset time (the same as `x-ratelimit-reset`). A
 * transient server error (HTTP 500, 502, 503 or 504) is retried too, after a
 * short backoff (#159), so one bad gateway doesn't refuse a merge.
 */

/** A failed command's stderr, or the error. */
const stderrText = (error: unknown): string =>
  (error as { stderr?: string }).stderr?.trim() || String(error);

/**
 * GitHub refused a read because a rate limit was exceeded: a 403 or 429 that
 * says so, or a GraphQL error (which `gh` reports with no HTTP status).
 */
const isRateLimited = (error: unknown): boolean => {
  const text = stderrText(error);
  const status = /HTTP (\d{3})\b/.exec(text)?.[1];
  return (
    /rate limit/i.test(text) &&
    (status === undefined || status === '403' || status === '429')
  );
};

/**
 * GitHub failed a read with a server error that usually clears at once: `gh`
 * says `(HTTP 502)`, and `git fetch` says `The requested URL returned error: 502`.
 */
const isTransient = (error: unknown): boolean =>
  /(?:HTTP|returned error:) 50[0234]\b/.test(stderrText(error));

/**
 * The waits before each retry of a read that failed with a transient server
 * error: twice at most, then the error is thrown as it came.
 */
const TRANSIENT_BACKOFF_MS = [2_000, 4_000];

/** Waited past the reset, so the limit has cleared when the read runs again. */
const RESET_MARGIN_MS = 1000;

/**
 * The wait for a limit with no reset time, such as a secondary rate limit:
 * GitHub's docs say to wait at least a minute when no `retry-after` comes.
 */
const UNKNOWN_RESET_WAIT_MS = 60_000;

/**
 * The most a run waits for the rate limit and transient server errors, over
 * all its reads: the dispatcher's `Route` job times out after 5 minutes, and a
 * job cancelled by its timeout never logs why.
 */
export const MAX_RATE_LIMIT_WAIT_MS = 2 * 60_000;

/** How long a run's reads have waited to be retried so far. */
export interface RateLimitBudget {
  waitedMs: number;
}

export interface RetryDeps {
  /**
   * Shared by every read in the run, so they wait `MAX_RATE_LIMIT_WAIT_MS` in
   * all, for the rate limit and transient server errors together.
   */
  budget: RateLimitBudget;
  now: () => number;
  /** Blocks for `ms` milliseconds. */
  sleep: (ms: number) => void;
  /**
   * When the exhausted limit resets, in epoch milliseconds: `undefined` if
   * it isn't known or isn't exhausted (a secondary limit).
   */
  resetAt: () => number | undefined;
}

/**
 * `read`'s result, retried after each rate-limited failure once the limit
 * resets, and after a transient server error once `TRANSIENT_BACKOFF_MS` has
 * passed. Throws an error naming the rate limit and the read if waiting for it
 * would take the run past `MAX_RATE_LIMIT_WAIT_MS`, a server error as it came
 * once its retries are spent or would do the same, and any other error at
 * once.
 */
export function retryRateLimited<T>(read: () => T, deps: RetryDeps): T {
  let transientRetries = 0;
  for (;;) {
    try {
      return read();
    } catch (error) {
      if (isTransient(error)) {
        const wait = TRANSIENT_BACKOFF_MS[transientRetries++];
        if (
          wait === undefined ||
          deps.budget.waitedMs + wait > MAX_RATE_LIMIT_WAIT_MS
        ) {
          throw error;
        }
        deps.sleep(wait);
        deps.budget.waitedMs += wait;
        continue;
      }
      if (!isRateLimited(error)) {
        throw error;
      }
      const reset = deps.resetAt();
      const wait =
        reset === undefined
          ? UNKNOWN_RESET_WAIT_MS
          : Math.max(reset - deps.now(), 0) + RESET_MARGIN_MS;
      if (deps.budget.waitedMs + wait > MAX_RATE_LIMIT_WAIT_MS) {
        const command = String((error as Error).message).split('\n', 1)[0];
        throw new Error(
          `GitHub's API rate limit didn't clear within ${MAX_RATE_LIMIT_WAIT_MS / 60_000} minutes (${command}): ${stderrText(error)}`,
          { cause: error },
        );
      }
      deps.sleep(wait);
      deps.budget.waitedMs += wait;
    }
  }
}
