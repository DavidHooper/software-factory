// Prints one value from the project's harness.config.json, for skills.
// Usage: node .harness/src/cli/config.ts <key>, e.g. `retros` (prints
// true or false) or `routines.supervisor`.
import { config, configValue } from '../config.ts';

const key = process.argv[2];
if (!key) {
  console.error('Usage: node .harness/src/cli/config.ts <key>');
  process.exit(2);
}
console.log(configValue(config, key));
