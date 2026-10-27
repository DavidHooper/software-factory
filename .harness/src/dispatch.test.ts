import { pr79CheckRuns } from './ci-status.fixtures.ts';
import {
  breakingMerge,
  isAbandoned,
  isPaused,
  isRed,
  mergeGate,
  mergeBody,
  onCiCompleted,
  onIssueClosed,
  onIssueLabeled,
  onMainVerified,
  onMergeCheck,
  isMergeCandidate,
  supervisorMerge,
  onPullLabeled,
  pauseWarning,
  type DispatchConfig,
  type IssueFacts,
  type MainCommitFacts,
  type PullFacts,
  type VerifyRun,
} from './dispatch.ts';
import { describe, expect, it } from './test/expect.ts';

const config: DispatchConfig = {};

const issue = (overrides: Partial<IssueFacts> = {}): IssueFacts => ({
  number: 7,
  state: 'open',
  labels: ['agent-ready'],
  blockedBy: 0,
  ...overrides,
});
const pull = (overrides: Partial<PullFacts> = {}): PullFacts => ({
  number: 12,
  state: 'open',
  headRef: 'feat/7-login',
  headSha: 'abc1234def',
  author: 'example-agent[bot]',
  title: 'feat(api): add login',
  body: 'body',
  labels: [],
  agentReviews: [],
  mergeable: true,
  issueState: 'open',
  checkRuns: [
    { id: 1, name: 'Verify', status: 'completed', conclusion: 'success' },
    {
      id: 2,
      name: 'Harness guard',
      status: 'completed',
      conclusion: 'skipped',
    },
  ],
  ...overrides,
});
const commitBody = [
  '## Summary',
  '',
  'Adds login.',
  '',
  'Closes #7',
  '',
  '## Commit message',
  '',
  '```text',
  'Add a login endpoint to the api app.',
  '',
  'Closes #7',
  '```',
].join('\n');
/** An `Agent review` check on the head: its run is going, or finished. */
const reviewCheck = (
  status: 'in_progress' | 'completed',
  id = 3,
): PullFacts['checkRuns'][number] => ({
  id,
  name: 'Agent review',
  status,
  conclusion: status === 'completed' ? 'success' : null,
});
/** The head's CI checks: Verify passed, or failed. */
const ci = (conclusion: 'success' | 'failure') => [
  { id: 1, name: 'Verify', status: 'completed', conclusion },
];
/** A PR whose review run finished on its head, with nothing pushed. */
const reviewed = (overrides: Partial<PullFacts> = {}): PullFacts =>
  pull({
    agentReviews: ['abc1234def'],
    checkRuns: [...ci('success'), reviewCheck('completed')],
    ...overrides,
  });
/** A PR that meets every condition of the merge gate. */
const ready = (overrides: Partial<PullFacts> = {}): PullFacts =>
  reviewed({ body: commitBody, ...overrides });

describe('routing', () => {
  // `agent-complex` is a retired label, kept here to prove routing ignores labels.
  const labelSets = [
    [],
    ['agent-complex'],
    ['harness'],
    ['agent-complex', 'harness'],
  ];

  it.each(labelSets)(
    'routes implement and review-pr to agent-harness (labels: %j)',
    (...labels: string[]) => {
      const runs = [
        ...onIssueLabeled(
          'agent-ready',
          issue({ labels: ['agent-ready', ...labels] }),
          config,
        ).runs,
        ...onPullLabeled('needs-review', pull({ labels }), config).runs,
      ];
      expect(runs).toEqual([
        {
          skill: 'implement',
          number: 7,
          kind: 'issue',
          routine: 'example-coding',
        },
        {
          skill: 'review-pr',
          number: 12,
          kind: 'pr',
          routine: 'example-coding',
        },
      ]);
    },
  );
});

