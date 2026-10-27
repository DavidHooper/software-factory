import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_APP, AGENT_BOT, checkName } from './agent-status.ts';
import { COMMIT_TYPES, isAgentBranch } from './branches.ts';
import {
  isHuman,
  onIssueLabeled,
  onPullLabeled,
  urgentReasons,
  type DispatchConfig,
  type PullFacts,
} from './dispatch.ts';
import { describe, expect, it } from './test/expect.ts';
import { REPO_ROOT } from './test/paths.ts';

// agent-dispatch.yml skips events before a runner starts. Each filter must be
// a subset of what dispatch.ts decides, so these check the filters against the
// code: whatever the workflow drops, the code would have done nothing with.

// Tests run from the project directory (.harness).
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');
const workflow = read('.github/workflows/agent-dispatch.yml');

/** The Route job's `if:` expression. */
const routeIf = /^ {2}route:\n[\s\S]*?^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(
  workflow,
)?.[1];

/**
 * The JSON array in `contains(fromJSON('…'), <value>)`, in the clause for
 * `event`.
 */
function listFor(event: string, value: string): string[] {
  const escaped = value.replace(/[.[\]]/g, '\\$&');
  const match = new RegExp(
    `\\(github\\.event_name == '${event}' &&[^\\n]*?contains\\(fromJSON\\('(\\[[^']*\\])'\\), ${escaped}\\)`,
  ).exec(routeIf ?? '');
  return JSON.parse(match?.[1] ?? '[]') as string[];
}

/** The `labeled` labels Route lets through for issues, and for PRs. */
const labelsLetThrough = (event: 'issues' | 'pull_request_target') =>
  listFor(event, 'github.event.label.name');

/** The branch prefixes Route lets through. */
const prefixes = () =>
  [...(routeIf ?? '').matchAll(/startsWith\([^)]*\), '([^']+)'\)/g)].map(
    (match) => match[1] ?? '',
  );
const letsThrough = (branch: string) =>
  prefixes().some((prefix) => branch.startsWith(prefix));

/** Every label the docs name, and one they don't. */
const LABELS = [
  ...new Set(
    [...read('docs/agents/labels.md').matchAll(/\| `([a-z:-]+)` +\|/g)].map(
      (match) => match[1] ?? '',
    ),
  ),
  'bug',
];

const config: DispatchConfig = {};
const pull: PullFacts = {
  number: 12,
  state: 'open',
  headRef: 'feat/7-login',
  headSha: 'abc1234def',
  author: AGENT_BOT,
  title: 'feat(api): add login',
  body: 'Closes #7',
  labels: [],
  agentReviews: [],
  mergeable: true,
  issueState: 'open',
  checkRuns: [],
};

describe('agent-dispatch.yml Route filter', () => {
  it('has a filter to check', () => {
    expect(routeIf).toBeDefined();
    expect(labelsLetThrough('issues')).not.toEqual([]);
    expect(labelsLetThrough('pull_request_target')).not.toEqual([]);
    expect(prefixes()).not.toEqual([]);
  });

  describe('issues.labeled (onIssueLabeled, urgentReasons)', () => {
    const acts = (label: string) =>
      onIssueLabeled(
        label,
        { number: 7, state: 'open', labels: [label], blockedBy: 0 },
        config,
      ).runs.length > 0 ||
      urgentReasons({ kind: 'labeled', label, number: 7 }).length > 0;

    it.each(LABELS)(
      'lets %s through only if the dispatcher acts on it',
      (label) => {
        expect(labelsLetThrough('issues').includes(label)).toBe(acts(label));
      },
    );
  });

  describe('pull_request_target.labeled (onPullLabeled, urgentReasons)', () => {
    const acts = (label: string) =>
      onPullLabeled(label, { ...pull, labels: [label] }, config).runs.length >
        0 || urgentReasons({ kind: 'labeled', label, number: 12 }).length > 0;

    it.each(LABELS)(
      'lets %s through only if the dispatcher acts on it',
      (label) => {
        expect(labelsLetThrough('pull_request_target').includes(label)).toBe(
          acts(label),
        );
      },
    );
  });

  describe('check_run on any branch (urgentReasons)', () => {
    const CONCLUSIONS = [
      'success',
      'failure',
      'neutral',
      'cancelled',
      'skipped',
      'timed_out',
      'action_required',
      'stale',
    ];
    const conclusions = () =>
      listFor('check_run', 'github.event.check_run.conclusion');

    it.each(CONCLUSIONS)(
      'lets %s through only if a failed agent run wakes the harness supervisor',
      (conclusion) => {
        const wakes =
          urgentReasons({
            kind: 'check',
            name: checkName('review-pr'),
            app: AGENT_APP,
            conclusion,
            pulls: [12],
          }).length > 0;
        expect(conclusions().includes(conclusion)).toBe(wakes);
      },
    );
  });

  describe('comments (urgentReasons, isHuman)', () => {
    const ASSOCIATIONS = [
      'OWNER',
      'MEMBER',
      'COLLABORATOR',
      'CONTRIBUTOR',
      'FIRST_TIME_CONTRIBUTOR',
      'FIRST_TIMER',
      'MANNEQUIN',
      'NONE',
    ];

    describe.each([
      ['issue_comment', 'created', 'comment'],
      ['pull_request_review_comment', 'created', 'comment'],
      ['pull_request_review', 'submitted', 'review'],
    ])('%s.%s', (event, action, payload) => {
      const clause = new RegExp(
        `\\(github\\.event_name == '${event}' && github\\.event\\.action == '${action}' && !endsWith\\(github\\.event\\.${payload}\\.user\\.login, '\\[bot\\]'\\) && contains\\(`,
      );

      it('is let through only on that action, and never from a [bot] login, as isHuman', () => {
        expect(routeIf).toMatch(clause);
        expect(
          isHuman({ user: { login: AGENT_BOT }, author_association: 'OWNER' }),
        ).toBe(false);
      });

      it.each(ASSOCIATIONS)(
        'lets %s through only if isHuman counts it',
        (association) => {
          expect(
            listFor(
              event,
              `github.event.${payload}.author_association`,
            ).includes(association),
          ).toBe(
            isHuman({
              user: { login: 'someone' },
              author_association: association,
            }),
          );
        },
      );
    });
  });

  describe('branches (isAgentBranch)', () => {
    it.each([
      ...COMMIT_TYPES.map((type) => `${type}/12-some-slug`),
      'claude/issue-3-login',
    ])('lets %s through', (branch) => {
      expect(isAgentBranch(branch)).toBe(true);
      expect(letsThrough(branch)).toBe(true);
    });

    it.each([
      'main',
      'release/1.2',
      'dependabot/npm_and_yarn/jest-30',
      'dh/try-this',
    ])("drops %s, which isn't an agent branch", (branch) => {
      expect(isAgentBranch(branch)).toBe(false);
      expect(letsThrough(branch)).toBe(false);
    });
  });
});

