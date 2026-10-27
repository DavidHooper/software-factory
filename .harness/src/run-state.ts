import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Per-run state kept in `.agent-run/` (gitignored) at the repo root, shared
 * by the hooks, the skills and the harness CLIs.
 */
export function runPaths(repoRoot: string) {
  const dir = join(repoRoot, '.agent-run');
  return {
    dir,
    /** One JSON line per human message in the run, read by `/retro`. */
    interjections: join(dir, 'interjections.jsonl'),
    /** The cached bot installation token. */
    ghToken: join(dir, 'gh-token.json'),
  };
}

/** Runs git and returns its trimmed output, or `undefined` if it fails. */
export function git(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}
