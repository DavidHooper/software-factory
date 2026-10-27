import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_FILE,
  config,
  configValue,
  findConfig,
  loadConfig,
  parseConfig,
  runVerify,
} from './config.ts';
import { describe, expect, fn, it } from './test/expect.ts';

const valid = {
  bot: 'acme-agent',
  routines: { coding: 'acme-coding', supervisor: 'acme-supervisor' },
  environments: { coding: 'acme-env', supervisor: 'acme-sup-env' },
  verify: 'make check',
  retros: true,
};

describe('parseConfig', () => {
  it('reads every project-specific value from the file', () => {
    expect(parseConfig(JSON.stringify(valid), 'x.json')).toEqual(valid);
  });

  it('leaves retros off when the file leaves it out', () => {
    const text = JSON.stringify({ ...valid, retros: undefined });
    expect(parseConfig(text, 'x.json').retros).toBe(false);
  });

  it.each([
    ['a missing bot', { ...valid, bot: undefined }, 'bot'],
    ['an empty verify', { ...valid, verify: '' }, 'verify'],
    [
      'a missing routine',
      { ...valid, routines: { coding: 'c' } },
      'routines.supervisor',
    ],
    ['a non-boolean retros', { ...valid, retros: 'yes' }, 'retros'],
  ])('refuses %s, naming the key', (_, value, key) => {
    expect(() => parseConfig(JSON.stringify(value), 'x.json')).toThrow(key);
  });

  it('names the value it refused', () => {
    expect(() =>
      parseConfig(JSON.stringify({ ...valid, retros: 'yes' }), 'x.json'),
    ).toThrow('x.json: `retros` must be true or false, not "yes"');
    expect(() =>
      parseConfig(JSON.stringify({ ...valid, bot: undefined }), 'x.json'),
    ).toThrow('not missing');
  });

  it('refuses a file that is not JSON, naming it', () => {
    expect(() => parseConfig('{', 'x.json')).toThrow('x.json');
  });
});

describe('findConfig', () => {
  it(`finds ${CONFIG_FILE} in the nearest directory above`, () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-config-'));
    writeFileSync(join(root, CONFIG_FILE), '{}');
    expect(findConfig(join(root, 'a', 'b'))).toBe(join(root, CONFIG_FILE));
  });
});

describe('loadConfig', () => {
  it("parses this repository's own config file", () => {
    const real = loadConfig(findConfig(import.meta.dirname));
    expect(real.bot).not.toBe('');
  });
});

describe('the loaded config', () => {
  // The tests run against src/test/harness.config.json (`node --import`, see docs/agents/harness.md).
  it('comes from HARNESS_CONFIG when it is set', () => {
    expect(config.bot).toBe('example-agent');
    expect(config.routines.coding).toBe('example-coding');
  });
});

describe('configValue', () => {
  it.each([
    ['bot', 'acme-agent'],
    ['verify', 'make check'],
    ['retros', 'true'],
    ['routines.supervisor', 'acme-supervisor'],
  ])('prints %s', (key, printed) => {
    expect(configValue(valid, key)).toBe(printed);
  });

  it('refuses an unknown key', () => {
    expect(() => configValue(valid, 'nope')).toThrow('nope');
  });
});

describe('runVerify', () => {
  it('runs the configured verify command from the project root, passing on its exit code', () => {
    const spawn = fn(() => ({ status: 3 }));
    expect(runVerify(valid, '/project', spawn)).toBe(3);
    expect(spawn).toHaveBeenCalledWith('make check', {
      cwd: '/project',
      shell: true,
      stdio: 'inherit',
    });
  });

  it('fails when the command was killed', () => {
    expect(runVerify(valid, '/project', () => ({ status: null }))).toBe(1);
  });
});