describe('onIssueLabeled', () => {
  it('starts /implement for agent-ready', () => {
    expect(onIssueLabeled('agent-ready', issue(), config).runs).toMatchObject([
      { skill: 'implement', number: 7 },
    ]);
  });

  it('waits while the issue has open blockers', () => {
    const dispatch = onIssueLabeled(
      'agent-ready',
      issue({ blockedBy: 2 }),
      config,
    );
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      '#7 has 2 open blocker(s); it starts when they close.',
    ]);
  });

  it('ignores other labels and closed issues', () => {
    expect(onIssueLabeled('bug', issue(), config).runs).toEqual([]);
    expect(
      onIssueLabeled('agent-ready', issue({ state: 'closed' }), config).runs,
    ).toEqual([]);
  });
});

describe('onIssueClosed', () => {
  it('starts dependents that are now unblocked and agent-ready', () => {
    const dependents = [
      issue({ number: 8 }),
      issue({ number: 9, blockedBy: 1 }),
      issue({ number: 10, labels: [] }),
      issue({ number: 11, labels: ['agent-ready', 'agent-blocked'] }),
      issue({ number: 12, state: 'closed' }),
    ];
    expect(
      onIssueClosed(dependents, config).runs.map((run) => run.number),
    ).toEqual([8]);
  });
});

describe('onPullLabeled', () => {
  it('starts /review-pr for needs-review on any open PR', () => {
    expect(
      onPullLabeled('needs-review', pull({ headRef: 'feature/x' }), config)
        .runs,
    ).toMatchObject([{ skill: 'review-pr', number: 12, kind: 'pr' }]);
  });

  it('starts /review-pr for needs-review on a PR whose review budget is spent', () => {
    // Two review runs done, and the second's push left the head red: the
    // budget (`reviewRun`) would start nothing more, but the harness
    // supervisor's send-back (or a human) still restarts it.
    const spent = pull({
      headSha: 'def5678abc',
      agentReviews: ['abc1234def', 'bcd2345efa'],
      checkRuns: [...ci('failure'), reviewCheck('completed')],
    });
    expect(onCiCompleted('def5678abc', [spent], config)).toEqual({
      runs: [],
      notes: ['#12 has had both its review runs.'],
    });
    expect(onPullLabeled('needs-review', spent, config).runs).toMatchObject([
      { skill: 'review-pr', number: 12, kind: 'pr' },
    ]);
  });

  it("starts nothing for needs-revision, which isn't a trigger any more", () => {
    expect(onPullLabeled('needs-revision', pull(), config).runs).toEqual([]);
  });

  it('ignores closed PRs and other labels', () => {
    expect(
      onPullLabeled('needs-review', pull({ state: 'closed' }), config).runs,
    ).toEqual([]);
    expect(onPullLabeled('agent-ready', pull(), config).runs).toEqual([]);
  });
});

describe('onCiCompleted', () => {
  it('starts the review run when CI first goes green on a new agent PR', () => {
    expect(onCiCompleted('abc1234def', [pull()], config).runs).toMatchObject([
      { skill: 'review-pr', number: 12, kind: 'pr' },
    ]);
  });

  it('skips stale commits, human branches, reviewed and blocked PRs', () => {
    const dispatch = onCiCompleted(
      'abc1234def',
      [
        pull({ headSha: 'older' }),
        pull({ headRef: 'feature/x' }),
        reviewed({ number: 13 }),
        pull({ number: 14, labels: ['agent-blocked'] }),
        pull({ state: 'closed' }),
      ],
      config,
    );
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      '#13 has had its review run.',
      '#14 is agent-blocked.',
    ]);
  });

  it("doesn't start a review on a red head that was never reviewed", () => {
    const dispatch = onCiCompleted(
      'abc1234def',
      [pull({ checkRuns: ci('failure') })],
      config,
    );
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      "#12 isn't green at abc1234: Verify failed.",
    ]);
  });

  it("doesn't start a second run while the first is still going", () => {
    const dispatch = onCiCompleted(
      'abc1234def',
      [pull({ checkRuns: [...ci('success'), reviewCheck('in_progress')] })],
      config,
    );
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      '#12 is already being reviewed at abc1234.',
    ]);
  });

  it("doesn't start another run on a head whose run ended without a review", () => {
    const dispatch = onCiCompleted(
      'abc1234def',
      [pull({ checkRuns: [...ci('success'), reviewCheck('completed')] })],
      config,
    );
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      '#12 already had a review run at abc1234.',
    ]);
  });
});

