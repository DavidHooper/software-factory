// Creating a project's GitHub App with GitHub's manifest flow
// (https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):
// the person's browser posts a manifest to GitHub, they click Create, GitHub
// redirects back with a code, and the code is exchanged for the App's ID, slug
// and private key. cli/create-app.ts runs it; INSTALL.md step 5 says when.

import { createHash } from 'node:crypto';

/** GitHub's limit on an App's name. */
export const MAX_APP_NAME = 34;

/**
 * A name for the project's App. App names are global across GitHub, so the
 * owner goes in to keep it unique: `<owner>-<repo>-agent`. When that's over
 * GitHub's 34 characters, a short hash of `<owner>/<repo>` stands in for the
 * owner, and the repo is shortened if it must be: `<repo>-agent-<hash>`.
 */
export function appName(owner: string, repo: string): string {
  const slug = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const full = `${slug(owner)}-${slug(repo)}-agent`;
  if (full.length <= MAX_APP_NAME) {
    return full;
  }
  const hash = createHash('sha256')
    .update(`${owner}/${repo}`.toLowerCase())
    .digest('hex')
    .slice(0, 6);
  const suffix = `-agent-${hash}`;
  const short = slug(repo)
    .slice(0, MAX_APP_NAME - suffix.length)
    .replace(/-$/, '');
  return `${short}${suffix}`;
}

/** Sets the config's `bot` to the App's slug, keeping the rest of the file. */
export function withBot(configText: string, slug: string): string {
  const parsed = JSON.parse(configText) as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, bot: slug }, null, 2)}\n`;
}

/** The repository permissions the harness's workflows and relay use. */
export const APP_PERMISSIONS = {
  contents: 'write',
  issues: 'write',
  pull_requests: 'write',
  checks: 'write',
  workflows: 'write',
  actions: 'read',
  statuses: 'read',
  metadata: 'read',
} as const;

export interface AppManifest {
  name: string;
  url: string;
  public: false;
  redirect_url: string;
  hook_attributes: { url: string; active: false };
  default_permissions: typeof APP_PERMISSIONS;
}

export function appManifest(opts: {
  name: string;
  repoUrl: string;
  redirectUrl: string;
}): AppManifest {
  return {
    name: opts.name,
    url: opts.repoUrl,
    public: false,
    redirect_url: opts.redirectUrl,
    // GitHub requires a webhook URL even with the webhook off (its error is
    // `"url" wasn't supplied`); inactive, it receives nothing.
    hook_attributes: { url: opts.repoUrl, active: false },
    default_permissions: APP_PERMISSIONS,
  };
}

/** Where the manifest is posted: a personal account's or an organisation's. */
export const newAppUrl = (org?: string): string =>
  org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : 'https://github.com/settings/apps/new';

/**
 * The page the person opens. The manifest is set by the script, never in the
 * input's `value` attribute: the JSON's quotes would end the attribute early,
 * and GitHub would answer `"url" wasn't supplied`. `<` is escaped so no value
 * can close the script tag.
 */
export function manifestPage(manifest: AppManifest, action: string): string {
  const json = JSON.stringify(JSON.stringify(manifest)).replaceAll(
    '<',
    '\\u003c',
  );
  return `<!doctype html>
<meta charset="utf-8">
<title>Create ${escapeHtml(manifest.name)}</title>
<body style="font-family: system-ui, sans-serif; max-width: 40em; margin: 3em auto">
<h1>Create the ${escapeHtml(manifest.name)} GitHub App</h1>
<p>GitHub will show the App with its permissions filled in. Check them, then click <b>Create GitHub App</b>.</p>
<form id="form" action="${escapeHtml(action)}" method="post">
<input type="hidden" name="manifest" id="manifest">
<button type="submit">Continue to GitHub</button>
</form>
<script>document.getElementById('manifest').value = ${json};</script>
</body>
`;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export interface CreatedApp {
  id: number;
  slug: string;
  pem: string;
  html_url: string;
}

/** Exchanges the redirect's code for the App (no auth: the code is the proof). */
export async function convertCode(
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<CreatedApp> {
  if (!/^[\w-]+$/.test(code)) {
    throw new Error(`not a manifest code: ${code}`);
  }
  const response = await fetcher(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub refused the code (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as CreatedApp;
}
