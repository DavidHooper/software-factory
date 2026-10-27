/**
 * The GitHub write relay. Cloud sessions reach GitHub through Anthropic's
 * proxy, which acts as the human who connected GitHub, so agents there can't
 * write as the bot directly. Instead they send a `repository_dispatch` event
 * carrying one REST write (`RelayWrite`), and the `agent-relay` workflow makes
 * it with the bot's token.
 *
 * The relay is a pass-through (#161): agents are trusted, so it makes any
 * write on this repository's REST API, with one hard rule (`refusedWrite`):
 * no writes to Actions variables or secrets or to repository settings, where
 * the human's kill switch, `AGENTS_PAUSED`, lives.
 */

import { parseRetro, type GhApi, type RetroFacts } from './agent-status.ts';

export const RELAY_EVENT = 'agent-relay';

/** How long `github-write` waits for a relay run. */
export const RELAY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * GitHub refuses a `repository_dispatch` whose `client_payload` is 64 KB or
 * more (docs.github.com, "Create a repository dispatch event"). This leaves
 * room for the event's own fields.
 */
export const MAX_PAYLOAD_BYTES = 60_000;

export const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

/** One REST write: `gh api -X <method> <path>` with `body` as its JSON input. */
export interface RelayWrite {
  method: (typeof WRITE_METHODS)[number];
  path: string;
  body?: Record<string, unknown> | unknown[];
}

/** A relay event's `client_payload`, as `github-write` sends it. */
export interface RelayPayload {
  id?: unknown;
  write?: unknown;
}

/**
 * Paths under `repos/<repo>/` that hold Actions variables and secrets or the
 * repository's settings. `*` matches any one path segment and `**` one or
 * more (a branch name can hold slashes), and each matches everything under
 * it too.
 */
const SETTINGS_PATHS = [
  'actions/variables',
  'actions/secrets',
  'actions/permissions',
  'actions/oidc',
  'actions/runners',
  'actions/runner-groups',
  'environments',
  'dependabot/secrets',
  'codespaces/secrets',
  'branches/**/protection',
  'rulesets',
  'tags/protection',
  'hooks',
  'collaborators',
  'invitations',
  'keys',
  'pages',
  'properties',
  'topics',
  'transfer',
  'autolinks',
  'interaction-limits',
  'vulnerability-alerts',
  'automated-security-fixes',
  'private-vulnerability-reporting',
  'code-security-configuration',
  'code-scanning/default-setup',
  'immutable-releases',
  // Turning a workflow off would stop the relay or the dispatcher.
  'actions/workflows/*/disable',
  'actions/workflows/*/enable',
].map((path) => path.split('/'));

const SETTINGS_REFUSAL =
  'the relay makes no writes to Actions variables, secrets or repository settings (the kill switch AGENTS_PAUSED lives there): only a human changes them';

/**
 * Why the relay won't make a write, or `undefined` if it will. Writes are
 * limited to `repo`'s REST API, since GraphQL and the org and user APIs can
 * reach settings too, and refused for the repository itself and its settings
 * paths (`SETTINGS_PATHS`). The path is decoded and lower-cased before it's
 * matched, and one with an empty or relative (`..`) segment is refused, so
 * it can't reach a settings path another way.
 */
