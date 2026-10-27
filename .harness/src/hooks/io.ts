/** The fields of Claude Code's hook input that these hooks use. */
export interface HookInput {
  cwd?: string;
  prompt?: string;
  user_prompt?: string;
}

export async function readHookInput(): Promise<HookInput> {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += String(chunk);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** The repo root: where the session started, not wherever the agent has `cd`-ed to. */
export function repoRoot(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
}

export function writeOutput(output: object): void {
  process.stdout.write(JSON.stringify(output));
}