describe('onCiCompleted after the review run pushed', () => {
  /** The review run reviewed `rev1`, pushed `fix2` and finished. */
  const pushed = (overrides: Partial<PullFacts> = {}) =>
    pull({
      headSha: 'fix2',
      agentReviews: ['rev1'],
      checkRuns: [...ci('failure'), reviewCheck('completed')],
      ...overrides,
    });
  const runs = (facts: PullFacts) => onCiCompleted('fix2', [facts], config);

  it('starts a second run when the push broke CI', () => {
    expect(runs(pushed()).runs).toMatchObject([
      { skill: 'review-pr', number: 12 },
    ]);
  });

  it("starts no second run when the push's CI passed", () => {
    expect(
      runs(pushed({ checkRuns: [...ci('success'), reviewCheck('completed')] })),
    ).toEqual({ runs: [], notes: ['#12 has had its review run.'] });
  });

  it('waits for the first run to finish before starting the second', () => {
    expect(runs(pushed({ checkRuns: ci('failure') }))).toEqual({
      runs: [],
      notes: ["#12's review run hasn't finished at fix2."],
    });
  });

  it('waits while CI is still running', () => {
    expect(
      runs(
        pushed({
          checkRuns: [
            { id: 1, name: 'Verify', status: 'in_progress', conclusion: null },
            reviewCheck('completed'),
          ],
        }),
      ).runs,
    ).toEqual([]);
  });

  it('starts no third run', () => {
    expect(runs(pushed({ agentReviews: ['rev1', 'fix1'] }))).toEqual({
      runs: [],
      notes: ['#12 has had both its review runs.'],
    });
  });

  it("starts no second run on a red head the review didn't push", () => {
    expect(runs(pushed({ agentReviews: ['fix2'] })).runs).toEqual([]);
  });

  it("starts nothing and wakes no one when someone else's push after a no-push run goes red", () => {
    // The run reviewed `rev1` and pushed nothing; the supervisor then pushed `sup2`, which has no
    // `Agent review` check. The supervisor's hourly run finds the PR (`secondRunLeft`).
    const later = pushed({ headSha: 'sup2', checkRuns: ci('failure') });
    expect(onCiCompleted('sup2', [later], config)).toEqual({
      runs: [],
      notes: ["#12's review run hasn't finished at sup2."],
    });
    expect(onMergeCheck('sup2', [later], config).reasons).toEqual([]);
  });
});

describe('onCiCompleted on a real head', () => {
  it("reviews a head with PR #79's cancelled duplicate Harness guard (#83)", () => {
    expect(
      onCiCompleted(
        '4b5258c',
        [pull({ number: 79, headSha: '4b5258c', checkRuns: pr79CheckRuns })],
        config,
      ).runs,
    ).toMatchObject([{ skill: 'review-pr', number: 79 }]);
  });
});

describe('onCiCompleted with other checks on the head', () => {
  const check = (
    id: number,
    name: string,
    status: string,
    conclusion: string | null = null,
  ) => ({ id, name, status, conclusion });
  const verify = check(1, 'Verify', 'completed', 'success');
  const dispatchFor = (checkRuns: PullFacts['checkRuns']) =>
    onCiCompleted('abc1234def', [pull({ checkRuns })], config);

  it('waits for a failed Harness guard, naming it', () => {
    const dispatch = dispatchFor([
      verify,
      check(2, 'Harness guard', 'completed', 'failure'),
    ]);
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      "#12 isn't green at abc1234: Harness guard failed.",
    ]);
  });

  it('waits for a check still running, naming it', () => {
    const dispatch = dispatchFor([
      verify,
      check(2, 'Harness guard', 'in_progress'),
    ]);
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual([
      "#12 isn't green at abc1234: Harness guard is still running.",
    ]);
  });

  it('reviews once a re-run Harness guard is skipped, ignoring agent checks', () => {
    const dispatch = dispatchFor([
      verify,
      check(2, 'Harness guard', 'completed', 'failure'),
      check(3, 'Harness guard', 'completed', 'skipped'),
      check(4, 'Agent review', 'queued'),
    ]);
    expect(dispatch.runs).toMatchObject([{ skill: 'review-pr', number: 12 }]);
  });
});

