import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from './test/expect.ts';
import { REPO_ROOT } from './test/paths.ts';

const SKILLS = join(REPO_ROOT, '.agents/skills');

/** Each skill's `## ` and `### ` sections (its steps and duties), with the skill's name. */
const steps = readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    let text: string;
    try {
      text = readFileSync(join(SKILLS, entry.name, 'SKILL.md'), 'utf8');
    } catch {
      return [];
    }
    return text.split(/^(?=###? )/m).map((step) => ({
      skill: entry.name,
      title: step.split('\n')[0] ?? '',
      step,
    }));
  });

describe('skills', () => {
  it('have steps to check', () => {
    expect(steps.some((s) => s.step.includes('wait-for-ci.ts'))).toBe(true);
  });

  // github-write sends each write at once (relay.ts): there's no queue to flush.
  it.each(steps)('$skill "$title" has no flush step', ({ step }) => {
    expect(step).not.toContain('github-write.ts flush');
  });

  // The session's permission check runs the supervisor's merge only under the
  // allow rule in .claude/settings.json, so the skill's command must match it.
  it('/supervise merges with the command its allow rule matches', () => {
    const settings = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude/settings.json'), 'utf8'),
    ) as { permissions: { allow: string[] } };
    const rule = settings.permissions.allow
      .map((r) => /^Bash\((.*)\)$/.exec(r)?.[1] ?? '')
      .find((r) => r.includes('/merge') || r.includes('pulls/*'));
    const merge = steps
      .filter((s) => s.skill === 'supervise')
      .map(
        (s) =>
          /`(node \.harness\/src\/cli\/github-write\.ts PUT [^`]*)`/.exec(
            s.step,
          )?.[1],
      )
      .find((command) => command !== undefined);
    expect(rule).toBeDefined();
    expect(merge).toBeDefined();
    const pattern = new RegExp(
      `^${(rule ?? '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`,
    );
    expect(merge?.replace('<n>', '12')).toMatch(pattern);
  });
});
