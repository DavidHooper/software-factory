// SessionStart, cloud sessions only. The environment's setup script
// (cloud-setup.sh) installs the pinned toolchain, but Claude Code doesn't read
// /etc/profile.d, so the image's Node 22 stays first on PATH. Put proto's
// shims first for every Bash command, then install the project's npm
// dependencies if it has any, since each cloud session starts from a fresh
// clone. The harness itself needs none.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readHookInput, repoRoot } from './io.ts';

const input = await readHookInput();
const root = repoRoot(input);

if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  const proto = join(homedir(), '.proto');
  const protoPath = `${join(proto, 'shims')}:${join(proto, 'bin')}`;
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && existsSync(proto)) {
    appendFileSync(envFile, `export PATH="${protoPath}:$PATH"\n`);
  }

  if (
    existsSync(join(root, 'package-lock.json')) &&
    !existsSync(join(root, 'node_modules'))
  ) {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: root,
      env: { ...process.env, PATH: `${protoPath}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
}
