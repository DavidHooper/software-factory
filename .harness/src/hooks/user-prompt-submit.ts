// UserPromptSubmit: logs each human message in an agent run for `/retro`.
import { appendFileSync, mkdirSync } from 'node:fs';
import { readAgentEnv } from '../agent-env.ts';
import { isHumanPrompt } from '../interjections.ts';
import { runPaths } from '../run-state.ts';
import { readHookInput, repoRoot } from './io.ts';

const input = await readHookInput();
const agent = readAgentEnv(process.env);

if (agent.agentRun) {
  const paths = runPaths(repoRoot(input));
  mkdirSync(paths.dir, { recursive: true });

  // Sub-agent reports and task notifications arrive as prompts too; only a
  // human's message is an interjection.
  const prompt = input.user_prompt ?? input.prompt ?? '';
  if (isHumanPrompt(prompt)) {
    appendFileSync(
      paths.interjections,
      `${JSON.stringify({ at: new Date().toISOString(), prompt: prompt.slice(0, 4000) })}\n`,
    );
  }
}
