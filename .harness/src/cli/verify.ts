// Runs the project's verify command (`verify` in harness.config.json) from
// the project's root, so skills needn't know what it is.
// Usage: node .harness/src/cli/verify.ts. Exits with the command's code.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { config, configPath, runVerify } from '../config.ts';

console.log(`Running ${config.verify}`);
process.exit(runVerify(config, dirname(configPath()), spawnSync));
