import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAppJwt,
  getCachedToken,
  mintInstallationToken,
  readAppCredentials,
  repositoryFromRemote,
} from './github-app-token.ts';
import { describe, expect, fn, it } from './test/expect.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const credentials = {
  appId: '123',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

const decode = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;

describe('createAppJwt', () => {
  it('signs an RS256 JWT issued by the App', () => {
    const now = Date.UTC(2026, 0, 1);
    const [header, payload, signature] = createAppJwt(credentials, now).split(
      '.',
    );

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(payload)).toEqual({
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
      iss: '123',
    });
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, signature ?? '', 'base64url');
    expect(valid).toBe(true);
  });
});

describe('readAppCredentials', () => {
  it('reads an inline key with escaped newlines', () => {
    expect(
      readAppCredentials({
        GITHUB_AGENT_APP_ID: '1',
        GITHUB_AGENT_APP_PRIVATE_KEY: 'a\\nb',
      }),
    ).toEqual({
      appId: '1',
      privateKey: 'a\nb',
    });
  });

  it('reads a key from a file', () => {
    const keyPath = join(mkdtempSync(join(tmpdir(), 'harness-')), 'key.pem');
    writeFileSync(keyPath, 'pem');
    expect(
      readAppCredentials({
        GITHUB_AGENT_APP_ID: '1',
        GITHUB_AGENT_APP_PRIVATE_KEY_PATH: keyPath,
      }),
    ).toEqual({ appId: '1', privateKey: 'pem' });
  });

  it('returns undefined without an App ID or key', () => {
    expect(readAppCredentials({ GITHUB_AGENT_APP_ID: '1' })).toBeUndefined();
    expect(
      readAppCredentials({ GITHUB_AGENT_APP_PRIVATE_KEY: 'pem' }),
    ).toBeUndefined();
  });
});

describe('repositoryFromRemote', () => {
  it.each([
    ['https://github.com/example/repo.git', 'example/repo'],
    ['git@github.com:example/repo.git', 'example/repo'],
    ['http://local_proxy@127.0.0.1:1234/git/example/repo', 'example/repo'],
  ])('parses %s', (url, repository) => {
    expect(repositoryFromRemote(url)).toBe(repository);
  });
});

describe('mintInstallationToken', () => {
  it('looks up the installation and mints a token scoped to the repo', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/installation')
        ? { id: 42 }
        : { token: 'ghs_abc', expires_at: '2026-01-01T01:00:00Z' };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as typeof fetch;

    await expect(
      mintInstallationToken(credentials, 'example/repo', fakeFetch),
    ).resolves.toEqual({
      token: 'ghs_abc',
      expiresAt: '2026-01-01T01:00:00Z',
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.github.com/repos/example/repo/installation',
      'https://api.github.com/app/installations/42/access_tokens',
    ]);
    expect(calls[1]?.init.body).toBe(
      JSON.stringify({ repositories: ['repo'] }),
    );
  });

  it('fails when the App is not installed', async () => {
    const fakeFetch = (() =>
      Promise.resolve(
        new Response('Not Found', { status: 404 }),
      )) as typeof fetch;
    await expect(
      mintInstallationToken(credentials, 'example/repo', fakeFetch),
    ).rejects.toThrow(/failed with 404/);
  });
});

describe('getCachedToken', () => {
  const now = Date.UTC(2026, 0, 1);
  const cachePath = () =>
    join(mkdtempSync(join(tmpdir(), 'harness-')), 'gh-token.json');
  const expiresIn = (minutes: number) =>
    new Date(now + minutes * 60_000).toISOString();

  it('mints and caches a token readable only by its owner', async () => {
    const path = cachePath();
    const mint = fn(() =>
      Promise.resolve({ token: 'new', expiresAt: expiresIn(60) }),
    );

    await expect(getCachedToken(path, mint, now)).resolves.toBe('new');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      token: 'new',
      expiresAt: expiresIn(60),
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('reuses a cached token with time left', async () => {
    const path = cachePath();
    writeFileSync(
      path,
      JSON.stringify({ token: 'cached', expiresAt: expiresIn(30) }),
    );
    const mint = fn();

    await expect(getCachedToken(path, mint, now)).resolves.toBe('cached');
    expect(mint).not.toHaveBeenCalled();
  });

  it('refreshes a token that is about to expire', async () => {
    const path = cachePath();
    writeFileSync(
      path,
      JSON.stringify({ token: 'old', expiresAt: expiresIn(5) }),
    );
    const mint = () =>
      Promise.resolve({ token: 'new', expiresAt: expiresIn(60) });

    await expect(getCachedToken(path, mint, now)).resolves.toBe('new');
  });
});
