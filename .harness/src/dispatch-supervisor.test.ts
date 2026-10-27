import { AGENT_BOT, describeOutcome } from './agent-status.ts';
import {
  urgentReasons,
  wakeSupervisor,
  type SupervisorConfig,
  type WakeReason,
} from './dispatch.ts';
import { describe, expect, it } from './test/expect.ts';

const configured: SupervisorConfig = { supervisorConfigured: true };

describe('urgentReasons', () => {
  it('wakes the harness supervisor when agent-blocked is added', () => {
    expect(
      urgentReasons({ kind: 'labeled', label: 'agent-blocked', number: 7 }),
    ).toEqual([{ kind: 'blocked', number: 7 }]);
  });

  it('ignores other labels', () => {
    expect(
      urgentReasons({
        kind: 'labeled',
        label: 'needs-review',
        number: 7,
      }),
    ).toEqual([]);
  });

  const comment = (login: string, association = 'COLLABORATOR') => ({
    kind: 'comment' as const,
    number: 190,
    comment: { user: { login }, author_association: association },
  });

  it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])(
    'wakes it when a person (%s) comments on an issue or PR, whatever its labels',
    (association) => {
      expect(urgentReasons(comment('dhooper', association))).toEqual([
        { kind: 'comment', number: 190 },
      ]);
    },
  );

  it.each([AGENT_BOT, 'github-actions[bot]'])(
    "doesn't when %s comments, so its own replies can't loop",
    (login) => {
      expect(urgentReasons(comment(login))).toEqual([]);
    },
  );

  it.each(['NONE', 'CONTRIBUTOR'])(
    "doesn't when someone who isn't a collaborator (%s) comments",
    (association) => {
      expect(urgentReasons(comment('passer-by', association))).toEqual([]);
    },
  );

  const check = (name: string, conclusion: string, app = 'example-agent') => ({
    kind: 'check' as const,
    name,
    app,
    conclusion,
    pulls: [12],
  });

  const outcomes = [
    'pr-opened',
    'reviewed',
    'blocked',
    'waiting',
    'abandoned',
    'supervised-run',
    'paused',
    'something-else',
  ];

  it.each(['Agent review'])(
    'wakes it when GitHub marks an abandoned run stale on its %s check',
    (name) => {
      expect(urgentReasons(check(name, 'stale'))).toEqual([
        { kind: 'run-failed', number: 12, check: name, conclusion: 'stale' },
      ]);
    },
  );

  it.each(outcomes)(
    "doesn't for Agent review finishing from a %s retro",
    (outcome) => {
      const { conclusion } = describeOutcome({ skill: 'review-pr', outcome });
      expect(urgentReasons(check('Agent review', conclusion))).toEqual([]);
    },
  );

  it.each([
    ['Agent review', 'someone-else'],
    ['Verify', 'example-agent'],
  ])("doesn't for %s from %s", (name, app) => {
    expect(urgentReasons(check(name, 'stale', app))).toEqual([]);
  });
});

describe('wakeSupervisor', () => {
  const reasons: WakeReason[] = [{ kind: 'blocked', number: 7 }];

  it('fires the harness supervisor with what woke it', () => {
    expect(wakeSupervisor(reasons, configured)).toEqual({
      wake: { skill: 'supervise', paused: false, reasons },
      notes: ['Waking the harness supervisor: #7 is agent-blocked.'],
    });
  });

  it("says in every payload that it isn't paused", () => {
    expect(
      wakeSupervisor(reasons, { ...configured, paused: false }).wake,
    ).toMatchObject({ paused: false });
  });

  it('fires nothing for an event with nothing urgent', () => {
    expect(wakeSupervisor([], configured)).toEqual({ notes: [] });
  });

  it('fires nothing while paused', () => {
    expect(wakeSupervisor(reasons, { ...configured, paused: true })).toEqual({
      notes: [
        "Didn't wake the harness supervisor (#7 is agent-blocked): AGENTS_PAUSED is on.",
      ],
    });
  });

  it("fires nothing while its routine's secrets aren't set", () => {
    expect(wakeSupervisor(reasons, { supervisorConfigured: false })).toEqual({
      notes: [
        "Didn't wake the harness supervisor (#7 is agent-blocked): it isn't configured yet (the ROUTINE_HARNESS_SUPERVISOR_URL and _TOKEN secrets aren't set; see docs/agents/cloud-routines.md).",
      ],
    });
  });

  it('describes each kind of reason', () => {
    expect(
      wakeSupervisor(
        [
          {
            kind: 'run-failed',
            number: 12,
            check: 'Agent review',
            conclusion: 'stale',
          },
          {
            kind: 'main-red',
            sha: 'abc1234def',
            runUrl: 'https://github.com/o/r/actions/runs/9',
            pr: 13,
            by: 'merge-gate',
            breaking: { sha: 'fff0000aaa', pr: 12 },
          },
          { kind: 'fire-failed', number: 65, skill: 'implement' },
          { kind: 'red-after-review', number: 14 },
          { kind: 'comment', number: 190 },
        ],
        configured,
      ).notes,
    ).toEqual([
      "Waking the harness supervisor: Agent review on #12 ended stale; Verify failed on main at abc1234 (#13's merge; main broke at fff0000, #12's merge); the routine fire for /implement on #65 failed, so it didn't start; #14 is red after its review runs; a person commented on #190.",
    ]);
  });

  it('describes a mergeable reason', () => {
    expect(
      wakeSupervisor([{ kind: 'mergeable', number: 12 }], configured).notes,
    ).toEqual([
      "Waking the harness supervisor: #12's merge is the harness supervisor's to decide.",
    ]);
  });
});
