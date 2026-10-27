/**
 * Fires a Claude cloud routine (docs/agents/cloud-routines.md), retrying when
 * the routine API is busy. A 429 or 5xx, or a request that couldn't connect,
 * is tried again with backoff, waiting longer when `Retry-After` asks, up to
 * `MAX_WAIT_MS`; anything else (a bad token, say) fails at once. So does a
 * request that timed out, ours or a gateway's (504): the routine may have
 * started a run, and a retry would start a second one. A fire takes at most
 * `FIRE_ATTEMPTS` × `REQUEST_TIMEOUT_MS` plus three waits of `MAX_WAIT_MS`,
 * about 7.5 minutes, so two fires fit inside its Actions job's timeout (#73).
 */

/** How many times a fire is tried before it fails. */
export const FIRE_ATTEMPTS = 4;

/** The wait before each retry, or longer if `Retry-After` asks. */
const BACKOFF_MS = [30_000, 60_000, 120_000];

/** The longest a single wait may be, whatever `Retry-After` asks. */
const MAX_WAIT_MS = 120_000;

/** How long one request may take before it fails, unretried. */
const REQUEST_TIMEOUT_MS = 20_000;

/** How much of a response body an error keeps. */
const MAX_BODY_CHARS = 300;

export interface FireOptions {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  /** The current time in milliseconds, for a `Retry-After` date. */
  now?: () => number;
}

export type FireResult =
  | { ok: true; sessionUrl: string | undefined; attempts: number }
  | { ok: false; error: string; attempts: number };

/**
 * A 429, or a 5xx other than a gateway timeout. Any other 5xx means the
 * routine API answered with an error, or a gateway couldn't reach it, so no
 * run started; a 504 means the gateway gave up waiting, as a timeout does.
 */
const retryable = (status: number): boolean =>
  status === 429 || (status >= 500 && status !== 504);

/**
 * A response body on one short line: the CLI prints it in an `::error::`
 * workflow command, where a newline would start another command.
 */
function oneLine(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > MAX_BODY_CHARS
    ? `${line.slice(0, MAX_BODY_CHARS)}…`
    : line;
}

/** How long `Retry-After` asks to wait, in seconds or until a date, if it's set. */
function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** POSTs `text` to the routine, as its fire endpoint expects, retrying when it's busy. */
export async function fireRoutine(
  url: string,
  token: string,
  text: string,
  options: FireOptions = {},
): Promise<FireResult> {
  const fetch = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  for (let attempt = 1; ; attempt++) {
    let wait: number | undefined;
    let error: string;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();
      if (response.ok) {
        let sessionUrl: string | undefined;
        try {
          sessionUrl = (
            JSON.parse(body) as { claude_code_session_url?: string }
          ).claude_code_session_url;
        } catch {
          // Started, but said nothing we can read.
        }
        return { ok: true, sessionUrl, attempts: attempt };
      }
      error = `HTTP ${response.status}: ${oneLine(body)}`;
      if (!retryable(response.status)) {
        return { ok: false, error, attempts: attempt };
      }
      wait = retryAfterMs(response.headers.get('Retry-After'), now());
    } catch (cause) {
      // AbortSignal.timeout's DOMException isn't an Error in every realm.
      const { name } = cause as { name?: unknown };
      if (name === 'TimeoutError') {
        return { ok: false, error: 'The request timed out', attempts: attempt };
      }
      // Not the message: for a malformed URL it holds the URL, a secret.
      error = `The request failed (${typeof name === 'string' ? name : 'unknown error'})`;
    }
    if (attempt >= FIRE_ATTEMPTS) {
      return { ok: false, error, attempts: attempt };
    }
    // `Retry-After` is the least the server asks for, so it only lengthens the backoff.
    const backoff = BACKOFF_MS[attempt - 1] ?? MAX_WAIT_MS;
    await sleep(Math.min(Math.max(wait ?? 0, backoff), MAX_WAIT_MS));
  }
}
