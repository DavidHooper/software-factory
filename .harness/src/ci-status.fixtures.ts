import type { CheckRun } from './ci-status.ts';

interface TimedCheckRun extends CheckRun {
  started_at: string;
  completed_at: string | null;
}

/**
 * PR #79's head (4b5258c) as the dispatcher saw it when Verify finished
 * (2026-10-23T03:30:36Z), copied from the check-runs API (#83). `opened` and
 * `labeled` started two Harness guard runs together, and the guard's
 * concurrency group cancelled the first. The later, skipped run has the
 * higher id, but finished "before" it started and at the same second as the
 * cancelled one, so only the id orders them.
 */
export const pr79CheckRuns: TimedCheckRun[] = [
  {
    id: 120224274722,
    name: 'Harness guard',
    status: 'completed',
    conclusion: 'cancelled',
    started_at: '2026-10-23T03:29:47Z',
    completed_at: '2026-10-23T03:29:48Z',
  },
  {
    id: 120224275178,
    name: 'Verify',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-23T03:29:50Z',
    completed_at: '2026-10-23T03:30:35Z',
  },
  {
    id: 120224276027,
    name: 'Route',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-23T03:29:51Z',
    completed_at: '2026-10-23T03:30:21Z',
  },
  {
    id: 120224276242,
    name: 'Queue the agent review',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-23T03:29:51Z',
    completed_at: '2026-10-23T03:30:03Z',
  },
  {
    id: 120224279827,
    name: 'Route',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-23T03:29:51Z',
    completed_at: '2026-10-23T03:30:21Z',
  },
  {
    id: 120224280868,
    name: 'Cancel agent runs for the PR',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:29:49Z',
    completed_at: '2026-10-23T03:29:48Z',
  },
  {
    id: 120224280902,
    name: 'Queue the agent review',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:29:49Z',
    completed_at: '2026-10-23T03:29:48Z',
  },
  {
    id: 120224280912,
    name: 'Cancel agent runs for the issue',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:29:49Z',
    completed_at: '2026-10-23T03:29:48Z',
  },
  {
    id: 120224281897,
    name: 'Harness guard',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:29:49Z',
    completed_at: '2026-10-23T03:29:48Z',
  },
  {
    id: 120224330334,
    name: 'Agent review',
    status: 'queued',
    conclusion: null,
    started_at: '2026-10-23T03:29:59Z',
    completed_at: null,
  },
  {
    id: 120224444770,
    name: 'Actions · ${{ matrix.run.skill }} #${{ matrix.run.number }}',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:30:21Z',
    completed_at: '2026-10-23T03:30:21Z',
  },
  {
    id: 120224445039,
    name: 'Cloud · ${{ matrix.run.skill }} #${{ matrix.run.number }}',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:30:21Z',
    completed_at: '2026-10-23T03:30:21Z',
  },
  {
    id: 120224445070,
    name: 'Settle queued reviews',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:30:21Z',
    completed_at: '2026-10-23T03:30:21Z',
  },
  {
    id: 120224445591,
    name: 'Wake the harness supervisor',
    status: 'completed',
    conclusion: 'skipped',
    started_at: '2026-10-23T03:30:21Z',
    completed_at: '2026-10-23T03:30:21Z',
  },
];
