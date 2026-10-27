import { createSign } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Mints short-lived installation tokens for the agent GitHub App, so agents
 * act as the bot rather than as a human (see docs/agents/issue-tracker.md).
 */

export interface AppCredentials {
  appId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  /** ISO 8601 */
  expiresAt: string;
}

/**
 * Handed to `gh` when no token can be minted, so it fails with an auth error
 * instead of silently falling back to another identity.
 */
export const FAILED_TOKEN = 'agent-bot-token-unavailable';

const API = 'https://api.github.com';

/** Reads the App ID and private key (inline, or from a file) from the environment. */
export function readAppCredentials(
  env: NodeJS.ProcessEnv,
): AppCredentials | undefined {
  const appId = env.GITHUB_AGENT_APP_ID;
  const inlineKey = env.GITHUB_AGENT_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const keyPath = env.GITHUB_AGENT_APP_PRIVATE_KEY_PATH;
  if (!appId || (!inlineKey && !keyPath)) {
    return undefined;
  }
  return {
    appId,
    privateKey: inlineKey || readFileSync(keyPath ?? '', 'utf8'),
  };
}

/** Extracts `owner/repo` from a GitHub (or proxied) remote URL. */
export function repositoryFromRemote(url: string): string | undefined {
  const match = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export function createAppJwt(
  credentials: AppCredentials,
  now = Date.now(),
): string {
  const seconds = Math.floor(now / 1000);
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  // Backdated a minute to allow for clock drift; GitHub allows at most 10 minutes.
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: seconds - 60,
    exp: seconds + 540,
    iss: credentials.appId,
  })}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

export async function mintInstallationToken(
  credentials: AppCredentials,
  repository: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstallationToken> {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${createAppJwt(credentials)}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const installation = await fetchJson(
    fetchImpl,
    `${API}/repos/${repository}/installation`,
    { headers },
  );
  const installationId = (installation as { id?: unknown }).id;
  if (typeof installationId !== 'number') {
    throw new Error(`the agent GitHub App isn't installed on ${repository}`);
  }

  // Scope the token to this repository only.
  const repoName = repository.split('/')[1];
  const created = await fetchJson(
    fetchImpl,
    `${API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ repositories: [repoName] }),
    },
  );
  const { token, expires_at: expiresAt } = created as {
    token?: unknown;
    expires_at?: unknown;
  };
  if (typeof token !== 'string' || typeof expiresAt !== 'string') {
    throw new Error('GitHub returned no installation token');
  }
  return { token, expiresAt };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

/** Tokens are refreshed once they have less than this long left. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/**
 * Returns a cached token while it has time left, otherwise mints and caches a
 * new one. The cache file is only readable by its owner.
 */
export async function getCachedToken(
  cachePath: string,
  mint: () => Promise<InstallationToken>,
  now = Date.now(),
): Promise<string> {
  try {
    const cached = JSON.parse(
      readFileSync(cachePath, 'utf8'),
    ) as Partial<InstallationToken>;
    if (
      typeof cached.token === 'string' &&
      typeof cached.expiresAt === 'string' &&
      Date.parse(cached.expiresAt) - now > REFRESH_MARGIN_MS
    ) {
      return cached.token;
    }
  } catch {
    // No usable cache, so mint a new token.
  }

  const minted = await mint();
  const tempPath = `${cachePath}.${process.pid}`;
  writeFileSync(tempPath, JSON.stringify(minted), { mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, cachePath);
  return minted.token;
}
