import {
  APP_PERMISSIONS,
  MAX_APP_NAME,
  appManifest,
  appName,
  convertCode,
  manifestPage,
  newAppUrl,
  withBot,
} from './github-app-manifest.ts';
import { describe, expect, it } from './test/expect.ts';

const manifest = appManifest({
  name: 'example-agent',
  repoUrl: 'https://github.com/example/repo',
  redirectUrl: 'http://127.0.0.1:4567/callback',
});

describe('appManifest', () => {
  it('has the fields GitHub requires, with webhooks off', () => {
    expect(manifest).toEqual({
      name: 'example-agent',
      url: 'https://github.com/example/repo',
      public: false,
      redirect_url: 'http://127.0.0.1:4567/callback',
      hook_attributes: { url: 'https://github.com/example/repo', active: false },
      default_permissions: APP_PERMISSIONS,
    });
  });
});

describe('newAppUrl', () => {
  it('posts to the account, or to an organisation', () => {
    expect(newAppUrl()).toBe('https://github.com/settings/apps/new');
    expect(newAppUrl('example')).toBe(
      'https://github.com/organizations/example/settings/apps/new',
    );
  });
});

describe('manifestPage', () => {
  const page = manifestPage(manifest, newAppUrl());

  it('sets the manifest from the script, not a value attribute', () => {
    expect(page).toContain('<input type="hidden" name="manifest" id="manifest">');
    expect(page).not.toContain('value="{');
  });

  it('embeds the manifest so the script sets exactly that JSON', () => {
    const literal = /\.value = (".*");<\/script>/.exec(page)?.[1];
    expect(JSON.parse(JSON.parse(literal!) as string)).toEqual(manifest);
  });

  it('cannot be broken out of by a name', () => {
    const odd = manifestPage(
      { ...manifest, name: '</script><b>"x"' },
      newAppUrl(),
    );
    expect(odd).not.toContain('</script><b>');
  });
});

describe('convertCode', () => {
  it('exchanges the code for the App', async () => {
    const calls: string[] = [];
    const app = await convertCode('abc123', ((url: string) => {
      calls.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: 7, slug: 'example-agent', pem: 'KEY', html_url: 'u' }),
        ),
      );
    }) as typeof fetch);
    expect(calls).toEqual([
      'https://api.github.com/app-manifests/abc123/conversions',
    ]);
    expect(app.id).toBe(7);
  });

  it('refuses a code that is not one', async () => {
    await expect(convertCode('../x')).rejects.toThrow('not a manifest code');
  });

  it('says why GitHub refused it', async () => {
    const refused = (() =>
      Promise.resolve(new Response('expired', { status: 404 }))) as typeof fetch;
    await expect(convertCode('abc', refused)).rejects.toThrow('(404): expired');
  });
});

describe('appName', () => {
  it('is <owner>-<repo>-agent when that fits', () => {
    expect(appName('ExampleUser', 'widget-shop')).toBe(
      'exampleuser-widget-shop-agent',
    );
  });

  it('swaps the owner for a hash when it would be too long, and stays unique', () => {
    const a = appName('a-very-long-organisation', 'platform');
    const b = appName('another-long-organisation', 'platform');
    expect(a).toMatch(/^platform-agent-[0-9a-f]{6}$/);
    expect(a === b).toBe(false);
  });

  it('shortens a long repo name to fit', () => {
    const name = appName('example', 'an-extraordinarily-long-repository-name');
    expect(name.length <= MAX_APP_NAME).toBe(true);
    expect(name).toMatch(/^an-extraordinarily-[a-z-]*-agent-[0-9a-f]{6}$|^an-extraordinarily[a-z-]*-agent-[0-9a-f]{6}$/);
  });

  it('only uses what GitHub keeps in a slug', () => {
    expect(appName('Ex.Ample', 'My_Repo')).toBe('ex-ample-my-repo-agent');
  });
});

describe('withBot', () => {
  it('sets bot to the slug and keeps everything else', () => {
    const text = '{"bot": "old", "verify": "npm test", "retros": true}';
    expect(JSON.parse(withBot(text, 'new-agent'))).toEqual({
      bot: 'new-agent',
      verify: 'npm test',
      retros: true,
    });
  });
});