describe('PRs whose issue is closed', () => {
  const closed = pull({ issueState: 'closed' });

  it("doesn't review them when CI passes", () => {
    const dispatch = onCiCompleted('abc1234def', [closed], config);
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual(['#12 closes an issue that is closed.']);
  });

  it("doesn't start runs from their labels", () => {
    const dispatch = onPullLabeled('needs-review', closed, config);
    expect(dispatch.runs).toEqual([]);
    expect(dispatch.notes).toEqual(['#12 closes an issue that is closed.']);
  });

  it('still reviews PRs that close no issue', () => {
    expect(
      onPullLabeled('needs-review', pull({ issueState: null }), config).runs,
    ).toHaveLength(1);
  });
});

describe('isAbandoned', () => {
  const open = { state: 'open' as const, headRef: 'feat/10-web-shout' };
  const notPlanned = { state: 'closed' as const, stateReason: 'not_planned' };

  it('is true for an open agent PR whose issue was closed as not planned', () => {
    expect(isAbandoned(open, notPlanned)).toBe(true);
  });

  it.each([
    [
      'the issue was completed',
      open,
      { state: 'closed' as const, stateReason: 'completed' },
    ],
    ['the issue is open', open, { state: 'open' as const, stateReason: null }],
    ['the PR closes no issue', open, undefined],
    [
      'the PR is already closed',
      { ...open, state: 'closed' as const },
      notPlanned,
    ],
    ['the PR is a human one', { ...open, headRef: 'feature/x' }, notPlanned],
  ])('is false when %s', (_case, pull, issue) => {
    expect(isAbandoned(pull, issue)).toBe(false);
  });
});

describe('isPaused', () => {
  it.each(['true', 'TRUE', ' True '])('is true for %j', (value) => {
    expect(isPaused(value)).toBe(true);
  });

  it.each([undefined, '', 'false', '1', 'yes', 'paused'])(
    'is false for %j',
    (value) => {
      expect(isPaused(value)).toBe(false);
    },
  );
});

describe('pauseWarning', () => {
  it.each(['1', 'yes', ' on '])('warns that %j does not pause', (value) => {
    expect(pauseWarning(value)).toBe(
      `\`AGENTS_PAUSED\` is \`${value.trim()}\`, which doesn't pause agents: set it to \`true\` to pause.`,
    );
  });

  it.each([undefined, '', ' ', 'true', 'TRUE', 'false', ' False '])(
    'is quiet for %j',
    (value) => {
      expect(pauseWarning(value)).toBeUndefined();
    },
  );
});

describe('while paused', () => {
  const paused: DispatchConfig = { ...config, paused: true };
  const reason = 'AGENTS_PAUSED is on';

  it('starts nothing when an issue is labelled agent-ready', () => {
    expect(onIssueLabeled('agent-ready', issue(), paused)).toEqual({
      runs: [],
      notes: [`Didn't start /implement for #7: ${reason}.`],
    });
  });

  it('starts nothing when a blocker closes', () => {
    expect(onIssueClosed([issue({ number: 3 }), issue()], paused)).toEqual({
      runs: [],
      notes: [
        `Didn't start /implement for #3: ${reason}.`,
        `Didn't start /implement for #7: ${reason}.`,
      ],
    });
  });

  it('starts nothing when a PR is labelled', () => {
    expect(onPullLabeled('needs-review', pull(), paused)).toEqual({
      runs: [],
      notes: [`Didn't start /review-pr for #12: ${reason}.`],
    });
  });

  it('starts nothing when CI passes, keeping the other notes', () => {
    expect(
      onCiCompleted('abc1234def', [pull(), reviewed({ number: 13 })], paused),
    ).toEqual({
      runs: [],
      notes: [
        '#13 has had its review run.',
        `Didn't start /review-pr for #12: ${reason}.`,
      ],
    });
  });

  it('adds no note for events that start nothing anyway', () => {
    expect(onIssueLabeled('bug', issue(), paused)).toEqual({
      runs: [],
      notes: [],
    });
  });
});

