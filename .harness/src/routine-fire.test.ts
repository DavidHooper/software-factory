import { fireRoutine } from './routine-fire.ts';
import { describe, expect, it } from './test/expect.ts';

const url = 'https://api.anthropic.com/v1/claude_code/routines/r1/fire';
const session = 'https://claude.ai/code/cse_abc123';

const reply = (status: number, body: unknown, headers = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers,
  });

/** A fake fetch answering each call with the next reply, and the requests it got. */
function fakeFetch(...replies: (Response | Error | DOMException)[]) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (input: string, init?: RequestInit) => {
    requests.push({ url: input, init });
    const next = replies.shift();
    if (!next) {
      throw new Error('no more replies');
    }
    return next instanceof Response
      ? Promise.resolve(next)
      : Promise.reject(next);
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

/** A sleep that records each wait and returns at once. */
function fakeSleep() {
  const waits: number[] = [];
  return {
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

describe('fireRoutine', () => {
  it('fires the routine with the payload as its text, and returns the session', async () => {
    const { fetch, requests } = fakeFetch(
      reply(200, { claude_code_session_url: session }),
    );
    const { sleep, waits } = fakeSleep();

    const result = await fireRoutine(url, 'token', '{"skill":"implement"}', {
      fetch,
      sleep,
    });

    expect(result).toEqual({ ok: true, sessionUrl: session, attempts: 1 });
    expect(waits).toEqual([]);
    expect(requests).toHaveLength(1);
    const init = requests[0]?.init;
    expect(requests[0]?.url).toBe(url);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      text: '{"skill":"implement"}',
    });
  });

  it('retries a 429 with backoff until it succeeds', async () => {
    const { fetch, requests } = fakeFetch(
      reply(429, 'rate limited'),
      reply(429, 'rate limited'),
      reply(200, { claude_code_session_url: session }),
    );
    const { sleep, waits } = fakeSleep();

    const result = await fireRoutine(url, 'token', 'x', { fetch, sleep });

    expect(result).toEqual({ ok: true, sessionUrl: session, attempts: 3 });
    expect(requests).toHaveLength(3);
    expect(waits).toEqual([30_000, 60_000]);
  });

  it('retries a 5xx and a network error too', async () => {
    const { fetch } = fakeFetch(
      reply(503, 'unavailable'),
      new TypeError('fetch failed'),
      reply(200, { claude_code_session_url: session }),
    );
    const { sleep } = fakeSleep();

    expect(await fireRoutine(url, 'token', 'x', { fetch, sleep })).toEqual({
      ok: true,
      sessionUrl: session,
      attempts: 3,
    });
  });

  it('waits as long as Retry-After asks, in seconds or as a date', async () => {
    const now = Date.parse('2026-10-23T03:00:00Z');
    const { fetch } = fakeFetch(
      reply(429, '', { 'Retry-After': '45' }),
      reply(429, '', { 'Retry-After': 'Fri, 23 Oct 2026 03:01:30 GMT' }),
      reply(200, {}),
    );
    const { sleep, waits } = fakeSleep();

    await fireRoutine(url, 'token', 'x', { fetch, sleep, now: () => now });

    expect(waits).toEqual([45_000, 90_000]);
  });

  it('never waits less than the backoff, whatever Retry-After asks', async () => {
    const { fetch } = fakeFetch(
      reply(429, '', { 'Retry-After': '1' }),
      reply(429, '', { 'Retry-After': '0' }),
      reply(429, '', { 'Retry-After': '1' }),
      reply(200, {}),
    );
    const { sleep, waits } = fakeSleep();

    await fireRoutine(url, 'token', 'x', { fetch, sleep });

    expect(waits).toEqual([30_000, 60_000, 120_000]);
  });

  it("caps a Retry-After that wouldn't fit the job", async () => {
    const { fetch } = fakeFetch(
      reply(429, '', { 'Retry-After': '3600' }),
      reply(200, {}),
    );
    const { sleep, waits } = fakeSleep();

    await fireRoutine(url, 'token', 'x', { fetch, sleep });

    expect(waits).toEqual([120_000]);
  });

  it('gives up after four attempts, with the last error', async () => {
    const { fetch, requests } = fakeFetch(
      reply(429, 'one'),
      reply(429, 'two'),
      reply(502, 'three'),
      reply(429, 'four'),
    );
    const { sleep, waits } = fakeSleep();

    const result = await fireRoutine(url, 'token', 'x', { fetch, sleep });

    expect(result).toEqual({
      ok: false,
      error: 'HTTP 429: four',
      attempts: 4,
    });
    expect(requests).toHaveLength(4);
    expect(waits).toEqual([30_000, 60_000, 120_000]);
  });

  it("doesn't retry a request the API refused", async () => {
    const { fetch, requests } = fakeFetch(reply(401, 'bad token'));
    const { sleep, waits } = fakeSleep();

    expect(await fireRoutine(url, 'token', 'x', { fetch, sleep })).toEqual({
      ok: false,
      error: 'HTTP 401: bad token',
      attempts: 1,
    });
    expect(requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("doesn't retry a request that timed out: the routine may have started a run", async () => {
    const timeout = new DOMException(
      'The operation timed out.',
      'TimeoutError',
    );
    const { fetch, requests } = fakeFetch(timeout);
    const { sleep } = fakeSleep();

    expect(await fireRoutine(url, 'token', 'x', { fetch, sleep })).toEqual({
      ok: false,
      error: 'The request timed out',
      attempts: 1,
    });
    expect(requests).toHaveLength(1);
  });

  it("doesn't retry a gateway timeout: the routine may have started a run", async () => {
    const { fetch, requests } = fakeFetch(reply(504, 'gateway timeout'));
    const { sleep } = fakeSleep();

    expect(await fireRoutine(url, 'token', 'x', { fetch, sleep })).toEqual({
      ok: false,
      error: 'HTTP 504: gateway timeout',
      attempts: 1,
    });
    expect(requests).toHaveLength(1);
  });

  it("keeps the routine's URL out of a network error", async () => {
    const { fetch } = fakeFetch(
      ...Array.from(
        { length: 4 },
        () => new TypeError(`Failed to parse URL from ${url}`),
      ),
    );
    const { sleep } = fakeSleep();

    expect(await fireRoutine(url, 'token', 'x', { fetch, sleep })).toEqual({
      ok: false,
      error: 'The request failed (TypeError)',
      attempts: 4,
    });
  });

  it("puts the response body on one short line, so it can't inject workflow commands", async () => {
    const body = `refused\n::add-mask::x\r\n${'y'.repeat(1000)}`;
    const { fetch } = fakeFetch(reply(400, body));
    const { sleep } = fakeSleep();

    const result = await fireRoutine(url, 'token', 'x', { fetch, sleep });

    expect(result.ok).toBe(false);
    const error = result.ok ? '' : result.error;
    expect(error).not.toMatch(/[\r\n]/);
    expect(error.startsWith('HTTP 400: refused ::add-mask::x yyy')).toBe(true);
    expect(error).toHaveLength('HTTP 400: '.length + 300 + 1);
    expect(error.endsWith('…')).toBe(true);
  });
});
