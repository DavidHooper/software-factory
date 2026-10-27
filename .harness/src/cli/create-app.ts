// Creates the project's GitHub App with GitHub's manifest flow, run on the
// person's machine during an install (INSTALL.md step 5). It serves a page on
// 127.0.0.1, opens the browser at it, and waits: the person clicks Continue,
// then Create GitHub App on GitHub, which redirects back here with a code.
// The code is exchanged for the App, the private key is written to KEY_OUT
// (mode 600, outside the repository), and one JSON line is printed:
// {"id", "slug", "keyPath", "installUrl"}.
//
// Usage: node .harness/src/cli/create-app.ts <owner>/<repo> <key-out> [--org]
//   --org   the owner is an organisation (the App is created there)
// The App's name is harness.config.json's `bot`.
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { config } from '../config.ts';
import {
  appManifest,
  convertCode,
  escapeHtml,
  manifestPage,
  newAppUrl,
} from '../github-app-manifest.ts';

const [repo, keyOut] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const org = process.argv.includes('--org');
if (!repo?.includes('/') || !keyOut) {
  console.error(
    'Usage: node .harness/src/cli/create-app.ts <owner>/<repo> <key-out> [--org]',
  );
  process.exit(2);
}
const owner = repo.split('/')[0]!;
const keyPath = resolve(keyOut);

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'explorer'
        : 'xdg-open';
  execFile(command, [url], () => {});
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const port = (server.address() as { port: number }).port;
  if (url.pathname === '/') {
    const manifest = appManifest({
      name: config.bot,
      repoUrl: `https://github.com/${repo}`,
      redirectUrl: `http://127.0.0.1:${port}/callback`,
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(manifestPage(manifest, newAppUrl(org ? owner : undefined)));
    return;
  }
  const code = url.searchParams.get('code');
  if (url.pathname !== '/callback' || !code) {
    res.writeHead(404).end();
    return;
  }
  convertCode(code).then(
    (app) => {
      writeFileSync(keyPath, app.pem, { mode: 0o600 });
      const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family: system-ui, sans-serif; max-width: 40em; margin: 3em auto">` +
          `<h1>${escapeHtml(app.slug)} is created</h1>` +
          `<p>Last step: <a href="${escapeHtml(installUrl)}">install it</a>, choose <b>Only select repositories</b>, and pick ${escapeHtml(repo)}.</p>`,
      );
      console.log(JSON.stringify({ id: app.id, slug: app.slug, keyPath, installUrl }));
      server.close();
    },
    (error: unknown) => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error));
      console.error(String(error));
      process.exitCode = 1;
      server.close();
    },
  );
});

server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as { port: number }).port;
  const page = `http://127.0.0.1:${port}/`;
  console.error(`Open ${page} if the browser didn't open, then click Continue.`);
  openBrowser(page);
});
