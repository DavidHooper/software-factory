// Every harness test runs against the neutral fixture config, not the
// project's, so the tests pass unchanged in any project (`node --import`, see docs/agents/harness.md).
import { join } from 'node:path';

process.env.HARNESS_CONFIG = join(import.meta.dirname, 'harness.config.json');
