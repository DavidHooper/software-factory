import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findConfig, loadConfig } from './config.ts';
import { harnessFiles } from './manifest.ts';
import { describe, expect, it } from './test/expect.ts';
import { REPO_ROOT } from './test/paths.ts';

/** Every Markdown file under `dir`, recursively. */
function markdown(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath, entry.name));
}

const docs = [
  ...markdown(join(REPO_ROOT, 'docs/agents')),
  ...markdown(join(REPO_ROOT, '.agents/skills')),
].map((file) => ({
  file: relative(REPO_ROOT, file),
  text: readFileSync(file, 'utf8'),
}));

describe('agent docs and skills', () => {
  it('have files to check', () => {
    expect(docs.some((d) => d.file === 'docs/agents/issue-tracker.md')).toBe(
      true,
    );
  });

  // `--paginate` follows GitHub's `Link` header, which points later pages at
  // `repositories/<id>/...`, a path the cloud proxy refuses (#123, #127).
  it.each(docs)(
    '$file never tells agents to run gh api --paginate',
    ({ text }) => {
      expect(text).not.toMatch(/gh api[^`\n]*--paginate/);
    },
  );
});

describe('harness files', () => {
  // Project-specific values live only in harness.config.json (config.ts), so
  // the harness works unchanged in another project.
  const project = loadConfig(findConfig(REPO_ROOT));
  // The repository's owner too, as the CI checkout's remote names it.
  const owner = /[/:]([^/:]+)\/[^/]+?(?:\.git)?$/.exec(
    execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim(),
  )?.[1];
  const values = [
    ...(owner ? [owner] : []),
    project.bot,
    ...Object.values(project.routines),
    ...Object.values(project.environments),
  ];
  const harness = harnessFiles(REPO_ROOT).filter((file) =>
    lstatSync(join(REPO_ROOT, file)).isFile(),
  );

  it.each(harness)('%s names no project-specific value', (file) => {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const value of values) {
      expect(text).not.toContain(value);
    }
  });
});