export function refusedWrite(
  write: RelayWrite,
  repo: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(write.path.replace(/[?#].*$/, ''));
  } catch {
    return `${write.path} isn't a valid path: ${SETTINGS_REFUSAL}`;
  }
  // GitHub's routes ignore case, so compare in lower case.
  const segments = decoded
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .split('/');
  const [api, owner, name, ...rest] = segments;
  if (
    api !== 'repos' ||
    `${owner}/${name}`.toLowerCase() !== repo.toLowerCase()
  ) {
    return `${write.path} isn't on ${repo}: the relay writes only to this repository's REST API`;
  }
  if (rest.some((segment) => ['', '.', '..'].includes(segment))) {
    return `${write.path} has an empty or relative segment: ${SETTINGS_REFUSAL}`;
  }
  const isSettings =
    rest.length === 0 ||
    SETTINGS_PATHS.some((settings) => matchesUnder(settings, rest));
  return isSettings ? `${write.path}: ${SETTINGS_REFUSAL}` : undefined;
}

/** Whether `segments` is the settings path `pattern` or under it. */
function matchesUnder(pattern: string[], segments: string[]): boolean {
  const [part, ...restOfPattern] = pattern;
  if (part === undefined) {
    return true;
  }
  const [segment, ...restOfSegments] = segments;
  if (segment === undefined) {
    return false;
  }
  if (part === '**') {
    return (
      matchesUnder(restOfPattern, restOfSegments) ||
      matchesUnder(pattern, restOfSegments)
    );
  }
  return (
    (part === '*' || part === segment) &&
    matchesUnder(restOfPattern, restOfSegments)
  );
}

class RelayError extends Error {}

const fail = (message: string): never => {
  throw new RelayError(message);
};

/** Checks a write as sent; throws with the reason if it's malformed or refused. */
export function parseRelayWrite(raw: unknown, repo: string): RelayWrite {
  if (typeof raw !== 'object' || raw === null) {
    return fail(
      `the payload needs a write, {method, path, body?} (got ${JSON.stringify(raw) ?? 'nothing'})`,
    );
  }
  const r = raw as Record<string, unknown>;
  const method = (WRITE_METHODS as readonly unknown[]).includes(r.method)
    ? (r.method as RelayWrite['method'])
    : fail(
        `method must be one of ${WRITE_METHODS.join(', ')} (got ${JSON.stringify(r.method)}); read with gh api`,
      );
  const path =
    typeof r.path === 'string' && r.path.length > 0
      ? r.path
      : fail(
          `path must be a REST path, e.g. repos/{owner}/{repo}/issues/4 (got ${JSON.stringify(r.path)})`,
        );
  if (r.body !== undefined && (typeof r.body !== 'object' || r.body === null)) {
    fail(`body must be a JSON object or list (got ${JSON.stringify(r.body)})`);
  }
  const write: RelayWrite = {
    method,
    path,
    ...(r.body === undefined
      ? {}
      : { body: r.body as NonNullable<RelayWrite['body']> }),
  };
  const refused = refusedWrite(write, repo);
  return refused === undefined ? write : fail(refused);
}

/** Checks a relay event's payload into the write to make (`parseRelayWrite`). */
export const parseRelayPayload = (
  payload: RelayPayload,
  repo: string,
): RelayWrite => parseRelayWrite(payload.write, repo);

/** The owners on CODEOWNERS' catch-all `*` line, without their `@`. */
export function defaultCodeOwners(codeowners: string): string[] {
  const line = codeowners
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\*\s/.test(l));
  return (line?.split(/\s+/).slice(1) ?? [])
    .filter((owner) => owner.startsWith('@'))
    .map((owner) => owner.slice(1));
}

export interface ApplyOptions {
  gh: GhApi;
  /** Who to ask for review once a review is posted: the default code owners. */
  reviewers: readonly string[];
  /** Finishes the run's status when a retro or run report is posted (`StatusSync.finishRun`). */
  finishRun: (retro: RetroFacts) => void;
}

const COMMENT = /^\/?repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/;
const REVIEW = /^\/?(repos\/[^/]+\/[^/]+\/pulls\/\d+)\/reviews$/;

/**
 * Makes a write with `gh` and returns GitHub's response, then the two
 * follow-ups the flow relies on: a retro or run report finishes the run's status
 * (agent-status.ts), and a review, the review run's summary, asks the code
 * owners for review, so GitHub lists the PR as waiting on them. A follow-up
 * that fails doesn't fail the write; `finishRun` is left to throw so the
 * caller can report it.
 */
export function applyWrite(write: RelayWrite, options: ApplyOptions): unknown {
  const call = (w: RelayWrite): unknown => {
    const output = options.gh(
      [
        '-X',
        w.method,
        w.path,
        ...(w.body === undefined ? [] : ['--input', '-']),
      ],
      w.body,
    );
    return output.trim() ? (JSON.parse(output) as unknown) : undefined;
  };
  const response = call(write);
  const body = write.body as Record<string, unknown> | undefined;
  if (
    write.method === 'POST' &&
    COMMENT.test(write.path) &&
    typeof body?.body === 'string'
  ) {
    const retro = parseRetro(body.body);
    if (retro) {
      options.finishRun(retro);
    }
  }
  const pull = write.method === 'POST' ? REVIEW.exec(write.path)?.[1] : null;
  if (pull && options.reviewers.length > 0) {
    const reviewers = options.reviewers.filter((r) => !r.includes('/'));
    const teams = options.reviewers
      .filter((r) => r.includes('/'))
      .map((r) => r.split('/')[1] ?? '');
    try {
      call({
        method: 'POST',
        path: `${pull}/requested_reviewers`,
        body: { reviewers, team_reviewers: teams },
      });
    } catch {
      // Already asked, or a reviewer GitHub won't take: the review is posted.
    }
  }
  return response;
}

const SUMMARY_FIELDS = ['number', 'id', 'html_url', 'merged', 'sha', 'message'];

/**
 * The fields of a write's response worth printing: the new item's number,
 * id and URL, or a merge's outcome. The relay passes it back to
 * `github-write` in an annotation, so it stays small.
 */
export function writeSummary(response: unknown): Record<string, unknown> {
  if (typeof response !== 'object' || response === null) {
    return {};
  }
  if (Array.isArray(response)) {
    return {};
  }
  const r = response as Record<string, unknown>;
  return Object.fromEntries(
    SUMMARY_FIELDS.filter((field) => r[field] !== undefined).map((field) => [
      field,
      r[field],
    ]),
  );
}

/** How the relay's log marks a write's summary for `github-write` to read back. */
export const RESULT_PREFIX = 'Result: ';

/**
 * An `::error::`, `::warning::` or `::notice::` line for the relay's log. The
 * message can hold a write's own text, so `%`, `\r` and `\n` are escaped as
 * GitHub decodes them: a newline would otherwise start a line of its own,
 * which could fake a result or stop workflow commands.
 */
export function workflowCommand(
  level: 'error' | 'warning' | 'notice',
  message: string,
): string {
  const escaped = message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  return `::${level}::${escaped}`;
}
