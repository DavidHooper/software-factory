// A fixture run of the harness supervisor's merge judgement (ADR 0003, #41):
// an agent PR that passes the merge gate with review threads still open is
// merged in one run, its threads replied to, through the same functions the
// dispatcher, the supervisor's gate check and the relay use.
import { randomUUID } from 'node:crypto';
import {
  isMergeCandidate,
  mergeBody,
  mergeGate,
  onMergeCheck,
  wakeSupervisor,
  type PullFacts,
} from './dispatch.ts';
import { applyWrite, parseRelayPayload, type RelayWrite } from './relay.ts';
import { describe, expect, it } from './test/expect.ts';

const repo = 'example/repo';
const base = `repos/${repo}`;
const head = 'abc1234def'.padEnd(40, '0');

/** PR #12: green, its review run finished at its head. */
const pull: PullFacts = {
  number: 12,
  state: 'open',
  headRef: 'feat/7-login',
  headSha: head,
  author: 'example-agent[bot]',
  title: 'feat(api): add login',
  body: '## Summary\n\nAdds login.\n\n## Commit message\n\n```text\nAdd a login endpoint.\n\nCloses #7\n```',
  labels: [],
  agentReviews: [head],
  mergeable: true,
  issueState: 'open',
  checkRuns: [
    { id: 1, name: 'Verify', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'Agent review', status: 'completed', conclusion: 'success' },
  ],
};

/** GitHub, as far as this run touches it, behind the relay. */
class FakeGitHub {
  replies = new Map<number, string[]>([
    [201, []],
    [202, []],
  ]);
  merges: { path: string; input: unknown }[] = [];

  private gh = (args: string[], input?: unknown): string => {
    const path = args[2] ?? '';
    const body = input as Record<string, unknown>;
    const reply = /pulls\/12\/comments\/(\d+)\/replies$/.exec(path);
    if (reply) {
      this.replies.get(Number(reply[1]))?.push(String(body.body));
    } else if (path.endsWith('/pulls/12/merge')) {
      this.merges.push({ path, input });
      return JSON.stringify({ merged: true, sha: 'f00', message: 'Merged' });
    } else {
      throw new Error(`unexpected ${path}`);
    }
    return '{}';
  };

  /** The relay: one write per event, made as it was sent. */
  relay(write: RelayWrite): unknown {
    return applyWrite(parseRelayPayload({ id: randomUUID(), write }, repo), {
      gh: this.gh,
      reviewers: [],
      finishRun: () => undefined,
    });
  }
}

describe('a PR with only suggestion threads, merged in one harness supervisor run', () => {
  it('wakes the harness supervisor, replies to the threads, and merges', () => {
    const github = new FakeGitHub();

    // The review's check finishing wakes the harness supervisor: open
    // threads aren't part of the merge gate.
    expect(isMergeCandidate(pull, { paused: false })).toBe(true);
    const gate = onMergeCheck(head, [pull], { paused: false });
    expect(
      wakeSupervisor(gate.reasons, { supervisorConfigured: true }).wake,
    ).toEqual({
      skill: 'supervise',
      paused: false,
      reasons: [{ kind: 'mergeable', number: 12 }],
    });

    // A line in each thread on why it can wait.
    for (const thread of [201, 202]) {
      github.relay({
        method: 'POST',
        path: `${base}/pulls/12/comments/${thread}/replies`,
        body: { body: 'Naming: can wait for #99.' },
      });
    }

    // The supervisor checks the gate itself, then sends the merge.
    const merge = mergeGate(pull).merge;
    expect(merge).toBeDefined();
    expect(
      github.relay({
        method: 'PUT',
        path: `${base}/pulls/12/merge`,
        body: mergeBody(merge!),
      }),
    ).toMatchObject({ merged: true });

    expect([...github.replies.values()]).toEqual([
      ['Naming: can wait for #99.'],
      ['Naming: can wait for #99.'],
    ]);
    expect(github.merges).toEqual([
      {
        path: `${base}/pulls/12/merge`,
        input: {
          merge_method: 'squash',
          sha: head,
          commit_title: 'feat(api): add login (#12)',
          commit_message: 'Add a login endpoint.\n\nCloses #7',
        },
      },
    ]);
  });
});