describe('mergeGate', () => {
  it('passes a PR that meets all four conditions, with its commit message', () => {
    expect(mergeGate(ready())).toEqual({
      merge: {
        number: 12,
        sha: 'abc1234def',
        title: 'feat(api): add login (#12)',
        message: 'Add a login endpoint to the api app.\n\nCloses #7',
      },
      note: '#12 passed the merge gate at abc1234.',
    });
  });

  const failed = (id: number, name: string) => ({
    id,
    name,
    status: 'completed',
    conclusion: 'failure',
  });
  it.each<[string, Partial<PullFacts>, string]>([
    [
      'a failed check',
      {
        checkRuns: [
          { id: 1, name: 'Verify', status: 'completed', conclusion: 'success' },
          failed(2, 'CodeQL'),
        ],
      },
      "it isn't green at abc1234: CodeQL failed",
    ],
    [
      'a pending check',
      {
        checkRuns: [
          { id: 1, name: 'Verify', status: 'in_progress', conclusion: null },
        ],
      },
      "it isn't green at abc1234: Verify is still running",
    ],
    [
      'no review run',
      { agentReviews: [], checkRuns: ci('success') },
      "the review run hasn't finished at abc1234",
    ],
    [
      'a review run still going',
      { checkRuns: [...ci('success'), reviewCheck('in_progress')] },
      "the review run hasn't finished at abc1234",
    ],
    [
      'a review run that ended without posting its review',
      { agentReviews: [] },
      "the review run hasn't finished at abc1234",
    ],
    [
      'a second review run still going after a finished first',
      {
        checkRuns: [
          ...ci('success'),
          reviewCheck('completed'),
          reviewCheck('in_progress', 4),
        ],
      },
      "the review run hasn't finished at abc1234",
    ],
    ['a merge conflict', { mergeable: false }, 'it has a merge conflict'],
    [
      'mergeability still being worked out',
      { mergeable: null },
      "GitHub hasn't worked out yet whether it has a merge conflict",
    ],
    ['needs-human', { labels: ['needs-human'] }, 'it is needs-human'],
    ['agent-blocked', { labels: ['agent-blocked'] }, 'it is agent-blocked'],
  ])('refuses %s', (_, overrides, reason) => {
    expect(mergeGate(ready(overrides))).toEqual({
      note: `Didn't merge #12: ${reason}.`,
    });
  });

  it.each<[string, Partial<PullFacts>]>([
    ['a PR body with no commit message', { body: 'Adds login.' }],
    ['other labels', { labels: ['harness', 'needs-review'] }],
  ])("doesn't look at %s", (_, overrides) => {
    expect(mergeGate(ready(overrides)).merge).toBeDefined();
  });

  it('notes the first condition that fails', () => {
    expect(
      mergeGate(
        ready({ labels: ['needs-human', 'agent-blocked'], mergeable: false }),
      ).note,
    ).toBe("Didn't merge #12: it is needs-human and agent-blocked.");
  });

  it.each([
    [
      'the `text` block under `## Commit message`',
      commitBody,
      'Add a login endpoint to the api app.\n\nCloses #7',
    ],
    [
      'the summary, with no commit message',
      '## Summary\n\nAdds login.\n\n## Evidence\n\nTests.\n\nCloses #7',
      'Adds login.',
    ],
    [
      'the summary, when the commit message has no `text` block',
      '## Summary\n\nAdds login.\n\n## Commit message\n\nAdd a login endpoint.',
      'Adds login.',
    ],
    ['nothing, with neither', 'Adds login.\n\nCloses #7\n', ''],
    [
      'the commit message, leaving `## Human steps` before it out',
      `## Human steps\n\n- Set \`X\`.\n\n${commitBody}`,
      'Add a login endpoint to the api app.\n\nCloses #7',
    ],
    [
      'the commit message, leaving `## Human steps` after it out',
      `${commitBody}\n\n## Human steps\n\n- Set \`X\`.`,
      'Add a login endpoint to the api app.\n\nCloses #7',
    ],
  ])('takes the commit message from %s', (_, body, message) => {
    expect(mergeGate(ready({ body })).merge?.message).toBe(message);
  });
});

