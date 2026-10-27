/**
 * Helpers for `cli/github-write.ts`: reading a write from its arguments,
 * running `gh` from the repository root, and reading back what a relay run
 * did.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RESULT_PREFIX, WRITE_METHODS, type RelayWrite } from './relay.ts';

/** The repository root, from this file's own location, not the cwd. */
export const REPO_ROOT = resolve(import.meta.dirname, '../..');

export type Gh = (args: string[], input?: unknown) => string;

/**
 * Runs `gh api` from the repository root, so `{owner}/{repo}` resolves the
 * same whichever directory the caller is in (an agent's scratchpad, say).
 */
export function ghApi(exec: typeof execFileSync = execFileSync): Gh {
  return (args, input) =>
    exec('gh', ['api', ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input: input === undefined ? undefined : JSON.stringify(input),
      stdio: ['pipe', 'pipe', 'inherit'],
    });
}

export interface RelayRun {
  id: number;
  conclusion: string | null;
  html_url: string;
}

interface Annotation {
  annotation_level: string;
  message: string;
}

const WRITE_USAGE = `Usage: github-write.ts <${WRITE_METHODS.join('|')}> <path> [--input <file.json>] [-f key=value]... [-F key=value|key=@file]...`;

/**
 * A `-F` value, typed as `gh api` types it: `true`, `false`, `null` and
 * integers become JSON values, and `@file` reads the file's text.
 */
function typedValue(value: string, read: (path: string) => string): unknown {
  if (value.startsWith('@')) {
    return read(value.slice(1));
  }
  if (value === 'true' || value === 'false' || value === 'null') {
    return JSON.parse(value) as unknown;
  }
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

/**
 * The write `github-write` makes, from its arguments: a method, a REST path
 * with `{owner}/{repo}` filled in from `repo`, and a JSON body built from
 * `gh api`-style fields (`-f`, `-F`, `key[]` for a list) or read whole from
 * `--input`.
 */
export function parseWriteArgs(
  args: readonly string[],
  repo: string,
  read: (path: string) => string,
): RelayWrite {
  const usage = () => new Error(`Got \`${args.join(' ')}\`. ${WRITE_USAGE}`);
  const [rawMethod, path, ...rest] = args;
  const method = rawMethod?.toUpperCase();
  if (
    !method ||
    !(WRITE_METHODS as readonly string[]).includes(method) ||
    !path
  ) {
    throw usage();
  }
  const fields: Record<string, unknown> = {};
  let input: RelayWrite['body'] | undefined;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined) {
      throw usage();
    }
    if (flag === '--input') {
      input = JSON.parse(read(value)) as RelayWrite['body'];
      continue;
    }
    if (flag !== '-f' && flag !== '-F') {
      throw usage();
    }
    const at = value.indexOf('=');
    if (at < 1) {
      throw new Error(`${flag} takes key=value (got ${value})`);
    }
    const key = value.slice(0, at);
    const raw = value.slice(at + 1);
    const typed = flag === '-F' ? typedValue(raw, read) : raw;
    if (key.endsWith('[]')) {
      const list = key.slice(0, -2);
      fields[list] = [
        ...((fields[list] as unknown[] | undefined) ?? []),
        typed,
      ];
    } else {
      fields[key] = typed;
    }
  }
  if (input !== undefined && Object.keys(fields).length > 0) {
    throw new Error('Send the body with --input or with fields, not both');
  }
  const body = input ?? (Object.keys(fields).length > 0 ? fields : undefined);
  return {
    method: method as RelayWrite['method'],
    path: path.replaceAll('{owner}/{repo}', repo),
    ...(body === undefined ? {} : { body }),
  };
}

/** The annotation levels `::error::` and `::warning::` make, as they're shown. */
const LEVELS: Partial<Record<string, string>> = {
  failure: 'error',
  warning: 'warning',
};

/** GitHub's own annotation on a failed step, which says nothing about why. */
const EXIT_CODE = /^Process completed with exit code \d+\.$/;

/**
 * What a failed relay run's error says: the `::error::` and `::warning::`
 * messages from its failed jobs' annotations (where the relay says why it
 * refused), then the run URL. With none to read, just the run URL and how to
 * read its log.
 */
export function relayFailure(gh: Gh, run: RelayRun): string {
  const ended =
    run.conclusion === 'failure' || run.conclusion === null
      ? 'failed'
      : `ended ${run.conclusion}`;
  const messages = annotationMessages(gh, run.id);
  if (messages.length === 0) {
    return `The relay run ${ended}: ${run.html_url}. Its log says why: gh api repos/{owner}/{repo}/actions/runs/${run.id}/logs`;
  }
  return [
    `The relay run ${ended}:`,
    ...messages.map((message) => `  ${message.replaceAll('\n', '\n    ')}`),
    `Run: ${run.html_url}`,
  ].join('\n');
}

/** The annotations of a run's jobs that `keep` keeps; throws if they can't be read. */
function annotations(
  gh: Gh,
  runId: number,
  keep: (job: { conclusion: string | null }) => boolean,
): Annotation[] {
  const { jobs } = JSON.parse(
    gh([`repos/{owner}/{repo}/actions/runs/${runId}/jobs`]),
  ) as { jobs: { id: number; conclusion: string | null }[] };
  return jobs
    .filter(keep)
    .flatMap(
      (job) =>
        JSON.parse(
          gh([`repos/{owner}/{repo}/check-runs/${job.id}/annotations`]),
        ) as Annotation[],
    );
}

/** A run's error and warning annotations, or none if they can't be read. */
function annotationMessages(gh: Gh, runId: number): string[] {
  try {
    return annotations(
      gh,
      runId,
      (job) => job.conclusion !== 'success',
    ).flatMap(({ annotation_level: level, message }) =>
      LEVELS[level] && !EXIT_CODE.test(message)
        ? [`${LEVELS[level]}: ${message}`]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * What a relay run's write returned (`writeSummary` in relay.ts), read back
 * from the notice the relay leaves, or nothing if it can't be read.
 */
export function relayResult(gh: Gh, run: RelayRun): Record<string, unknown> {
  try {
    const notice = annotations(gh, run.id, () => true).find(
      (a) =>
        a.annotation_level === 'notice' && a.message.startsWith(RESULT_PREFIX),
    );
    const result = JSON.parse(
      notice?.message.slice(RESULT_PREFIX.length) ?? '{}',
    ) as unknown;
    return typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
