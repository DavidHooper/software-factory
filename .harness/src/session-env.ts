/** Quotes a value for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface SessionEnvOptions {
  /** Absolute path to the gh-token CLI. */
  tokenCli: string;
  repoRoot: string;
  hasAppCredentials: boolean;
  gitName: string | undefined;
  gitEmail: string | undefined;
}

/**
 * Lines for `CLAUDE_ENV_FILE`, which Claude Code sources before every Bash
 * command. `GH_TOKEN` is computed on each command rather than once, so the
 * one-hour installation token refreshes itself during long runs.
 */
export function sessionEnvLines(options: SessionEnvOptions): string[] {
  const lines: string[] = [];
  if (options.hasAppCredentials) {
    lines.push(
      `export GH_TOKEN="$(node ${shellQuote(options.tokenCli)} ${shellQuote(options.repoRoot)})"`,
    );
  }
  if (options.gitName && options.gitEmail) {
    for (const role of ['AUTHOR', 'COMMITTER']) {
      lines.push(`export GIT_${role}_NAME=${shellQuote(options.gitName)}`);
      lines.push(`export GIT_${role}_EMAIL=${shellQuote(options.gitEmail)}`);
    }
  }
  return lines;
}
