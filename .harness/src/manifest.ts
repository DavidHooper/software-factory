// The harness manifest (manifest.json, next to src/) lists every path the
// harness owns, relative to the repository root: a path ending in `/` is a
// folder and everything in it, any other names one file or link. Installing
// the harness into a project copies exactly these; everything else belongs to
// the project (docs/agents/harness.md).
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const MANIFEST = join(import.meta.dirname, '..', 'manifest.json');

/** Reads and checks a manifest's text: its list of paths. */
export function parseManifest(
  text: string,
  source = 'manifest.json',
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} isn't valid JSON`, { cause: error });
  }
  const paths = (parsed as { paths?: unknown } | null)?.paths;
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
    throw new Error(
      `${source}: \`paths\` must be a list of paths, not ${JSON.stringify(paths)}`,
    );
  }
  for (const path of paths) {
    if (
      isAbsolute(path) ||
      path.split('/').some((part) => part === '..' || part === '.') ||
      path.replace(/\/$/, '') === ''
    ) {
      throw new Error(
        `${source}: paths must be relative to the repository root, not ${JSON.stringify(path)}`,
      );
    }
  }
  return paths;
}

/** Whether a manifest path names a folder (and everything in it). */
const isFolder = (path: string): boolean => path.endsWith('/');

/** The harness's manifest. */
export const manifest = (): string[] =>
  parseManifest(readFileSync(MANIFEST, 'utf8'), MANIFEST);

/** Whether `file` (relative to the repository root) is one the manifest lists. */
export const covers = (paths: readonly string[], file: string): boolean =>
  paths.some((path) =>
    path.endsWith('/') ? file.startsWith(path) : file === path,
  );

/** Every file and link the manifest covers in the repository at `root`. */
export function harnessFiles(root: string, paths = manifest()): string[] {
  return paths.flatMap((path) =>
    isFolder(path)
      ? readdirSync(join(root, path), { withFileTypes: true, recursive: true })
          .filter((entry) => !entry.isDirectory())
          .map((entry) => relative(root, join(entry.parentPath, entry.name)))
      : [path],
  );
}
