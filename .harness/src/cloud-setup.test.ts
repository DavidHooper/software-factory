import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from './test/expect.ts';
import { HARNESS_DIR, REPO_ROOT } from './test/paths.ts';

const nodeVersion = readFileSync(
  join(HARNESS_DIR, '.node-version'),
  'utf8',
).trim();
const installed = (variable: string) =>
  new RegExp(`^${variable}=(\\S+)$`, 'm').exec(
    readFileSync(join(HARNESS_DIR, 'cloud-setup.sh'), 'utf8'),
  )?.[1];

// The project's own pins, if it uses proto.
const prototools = join(REPO_ROOT, '.prototools');
const pinned = (tool: string) =>
  existsSync(prototools)
    ? new RegExp(`^${tool}\\s*=\\s*"([^"]+)"`, 'm').exec(
        readFileSync(prototools, 'utf8'),
      )?.[1]
    : undefined;

describe('cloud-setup.sh', () => {
  it('installs the Node version the harness pins in .node-version', () => {
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed('NODE_VERSION')).toBe(nodeVersion);
  });

  // moon is the project's tool, not the harness's (see the script): the
  // script installs it only for a project that pins it.
  it('installs the moon version the project pins in .prototools, if any', () => {
    expect(installed('MOON_VERSION')).toBe(pinned('moon'));
  });

  it("pins the same Node as the project's .prototools, if it pins one", () => {
    expect(pinned('node') ?? nodeVersion).toBe(nodeVersion);
  });
});
