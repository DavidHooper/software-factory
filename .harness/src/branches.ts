/**
 * How agent work is named (see "Branches, PR titles and commit messages" in
 * docs/agents/issue-tracker.md). Branches are `<type>/<issue>-<slug>`, e.g.
 * `feat/13-health-check`. The dispatcher and the merge gate recognise agent
 * work by these.
 */

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

const TYPES = COMMIT_TYPES.join('|');
/** A slug of one to four lowercase words, at most 30 characters. */
const AGENT_BRANCH = new RegExp(
  `^(${TYPES})/(\\d+)-((?=[a-z0-9-]{1,30}$)[a-z0-9]+(?:-[a-z0-9]+){0,3})$`,
);

/** Agent branches from before the `<type>/` naming; still recognised so open work carries on. */
const isLegacyAgentBranch = (ref: string) => ref.startsWith('claude/');

export interface AgentBranch {
  type: CommitType;
  issue: number;
  slug: string;
}

/** The parts of an agent branch name, or `undefined` if it isn't one. */
export function parseAgentBranch(ref: string): AgentBranch | undefined {
  const match = AGENT_BRANCH.exec(ref.replace(/^refs\/heads\//, ''));
  return match
    ? {
        type: match[1] as CommitType,
        issue: Number(match[2]),
        slug: match[3] ?? '',
      }
    : undefined;
}

export const isAgentBranch = (ref: string): boolean =>
  parseAgentBranch(ref) !== undefined || isLegacyAgentBranch(ref);

/** `Closes #12`, `Fixes: owner/repo#12` or `Resolves https://github.com/owner/repo/issues/12`. */
const CLOSES =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)?#)(\d+)/gi;

/**
 * Every issue in `repo` (`owner/name`) a PR body closes (`Closes #12`), in
 * order. References to other repositories' issues are left out.
 */
export function closedIssueNumbers(
  body: string | null,
  repo: string,
): number[] {
  return [...(body ?? '').matchAll(CLOSES)]
    .filter((match) => {
      const other = match[1] ?? match[2];
      return other === undefined || other.toLowerCase() === repo.toLowerCase();
    })
    .map((match) => Number(match[3]));
}

/**
 * The issue an agent PR is for: its branch's issue (`feat/12-x` → 12), when
 * the body closes it. The branch, not the body, names the issue, so a body
 * that also mentions another issue can't redirect it.
 */
export function prIssue(
  pull: { head: string; body: string | null },
  repo: string,
): number | undefined {
  const issue = parseAgentBranch(pull.head)?.issue;
  return issue !== undefined &&
    closedIssueNumbers(pull.body, repo).includes(issue)
    ? issue
    : undefined;
}