describe('mergeGate on a revert', () => {
  it('holds a revert to the review run, like any other agent PR', () => {
    expect(
      mergeGate(
        pull({
          headRef: 'revert/7-login',
          title: 'revert(api): add login',
          body: commitBody,
        }),
      ),
    ).toEqual({
      note: "Didn't merge #12: the review run hasn't finished at abc1234.",
    });
  });
});

describe('breakingMerge', () => {
  it('is the oldest red commit since main was last green', () => {
    expect(
      breakingMerge([
        { sha: 'c', conclusion: 'failure', onMain: true },
        { sha: 'b', conclusion: 'timed_out', onMain: true },
        { sha: 'a', conclusion: 'success', onMain: true },
      ]),
    ).toBe('b');
  });

  it('skips runs that are neither red nor green', () => {
    expect(
      breakingMerge([
        { sha: 'd', conclusion: 'cancelled', onMain: true },
        { sha: 'c', conclusion: 'failure', onMain: true },
        { sha: 'b', conclusion: 'skipped', onMain: true },
        { sha: 'a', conclusion: 'neutral', onMain: true },
      ]),
    ).toBe('c');
  });

  it.each<[string, VerifyRun[]]>([
    [
      'main is green',
      [
        { sha: 'b', conclusion: 'success', onMain: true },
        { sha: 'a', conclusion: 'failure', onMain: true },
      ],
    ],
    [
      'no run since main was last green is listed',
      [{ sha: 'a', conclusion: 'failure', onMain: true }],
    ],
    ['there are no runs', []],
  ])('is undefined when %s', (_, runs) => {
    expect(breakingMerge(runs)).toBeUndefined();
  });
});

describe('isRed', () => {
  it.each(['failure', 'timed_out', 'startup_failure', 'action_required'])(
    'counts %s as red',
    (conclusion) => {
      expect(isRed(conclusion)).toBe(true);
    },
  );

  it.each([null, 'success', 'neutral', 'skipped', 'cancelled'])(
    "doesn't count %s as red",
    (conclusion) => {
      expect(isRed(conclusion)).toBe(false);
    },
  );
});

describe('mergeBody', () => {
  it('squash-merges the head the gate passed, with its title and message', () => {
    expect(
      mergeBody({
        number: 12,
        sha: 'abc1234def',
        title: 'feat(api): add login (#12)',
        message: 'Add login.\n\nCloses #7',
      }),
    ).toEqual({
      merge_method: 'squash',
      sha: 'abc1234def',
      commit_title: 'feat(api): add login (#12)',
      commit_message: 'Add login.\n\nCloses #7',
    });
  });
});

