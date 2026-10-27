import { sessionEnvLines, shellQuote } from './session-env.ts';
import { describe, expect, it } from './test/expect.ts';

const options = {
  tokenCli: '/repo/.harness/src/cli/gh-token.ts',
  repoRoot: "/repo's",
  hasAppCredentials: true,
  gitName: undefined,
  gitEmail: undefined,
};

describe('shellQuote', () => {
  it('escapes single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('sessionEnvLines', () => {
  it('computes GH_TOKEN from the token CLI on every command', () => {
    expect(sessionEnvLines(options)).toEqual([
      `export GH_TOKEN="$(node '/repo/.harness/src/cli/gh-token.ts' '/repo'\\''s')"`,
    ]);
  });

  it('sets nothing without App credentials', () => {
    expect(sessionEnvLines({ ...options, hasAppCredentials: false })).toEqual(
      [],
    );
  });

  it('sets the git identity when given', () => {
    expect(
      sessionEnvLines({
        ...options,
        hasAppCredentials: false,
        gitName: 'bot[bot]',
        gitEmail: 'bot@x',
      }),
    ).toEqual([
      `export GIT_AUTHOR_NAME='bot[bot]'`,
      `export GIT_AUTHOR_EMAIL='bot@x'`,
      `export GIT_COMMITTER_NAME='bot[bot]'`,
      `export GIT_COMMITTER_EMAIL='bot@x'`,
    ]);
  });
});
