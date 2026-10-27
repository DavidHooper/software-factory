// SessionStart: exports the bot identity for an agent run.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAgentEnv } from '../agent-env.ts';
import { readAppCredentials } from '../github-app-token.ts';
import { sessionEnvLines } from '../session-env.ts';
import { readHookInput, repoRoot, writeOutput } from './io.ts';

const input = await readHookInput();
const agent = readAgentEnv(process.env);

if (agent.agentRun) {
  const root = repoRoot(input);

  // In cloud sessions, Anthropic's proxy applies the connected account's
  // credentials to every GitHub API call, so a bot token would be overridden.
  // Commits can still carry the bot's name (GITHUB_AGENT_GIT_*).
  const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
  const hasAppCredentials =
    !cloud && readAppCredentials(process.env) !== undefined;
  const envFile = process.env.CLAUDE_ENV_FILE;
  const lines = sessionEnvLines({
    tokenCli: join(import.meta.dirname, '..', 'cli', 'gh-token.ts'),
    repoRoot: root,
    hasAppCredentials,
    gitName: process.env.GITHUB_AGENT_GIT_NAME,
    gitEmail: process.env.GITHUB_AGENT_GIT_EMAIL,
  });
  if (envFile && lines.length > 0) {
    appendFileSync(envFile, `${lines.join('\n')}\n`);
  }

  writeOutput({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        `This is an agent run (skill: ${agent.skill ?? 'unknown'}, runner: ${agent.runner ?? 'unknown'}, harness work: ${agent.harness}). Follow docs/agents/runners.md.`,
        cloud
          ? 'GitHub API calls in this cloud session act as the human who connected GitHub, so make every GitHub write (comments, PRs, reviews, labels) with `node .harness/src/cli/github-write.ts <METHOD> <path>`, which relays it to the bot ("Writing" in docs/agents/issue-tracker.md). Mark every comment with `<!-- agent -->`.'
          : hasAppCredentials && envFile
            ? '`GH_TOKEN` is set to the agent bot’s token for every command. Don’t override it.'
            : '`gh` uses the ambient GitHub identity: no agent bot credentials are configured for this run.',
      ].join('\n'),
    },
  });
}