describe('onMergeCheck', () => {
  it('wakes the harness supervisor once the review run has finished', () => {
    expect(onMergeCheck('abc1234def', [ready()], config).reasons).toEqual([
      { kind: 'mergeable', number: 12 },
    ]);
    expect(
      onMergeCheck(
        'abc1234def',
        [ready({ checkRuns: [...ci('success'), reviewCheck('in_progress')] })],
        config,
      ).reasons,
    ).toEqual([]);
  });

  it("wakes it once the review run's push is green, before its retro lands", () => {
    expect(
      onMergeCheck(
        'fix2',
        [
          ready({
            headSha: 'fix2',
            agentReviews: ['rev1'],
            checkRuns: ci('success'),
          }),
        ],
        config,
      ).reasons,
    ).toEqual([{ kind: 'mergeable', number: 12 }]);
  });

  it("wakes it once the harness supervisor's own fix is green", () => {
    expect(
      onMergeCheck(
        'sup3',
        [
          ready({
            headSha: 'sup3',
            agentReviews: ['rev1', 'fix2'],
            checkRuns: ci('success'),
          }),
        ],
        config,
      ).reasons,
    ).toEqual([{ kind: 'mergeable', number: 12 }]);
  });

  it("wakes it once the review run's push is green", () => {
    expect(
      onMergeCheck(
        'fix2',
        [ready({ headSha: 'fix2', agentReviews: ['rev1'] })],
        config,
      ).reasons,
    ).toEqual([{ kind: 'mergeable', number: 12 }]);
  });

  it('wakes it for a red head once both review runs are spent', () => {
    const spent = ready({
      headSha: 'fix3',
      agentReviews: ['rev1', 'fix2'],
      checkRuns: [...ci('failure'), reviewCheck('completed')],
    });
    expect(onMergeCheck('fix3', [spent], config)).toEqual({
      reasons: [{ kind: 'red-after-review', number: 12 }],
      notes: [
        '#12 is red at fix3 after its review runs: the harness supervisor decides what next.',
      ],
    });
  });

  it("doesn't wake it for a red head a second review run will fix", () => {
    const pushed = ready({
      headSha: 'fix2',
      agentReviews: ['rev1'],
      checkRuns: [...ci('failure'), reviewCheck('completed')],
    });
    expect(onMergeCheck('fix2', [pushed], config).reasons).toEqual([]);
  });

  it('hands agent PRs that pass the gate to the harness supervisor, noting the rest', () => {
    expect(
      onMergeCheck(
        'abc1234def',
        [ready(), ready({ number: 13, mergeable: false })],
        config,
      ),
    ).toEqual({
      reasons: [{ kind: 'mergeable', number: 12 }],
      notes: [
        '#12 passed the merge gate at abc1234: the harness supervisor decides its merge.',
        "Didn't merge #13: it has a merge conflict.",
      ],
    });
  });

  it('ignores PRs whose head has moved on, and human branches', () => {
    expect(
      onMergeCheck(
        'abc1234def',
        [ready({ headSha: 'newer99' }), ready({ headRef: 'my-feature' })],
        config,
      ),
    ).toEqual({ reasons: [], notes: [] });
  });

  it("hands over when another app's check is the last to finish", () => {
    const codeql = {
      id: 3,
      name: 'CodeQL',
      status: 'completed',
      conclusion: 'success',
    };
    const checkRuns = [...ready().checkRuns, codeql];
    expect(
      onMergeCheck('abc1234def', [ready({ checkRuns })], config).reasons,
    ).toEqual([{ kind: 'mergeable', number: 12 }]);
    expect(
      onMergeCheck(
        'abc1234def',
        [
          ready({
            checkRuns: [
              ...ready().checkRuns,
              { ...codeql, status: 'in_progress', conclusion: null },
            ],
          }),
        ],
        config,
      ).reasons,
    ).toEqual([]);
  });

  it('hands nothing over while paused', () => {
    expect(
      onMergeCheck('abc1234def', [ready()], { ...config, paused: true }),
    ).toEqual({
      reasons: [],
      notes: [
        "Didn't hand #12 to the harness supervisor: AGENTS_PAUSED is on.",
      ],
    });
  });
});

describe('supervisorMerge', () => {
  it('passes an open agent PR the merge gate passes', () => {
    expect(supervisorMerge(ready())).toEqual(mergeGate(ready()));
  });

  it.each<[string, Partial<PullFacts>, string]>([
    ['a closed PR', { state: 'closed' }, "it isn't open"],
    [
      'a human branch',
      { headRef: 'my-feature' },
      "my-feature isn't an agent branch",
    ],
    [
      'a legacy claude/ branch',
      { headRef: 'claude/issue-7-login' },
      "claude/issue-7-login isn't an agent branch",
    ],
    ['a PR the gate refuses', { mergeable: false }, 'it has a merge conflict'],
  ])('refuses %s', (_, overrides, reason) => {
    expect(supervisorMerge(ready(overrides))).toEqual({
      note: `Didn't merge #12: ${reason}.`,
    });
  });
});