describe('agent-dispatch.yml permissions', () => {
  // The dispatcher reads GitHub facts (cli/github-facts.ts) with the
  // workflow's own token, which has only what `permissions:` grants. Missing
  // Actions: read made its reads fail with HTTP 403 (#112), so every REST
  // path it reads must have its permission granted.
  const SCOPES: [RegExp, string][] = [
    [/^actions\//, 'actions'],
    [/^commits\/[^/]+\/check-runs/, 'checks'],
    [/^(commits|compare|contents|git)\b/, 'contents'],
    [/^pulls\b/, 'pull-requests'],
    [/^issues\b/, 'issues'],
  ];

  /** The workflow-level `permissions:` block, as scope → access. */
  const granted = new Map(
    [
      ...(/^permissions:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? '').matchAll(
        /^ {2}([a-z-]+): (read|write)$/gm,
      ),
    ].map((match) => [match[1] ?? '', match[2] ?? '']),
  );

  /**
   * The REST paths, after `repos/${repo}/`, read with the workflow's token:
   * all of github-facts.ts's, and cli/dispatch.ts's `api()` and `listAll()` reads.
   */
  const paths = [
    ...read('.harness/src/cli/github-facts.ts').matchAll(
      /`repos\/\$\{repo\}\/([^`]+)`/g,
    ),
    ...read('.harness/src/cli/dispatch.ts').matchAll(
      /\b(?:api|exists|listAll)(?:<[^(]*>)?\(\s*`repos\/\$\{repo\}\/([^`]+)`/g,
    ),
  ].map((match) => match[1] ?? '');

  it('has paths and permissions to check', () => {
    expect(paths.length).toBeGreaterThan(10);
    expect(granted.size).toBeGreaterThan(0);
  });

  it('grants Actions: read, which the Verify runs on main need (#112)', () => {
    expect(granted.get('actions')).toMatch(/^(read|write)$/);
  });

  it.each([...new Set(paths)])('grants the permission %s needs', (path) => {
    const scope = SCOPES.find(([pattern]) => pattern.test(path))?.[1];
    expect(scope).toBeDefined();
    expect(granted.get(scope ?? '')).toMatch(/^(read|write)$/);
  });
});

describe('workflows that run harness code', () => {
  // Harness code reads harness.config.json at the repo root (config.ts). A
  // cone-mode sparse checkout always has the root's files; a non-cone one
  // has only the paths it lists.
  const workflows = readdirSync(join(REPO_ROOT, '.github/workflows'));

  it.each(workflows)('%s checks out harness.config.json', (name) => {
    const text = read(`.github/workflows/${name}`);
    const nonCone = [
      ...text.matchAll(
        /sparse-checkout: \|\n((?: {12}.*\n)+)\s*sparse-checkout-cone-mode: false/g,
      ),
    ];
    for (const [, paths] of nonCone) {
      expect(paths).toContain('harness.config.json');
    }
  });
});
