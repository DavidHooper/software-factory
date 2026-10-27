// Creating a project's GitHub App with GitHub's manifest flow
// (https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):
// the person's browser posts a manifest to GitHub, they click Create, GitHub
// redirects back with a code, and the code is exchanged for the App's ID, slug
// and private key. cli/create-app.ts runs it; INSTALL.md step 5 says when.

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
