import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { covers, harnessFiles, manifest, parseManifest } from './manifest.ts';
import { describe, expect, it } from './test/expect.ts';
import { REPO_ROOT } from './test/paths.ts';

describe('parseManifest', () => {
  it('reads the listed paths', () => {
    expect(parseManifest('{"paths": ["a/", "b.md"]}')).toEqual(['a/', 'b.md']);
  });

  it.each([
    ['{', 'manifest.json'],
    ['{}', '`paths` must be a list of paths, not undefined'],
    ['{"paths": [1]}', '`paths` must be a list of paths, not [1]'],
    ['{"paths": ["/abs"]}', 'relative to the repository root, not "/abs"'],
    ['{"paths": ["a/../b"]}', 'relative to the repository root, not "a/../b"'],
    ['{"paths": ["./"]}', 'relative to the repository root, not "./"'],
    ['{"paths": [""]}', 'relative to the repository root, not ""'],
  ])('refuses %s', (text, error) => {
    expect(() => parseManifest(text)).toThrow(error);
  });
});

describe('covers', () => {
  const paths = ['docs/agents/', '.claude/settings.json'];

  it.each([
    ['docs/agents/labels.md', true],
    ['docs/agents/sub/x.md', true],
    ['.claude/settings.json', true],
    ['docs/agents', false],
    ['docs/agentsx/a.md', false],
    ['.claude/settings.local.json', false],
  ])('%s → %s', (file, covered) => {
    expect(covers(paths, file)).toBe(covered);
  });
});

describe('manifest.json', () => {
  const paths = manifest();

  it('lists the harness folder itself', () => {
    expect(paths).toContain('.harness/');
  });

  it.each(paths)('%s exists', (path) => {
    const stat = lstatSync(join(REPO_ROOT, path));
    expect(path.endsWith('/') ? stat.isDirectory() : !stat.isDirectory()).toBe(
      true,
    );
  });

  // The harness's files live in these places; a project's files don't. A
  // workflow is the harness's when it runs harness code.
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const owned = tracked.filter(
    (file) =>
      ['.harness/', '.agents/', '.claude/', 'docs/agents/'].some((dir) =>
        file.startsWith(dir),
      ) ||
      (file.startsWith('.github/workflows/') &&
        readFileSync(join(REPO_ROOT, file), 'utf8').includes('.harness/')),
  );

  it('has harness files to check', () => {
    expect(owned).toContain('.github/workflows/agent-relay.yml');
  });

  it.each(owned)('lists %s', (file) => {
    expect(covers(paths, file)).toBe(true);
  });

  it('lists no project file', () => {
    expect(covers(paths, '.github/workflows/verify.yml')).toBe(false);
    expect(covers(paths, 'harness.config.json')).toBe(false);
    expect(covers(paths, 'AGENTS.md')).toBe(false);
  });

  it('expands to the files it covers', () => {
    const files = harnessFiles(REPO_ROOT);
    expect(files).toContain('.harness/manifest.json');
    expect(files).toContain('.claude/skills');
    expect(files).toContain('docs/agents/labels.md');
    expect(files.every((file) => covers(paths, file))).toBe(true);
  });
});
