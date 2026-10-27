// GitHub facts the dispatcher (cli/dispatch.ts) decides from, read with
// `gh api`, so the merge gate has one definition of them: the harness
// supervisor checks the gate on the same reads (cli/merge-gate.ts).
import { execFileSync } from 'node:child_process';
import { isAgentReview } from '../agent-status.ts';
import type { CheckRun } from '../ci-status.ts';
import type { IssueFacts, PullFacts, VerifyRun } from '../dispatch.ts';
import { prIssue } from '../branches.ts';
import { readPages } from '../github-pages.ts';
import {
  retryRateLimited,
  type RateLimitBudget,
  type RetryDeps,
} from '../rate-limit.ts';

export interface GitHubIssue {
  number: number;
  state: 'open' | 'closed';
  state_reason?: string | null;
  body: string | null;
  labels: { name: string }[];
  issue_dependencies_summary?: { blocked_by?: number };
}

export interface GitHubPull {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string | null;
  /** Only on a single PR's endpoint, and `null` while GitHub works it out. */
  mergeable?: boolean | null;
  labels: { name: string }[];
  head: { ref: string; sha: string };
  user: { login: string } | null;
  /** Only on a single PR's endpoint. */
  merged_by?: { login: string } | null;
  merge_commit_sha?: string | null;
}

interface GitHubReview {
  id: number;
  commit_id: string;
  state: string;
  body: string | null;
  user: { login: string } | null;
}

/** A required environment variable, throwing if it's unset or empty. */
export const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

// A PR's review comments each carry their diff hunk, so one PR's comments can
// pass execFileSync's 1 MiB default and crash the read with ENOBUFS (#66).
export const GH_MAX_BUFFER = 256 * 1024 * 1024;

interface RateLimits {
  resources: Record<string, { remaining: number; reset: number } | undefined>;
}

/**
 * When the exhausted REST rate limit resets, in epoch milliseconds, from the
 * `rate_limit` endpoint (which doesn't count against it): `undefined` if it
 * isn't exhausted or can't be read.
 */
function rateLimitReset(): number | undefined {
  try {
    const { resources } = JSON.parse(
      execFileSync('gh', ['api', 'rate_limit'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as RateLimits;
    const limit = resources.core;
    return limit?.remaining === 0 ? limit.reset * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Blocks the thread for `ms` milliseconds: `api()` is synchronous. */
const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** The process's waits for retried reads: each dispatcher run is one process. */
const rateLimitBudget: RateLimitBudget = { waitedMs: 0 };

/** `retryRateLimited`'s real clock, sharing the process's budget. */
const retryDeps = (resetAt: () => number | undefined): RetryDeps => ({
  budget: rateLimitBudget,
  now: Date.now,
  sleep: sleepSync,
  resetAt,
});

/**
 * `gh api path ...args`, parsed. A read that hits the rate limit is retried
 * once it resets, and one that gets a transient server error (HTTP 5xx) after
 * a short backoff, while the process has waited less than
 * `MAX_RATE_LIMIT_WAIT_MS` in all (`retryRateLimited`).
 */
export function api<T>(path: string, ...args: string[]): T {
  return retryRateLimited(
    () =>
      JSON.parse(
        execFileSync('gh', ['api', path, ...args], {
          encoding: 'utf8',
          maxBuffer: GH_MAX_BUFFER,
        }),
      ) as T,
    retryDeps(rateLimitReset),
  );
}

/** Every page of a list endpoint, as one list. */
export const listAll = <T>(path: string): T[] =>
  readPages(path, (page) => api<T[]>(page));

/** Every check run on a commit, from all its pages. */
const checkRunsOf = (repo: string, sha: string): CheckRun[] =>
  readPages(
    `repos/${repo}/commits/${sha}/check-runs`,
    (page) => api<{ check_runs: CheckRun[] }>(page),
    (page) => page.check_runs,
  );

export const labelNames = (item: { labels: { name: string }[] }) =>
  item.labels.map((label) => label.name);

/** Readers for the facts of `repo`'s issues, PRs and Verify runs. */
export function githubFacts(repo: string, defaultBranch: string) {
  function issueFacts(number: number): IssueFacts {
    const issue = api<GitHubIssue>(`repos/${repo}/issues/${number}`);
    return {
      number,
      state: issue.state,
      labels: labelNames(issue),
      blockedBy: issue.issue_dependencies_summary?.blocked_by ?? 0,
    };
  }

  /** The issue an agent PR is for (`prIssue`). */
  const pullIssue = (pull: GitHubPull): number | undefined =>
    prIssue({ head: pull.head.ref, body: pull.body }, repo);

  /** The facts of a PR's issue (`pullIssue`): its labels count as the PR's. */
  function linkedIssue(pull: GitHubPull): IssueFacts | undefined {
    const number = pullIssue(pull);
    return number === undefined ? undefined : issueFacts(number);
  }

  /**
   * A PR from its own endpoint. GitHub works `mergeable` out in the background
   * after a push and reports `null` until then, so keep asking for up to 30
   * seconds.
   */
  function fetchPull(number: number): GitHubPull {
    let pull = api<GitHubPull>(`repos/${repo}/pulls/${number}`);
    for (let attempt = 0; attempt < 6 && pull.mergeable === null; attempt++) {
      sleepSync(5000);
      pull = api<GitHubPull>(`repos/${repo}/pulls/${number}`);
    }
    return pull;
  }

  const onMainCache = new Map<string, boolean>();
  let mainSha: string | undefined;

  /**
   * Commit `sha` is on `main` (see `MainCommitFacts.onMain`). It compares
   * against the branch's own commit, since a bare `main` could name a tag.
   */
  function isOnMain(sha: string): boolean {
    let onMain = onMainCache.get(sha);
    if (onMain === undefined) {
      mainSha ??= api<{ object: { sha: string } }>(
        `repos/${repo}/git/ref/heads/${defaultBranch}`,
      ).object.sha;
      const { status } = api<{ status: string }>(
        `repos/${repo}/compare/${mainSha}...${sha}`,
      );
      onMain = status === 'behind' || status === 'identical';
      onMainCache.set(sha, onMain);
    }
    return onMain;
  }

  /** The latest finished Verify push runs on `main`, newest first. */
  const mainRuns = (): VerifyRun[] =>
    api<{
      workflow_runs: { head_sha: string; conclusion: string | null }[];
    }>(
      `repos/${repo}/actions/workflows/verify.yml/runs?branch=${defaultBranch}&event=push&status=completed&per_page=100`,
    ).workflow_runs.map((run) => ({
      sha: run.head_sha,
      conclusion: run.conclusion,
      onMain: isOnMain(run.head_sha),
    }));

  function pullFacts(number: number): PullFacts {
    const pull = fetchPull(number);
    const reviews = listAll<GitHubReview>(
      `repos/${repo}/pulls/${number}/reviews`,
    );
    const issue = linkedIssue(pull);
    const checkRuns = checkRunsOf(repo, pull.head.sha);
    return {
      number,
      state: pull.state,
      headRef: pull.head.ref,
      headSha: pull.head.sha,
      author: pull.user?.login ?? '',
      title: pull.title,
      body: pull.body ?? '',
      labels: [...labelNames(pull), ...(issue?.labels ?? [])],
      issueState: issue?.state ?? null,
      checkRuns,
      agentReviews: reviews
        .filter(isAgentReview)
        .map((review) => review.commit_id),
      mergeable: pull.mergeable ?? null,
    };
  }

  return { issueFacts, pullIssue, isOnMain, mainRuns, pullFacts };
}