describe('isMergeCandidate', () => {
  it.each<[string, Partial<PullFacts>, boolean]>([
    ['passes the gate', {}, true],
    ['is closed', { state: 'closed' }, false],
    ['is on a human branch', { headRef: 'my-feature' }, false],
    [
      'is on a legacy claude/ branch',
      { headRef: 'claude/issue-7-login' },
      false,
    ],
    ['is waiting on the human', { labels: ['needs-human'] }, false],
    ['is unreviewed', { agentReviews: [], checkRuns: ci('success') }, false],
  ])('%s: %s', (_, overrides, expected) => {
    expect(isMergeCandidate(ready(overrides), config)).toBe(expected);
  });

  it('is never one while paused', () => {
    expect(isMergeCandidate(ready(), { paused: true })).toBe(false);
  });
});

describe('onMainVerified', () => {
  const run = 'https://github.com/example/repo/actions/runs/99';
  /** Verify failed on main at the squash merge of #12, which the merge gate made. */
  const red = (overrides: Partial<MainCommitFacts> = {}): MainCommitFacts => ({
    sha: 'fff0000aaa',
    conclusion: 'failure',
    runUrl: run,
    pull: {
      number: 12,
      headRef: 'feat/7-login',
      title: 'feat(api): add login',
      mergedBy: 'example-agent[bot]',
    },
    breaking: { sha: 'fff0000aaa', pr: 12 },
    onMain: true,
    ...overrides,
  });
  /** The `main-red` wake for `red()`, with `overrides`. */
  const mainRed = (overrides: object = {}) => ({
    kind: 'main-red',
    sha: 'fff0000aaa',
    runUrl: run,
    pr: 12,
    by: 'merge-gate',
    breaking: { sha: 'fff0000aaa', pr: 12 },
    ...overrides,
  });

  it.each(['failure', 'success'])(
    "ignores a %s Verify run on a ref named main whose commit isn't on main",
    (conclusion) => {
      expect(onMainVerified(red({ conclusion, onMain: false }))).toEqual({
        note: "Verify finished on a ref named main at fff0000, but that commit isn't on main, so it's ignored.",
      });
    },
  );

  it("wakes the harness supervisor with the failing run and the breaking merge, and doesn't pause", () => {
    expect(onMainVerified(red())).toEqual({
      reason: mainRed(),
      note: "Verify failed on main at fff0000, the merge gate's merge of #12: the harness supervisor gets main green.",
    });
  });

  it('names the merge that broke main when a later merge is red too', () => {
    expect(
      onMainVerified(
        red({
          sha: 'aaa1111bbb',
          pull: { ...red().pull!, number: 13 },
        }),
      ).reason,
    ).toEqual(mainRed({ sha: 'aaa1111bbb', pr: 13 }));
  });

  it("wakes the harness supervisor for a human's red merge, without commenting", () => {
    expect(
      onMainVerified(
        red({ pull: { ...red().pull!, mergedBy: 'example-user' } }),
      ),
    ).toEqual({
      reason: mainRed({ by: 'human' }),
      note: "Verify failed on main at fff0000, a human's merge of #12: the harness supervisor gets main green.",
    });
  });

  it('counts the bot merging a non-agent branch as a human merge', () => {
    expect(
      onMainVerified(red({ pull: { ...red().pull!, headRef: 'my-feature' } }))
        .reason,
    ).toEqual(mainRed({ by: 'human' }));
  });

  it('wakes the harness supervisor for a red commit pushed with no PR', () => {
    expect(onMainVerified(red({ pull: null, breaking: undefined }))).toEqual({
      reason: mainRed({ pr: null, by: null, breaking: null }),
      note: 'Verify failed on main at fff0000, pushed without a PR: the harness supervisor gets main green.',
    });
  });

  it.each(['timed_out', 'startup_failure'])(
    'wakes the harness supervisor when Verify is %s',
    (conclusion) => {
      expect(onMainVerified(red({ conclusion })).reason).toEqual(mainRed());
    },
  );

  it.each(['success', 'cancelled', 'skipped'])(
    'does nothing when Verify is %s',
    (conclusion) => {
      expect(onMainVerified(red({ conclusion }))).toEqual({
        note: `Verify on main at fff0000: ${conclusion}.`,
      });
    },
  );
});
