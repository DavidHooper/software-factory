// Paths the tests read from, found from this file's location rather than the
// cwd, so the tests pass however `node --test` is run.
import { resolve } from 'node:path';

/** The harness folder. */
export const HARNESS_DIR = resolve(import.meta.dirname, '../..');

/** The repository the harness is installed in. */
export const REPO_ROOT = resolve(HARNESS_DIR, '..');
