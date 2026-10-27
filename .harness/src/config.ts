/**
 * The project's harness config: every value that differs between projects
 * using the harness. It lives in `harness.config.json` at the project's root,
 * outside the harness folder, so the project owns it and a harness upgrade
 * never overwrites it. Values GitHub provides (the repository, its default
 * branch) aren't in it: the harness reads those from GitHub.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CONFIG_FILE = 'harness.config.json';

export interface HarnessConfig {
  /** The agent GitHub App's slug; its login is `<bot>[bot]`. */
  bot: string;
  /** The cloud routines' names: one for coding runs, one for the harness supervisor. */
  routines: { coding: string; supervisor: string };
  /** The cloud environments those routines run in. */
  environments: { coding: string; supervisor: string };
  /** The command that checks the whole project, run from its root. */
  verify: string;
  /** Whether runs post retros and the weekly harness retro keeps a scorecard. Off unless set. */
  retros: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses and checks the config file's text; `source` names it in errors. */
export function parseConfig(text: string, source: string): HarnessConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} isn't valid JSON`, { cause: error });
  }
  const fail = (key: string, what: string, value: unknown): never => {
    throw new Error(
      `${source}: \`${key}\` must be ${what}, not ${JSON.stringify(value) ?? 'missing'}`,
    );
  };
  const root = isRecord(data) ? data : fail('(root)', 'an object', data);
  const str = (value: unknown, key: string): string =>
    typeof value === 'string' && value.trim() !== ''
      ? value
      : fail(key, 'a non-empty string', value);
  const pair = (key: 'routines' | 'environments') => {
    const value = isRecord(root[key])
      ? root[key]
      : fail(key, 'an object', root[key]);
    return {
      coding: str(value.coding, `${key}.coding`),
      supervisor: str(value.supervisor, `${key}.supervisor`),
    };
  };
  const retros = root.retros ?? false;
  return {
    bot: str(root.bot, 'bot'),
    routines: pair('routines'),
    environments: pair('environments'),
    verify: str(root.verify, 'verify'),
    retros:
      typeof retros === 'boolean'
        ? retros
        : fail('retros', 'true or false', retros),
  };
}

/** The nearest `harness.config.json` at or above `from`. */
export function findConfig(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const path = join(dir, CONFIG_FILE);
    if (existsSync(path)) {
      return path;
    }
    if (dirname(dir) === dir) {
      throw new Error(`No ${CONFIG_FILE} found at or above ${from}`);
    }
  }
}

/** The config file in use: `HARNESS_CONFIG` if set (the tests' fixture), else the project's. */
export const configPath = (): string =>
  process.env.HARNESS_CONFIG ?? findConfig(import.meta.dirname);

/** Reads and checks the config file. */
export function loadConfig(path = configPath()): HarnessConfig {
  return parseConfig(readFileSync(path, 'utf8'), path);
}

/** The project's config, read once. */
export const config: HarnessConfig = loadConfig();

/** One value for a skill to read (`cli/config.ts`): a dotted key, printed as text. */
export function configValue(cfg: HarnessConfig, key: string): string {
  let value: unknown = cfg;
  for (const part of key.split('.')) {
    value =
      isRecord(value) && Object.hasOwn(value, part) ? value[part] : undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    throw new Error(`${CONFIG_FILE} has no value \`${key}\``);
  }
  return String(value);
}

/** Starts a shell command; `spawnSync`'s shape, so tests can stand in for it. */
export type Spawn = (
  command: string,
  options: { cwd: string; shell: true; stdio: 'inherit' },
) => { status: number | null };

/** Runs the project's verify command from its root and returns its exit code (`cli/verify.ts`). */
export function runVerify(
  cfg: HarnessConfig,
  root: string,
  spawn: Spawn,
): number {
  return (
    spawn(cfg.verify, { cwd: root, shell: true, stdio: 'inherit' }).status ?? 1
  );
}
