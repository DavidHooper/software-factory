import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readPages } from './github-pages.ts';
import { describe, expect, it } from './test/expect.ts';
import { HARNESS_DIR } from './test/paths.ts';

/** A `get` that serves `pages` in order and records the paths it was asked for. */
function pagesOf<P>(pages: P[]) {
  const asked: string[] = [];
  const get = (path: string): P => {
    asked.push(path);
    return pages[asked.length - 1] ?? pages.at(-1)!;
  };
  return { asked, get };
}

const full = (from: number) =>
  Array.from({ length: 100 }, (_, index) => from + index);

describe('readPages', () => {
  it('asks for page 1, 2, … on the repos path and stops after a short page', () => {
    const { asked, get } = pagesOf([full(0), full(100), [200, 201]]);
    const items = readPages(
      'repos/{owner}/{repo}/pulls/62/comments?per_page=100',
      get,
    );
    expect(asked).toEqual([
      'repos/{owner}/{repo}/pulls/62/comments?per_page=100&page=1',
      'repos/{owner}/{repo}/pulls/62/comments?per_page=100&page=2',
      'repos/{owner}/{repo}/pulls/62/comments?per_page=100&page=3',
    ]);
    expect(items).toHaveLength(202);
    expect(items.at(-1)).toBe(201);
  });

  it('stops at an empty page after full ones', () => {
    const { asked, get } = pagesOf([full(0), []]);
    expect(readPages('repos/o/r/issues/1/comments', get)).toHaveLength(100);
    expect(asked).toEqual([
      'repos/o/r/issues/1/comments?per_page=100&page=1',
      'repos/o/r/issues/1/comments?per_page=100&page=2',
    ]);
  });

  it('keeps the other query parameters and sets per_page itself', () => {
    const { asked, get } = pagesOf([[1]]);
    readPages(
      'repos/o/r/issues?state=closed&labels=needs-human&per_page=30',
      get,
    );
    expect(asked).toEqual([
      'repos/o/r/issues?state=closed&labels=needs-human&per_page=100&page=1',
    ]);
  });

  it('reads the items out of object pages, like check runs', () => {
    const { asked, get } = pagesOf([
      { check_runs: full(0) },
      { check_runs: [100] },
    ]);
    const runs = readPages(
      'repos/o/r/commits/abc/check-runs',
      get,
      (page) => page.check_runs,
    );
    expect(runs).toHaveLength(101);
    expect(asked).toHaveLength(2);
  });
});

const SRC = join(HARNESS_DIR, 'src');

describe('harness code', () => {
  /** Every non-test TypeScript file under `src`, with its text. */
  const sources = readdirSync(SRC, { withFileTypes: true, recursive: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .map((file) => ({
      file: relative(SRC, file),
      text: readFileSync(file, 'utf8'),
    }));

  it('has files to check', () => {
    expect(sources.some((s) => s.file === join('cli', 'dispatch.ts'))).toBe(
      true,
    );
  });

  // Only GraphQL reads may follow `--paginate`: they page by cursor, not by
  // the Link header (#131).
  it('passes --paginate only to GraphQL reads', () => {
    const rest = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/(\S+)\s*['"`]--paginate['"`]/g)]
        .filter((match) => !/^['"`]graphql['"`],$/.test(match[1] ?? ''))
        .map(() => file),
    );
    expect(rest).toEqual([]);
  });
});
