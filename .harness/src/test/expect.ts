// The slice of jest's test API the harness tests use, built on node:test and
// node:assert, so the tests run with plain `node --test` and no dependencies.
// It follows jest's semantics for the matchers below; add one here when a test
// needs it.
import { AssertionError } from 'node:assert';
import * as nodeTest from 'node:test';
import { inspect } from 'node:util';

const show = (value: unknown): string =>
  inspect(value, { depth: 8, breakLength: Infinity });

/** `expect.objectContaining` / `expect.arrayContaining`: matches a subset. */
class Containing {
  readonly sample: unknown;
  readonly array: boolean;
  constructor(sample: unknown, array: boolean) {
    this.sample = sample;
    this.array = array;
  }
  matches(actual: unknown): boolean {
    if (this.array) {
      return (
        Array.isArray(actual) &&
        (this.sample as unknown[]).every((want) =>
          actual.some((got) => equals(got, want)),
        )
      );
    }
    const sample = this.sample as Record<string, unknown>;
    return (
      isObject(actual) &&
      Object.keys(sample).every(
        (key) => key in actual && equals(actual[key], sample[key]),
      )
    );
  }
  [inspect.custom](): string {
    return `${this.array ? 'ArrayContaining' : 'ObjectContaining'} ${show(this.sample)}`;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const definedKeys = (value: Record<string, unknown>): string[] =>
  Object.keys(value).filter((key) => value[key] !== undefined);

/** jest's `toEqual`: deep equality that ignores `undefined` properties and class types. */
function equals(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Containing) {
    return expected.matches(actual);
  }
  if (Object.is(actual, expected)) {
    return true;
  }
  if (!isObject(actual) || !isObject(expected)) {
    return false;
  }
  if (actual instanceof Error || expected instanceof Error) {
    return (
      actual instanceof Error &&
      expected instanceof Error &&
      actual.name === expected.name &&
      actual.message === expected.message
    );
  }
  if (actual instanceof Date || expected instanceof Date) {
    return (
      actual instanceof Date &&
      expected instanceof Date &&
      actual.getTime() === expected.getTime()
    );
  }
  if (actual instanceof RegExp || expected instanceof RegExp) {
    return (
      actual instanceof RegExp &&
      expected instanceof RegExp &&
      String(actual) === String(expected)
    );
  }
  if (actual instanceof Map || expected instanceof Map) {
    return (
      actual instanceof Map &&
      expected instanceof Map &&
      actual.size === expected.size &&
      [...expected].every(
        ([key, value]) => actual.has(key) && equals(actual.get(key), value),
      )
    );
  }
  if (actual instanceof Set || expected instanceof Set) {
    return (
      actual instanceof Set &&
      expected instanceof Set &&
      actual.size === expected.size &&
      [...expected].every((value) => [...actual].some((a) => equals(a, value)))
    );
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return false;
  }
  if (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length !== expected.length
  ) {
    return false;
  }
  const keys = definedKeys(expected);
  return (
    definedKeys(actual).length === keys.length &&
    keys.every((key) => equals(actual[key], expected[key]))
  );
}

/** jest's `toMatchObject`: every property of `expected` matches, recursively. */
function matchesObject(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Containing) {
    return expected.matches(actual);
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((want, i) => matchesObject(actual[i], want))
    );
  }
  if (
    isObject(expected) &&
    !(expected instanceof Date) &&
    !(expected instanceof RegExp)
  ) {
    return (
      isObject(actual) &&
      Object.keys(expected).every(
        (key) => key in actual && matchesObject(actual[key], expected[key]),
      )
    );
  }
  return equals(actual, expected);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** jest's `toThrow(expected)` check on an error that was thrown. */
function thrownMatches(error: unknown, expected: unknown): boolean {
  if (expected === undefined) {
    return true;
  }
  if (typeof expected === 'string') {
    return messageOf(error).includes(expected);
  }
  if (expected instanceof RegExp) {
    return expected.test(messageOf(error));
  }
  if (expected instanceof Error) {
    return messageOf(error) === expected.message;
  }
  if (typeof expected === 'function') {
    return error instanceof expected;
  }
  return false;
}

type MockState = {
  mock: { calls: unknown[][] };
  mockReturnValue(value: unknown): Mock;
};
// A mock stands in for any function, as jest.fn() does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;
export type Mock<F extends AnyFunction = AnyFunction> = F & MockState;

/** jest.fn(): a function that records its calls. */
export function fn<F extends AnyFunction = AnyFunction>(impl?: F): Mock<F> {
  let returns: { value: unknown } | undefined;
  const calls: unknown[][] = [];
  const mock = ((...args: unknown[]): unknown => {
    calls.push(args);
    return returns ? returns.value : impl?.(...args);
  }) as Mock<F>;
  mock.mock = { calls };
  mock.mockReturnValue = (value) => {
    returns = { value };
    return mock;
  };
  return mock;
}

const isMock = (value: unknown): value is Mock =>
  typeof value === 'function' && 'mock' in value;

type Matchers<R> = {
  toBe(expected: unknown): R;
  toEqual(expected: unknown): R;
  toMatchObject(expected: unknown): R;
  toBeUndefined(): R;
  toBeDefined(): R;
  toBeNull(): R;
  toContain(item: unknown): R;
  toHaveLength(length: number): R;
  toHaveProperty(key: string): R;
  toMatch(expected: string | RegExp): R;
  toBeGreaterThan(n: number): R;
  toThrow(expected?: unknown): R;
  toHaveBeenCalled(): R;
  toHaveBeenCalledTimes(n: number): R;
  toHaveBeenCalledWith(...args: unknown[]): R;
};

type Check = (actual: unknown, ...args: unknown[]) => boolean;

const CHECKS: Record<keyof Matchers<void>, Check> = {
  toBe: (actual, expected) => Object.is(actual, expected),
  toEqual: (actual, expected) => equals(actual, expected),
  toMatchObject: (actual, expected) => matchesObject(actual, expected),
  toBeUndefined: (actual) => actual === undefined,
  toBeDefined: (actual) => actual !== undefined,
  toBeNull: (actual) => actual === null,
  toContain: (actual, item) =>
    typeof actual === 'string'
      ? actual.includes(item as string)
      : Array.isArray(actual) && actual.includes(item),
  toHaveLength: (actual, length) =>
    (actual as { length?: unknown } | null)?.length === length,
  toHaveProperty: (actual, key) =>
    isObject(actual) && (key as string) in actual,
  toMatch: (actual, expected) =>
    typeof actual === 'string' &&
    (expected instanceof RegExp
      ? expected.test(actual)
      : actual.includes(expected as string)),
  toBeGreaterThan: (actual, n) => (actual as number) > (n as number),
  toThrow: (actual, expected) => {
    if (typeof actual !== 'function') {
      throw new TypeError(
        `toThrow needs a function to call, got ${show(actual)}`,
      );
    }
    try {
      (actual as () => unknown)();
    } catch (error) {
      return thrownMatches(error, expected);
    }
    return false;
  },
  toHaveBeenCalled: (actual) => isMock(actual) && actual.mock.calls.length > 0,
  toHaveBeenCalledTimes: (actual, n) =>
    isMock(actual) && actual.mock.calls.length === n,
  toHaveBeenCalledWith: (actual, ...args) =>
    isMock(actual) && actual.mock.calls.some((call) => equals(call, args)),
};

function matchers(
  actual: unknown,
  negate: boolean,
  checks: Record<string, Check> = CHECKS,
): Matchers<void> {
  const entries = Object.entries(checks).map(([name, check]) => [
    name,
    (...args: unknown[]) => {
      if (check(actual, ...args) === negate) {
        const shown = isMock(actual) ? actual.mock.calls : actual;
        throw new AssertionError({
          message: `expect(${show(shown)})${negate ? '.not' : ''}.${name}(${args.map(show).join(', ')})`,
          actual,
          expected: args[0],
          operator: name,
          stackStartFn: expect,
        });
      }
    },
  ]);
  return Object.fromEntries(entries) as Matchers<void>;
}

/** `.resolves` / `.rejects`: settle the promise, then match the value or error. */
function settle(promise: unknown, reject: boolean): Matchers<Promise<void>> {
  const entries = Object.keys(CHECKS).map((name) => [
    name,
    async (...args: unknown[]) => {
      let outcome: { value: unknown } | { error: unknown };
      try {
        outcome = { value: await promise };
      } catch (error) {
        outcome = { error };
      }
      if ('error' in outcome !== reject) {
        throw new AssertionError({
          message: reject
            ? `expected a rejection, got ${show(outcome)}`
            : `expected no rejection, got ${show(outcome)}`,
          stackStartFn: expect,
        });
      }
      if ('error' in outcome && name === 'toThrow') {
        if (!thrownMatches(outcome.error, args[0])) {
          throw new AssertionError({
            message: `expected rejection ${show(outcome.error)} to match ${show(args[0])}`,
            stackStartFn: expect,
          });
        }
        return;
      }
      const target = 'error' in outcome ? outcome.error : outcome.value;
      const matcher = matchers(target, false) as Record<
        string,
        (...a: unknown[]) => void
      >;
      matcher[name]?.(...args);
    },
  ]);
  return Object.fromEntries(entries) as Matchers<Promise<void>>;
}

type Expectation = Matchers<void> & {
  not: Matchers<void>;
  resolves: Matchers<Promise<void>>;
  rejects: Matchers<Promise<void>>;
};

/** jest's `expect`. */
export function expect(actual: unknown): Expectation {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
    resolves: settle(actual, false),
    rejects: settle(actual, true),
  };
}
// Typed as `never` so they fit wherever the value they match would go.
expect.objectContaining = (sample: object): never =>
  new Containing(sample, false) as never;
expect.arrayContaining = (sample: unknown[]): never =>
  new Containing(sample, true) as never;

/** A test title for one `each` row, with jest's `%s`/`%j`/`%#` and `$key` placeholders. */
function title(name: string, row: unknown, index: number): string {
  if (!Array.isArray(row) && isObject(row) && name.includes('$')) {
    return name.replace(/\$([\w.]+)/g, (_, path: string) => {
      const value = path
        .split('.')
        .reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), row);
      return typeof value === 'string' ? value : show(value);
    });
  }
  const args: unknown[] = Array.isArray(row) ? row : [row];
  let next = 0;
  return name.replace(/%[sdipjo#%]/g, (token) => {
    if (token === '%%') return '%';
    if (token === '%#') return String(index);
    const value = args[next++];
    if (token === '%j') return JSON.stringify(value) ?? 'undefined';
    if (token === '%s' && typeof value === 'string') return value;
    return show(value);
  });
}

type Body = () => void | Promise<void>;
type Run = (name: string, body: Body) => unknown;

// Typed the way @types/jest types `each`: a row that's an array is spread into
// the callback's arguments, any other row is passed as its one argument.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Each = {
  <T extends any[] | [any]>(
    table: readonly T[],
  ): (name: string, body: (...args: T) => void | Promise<void>) => void;
  <T extends readonly any[]>(
    table: readonly T[],
  ): (name: string, body: (...args: [...T]) => void | Promise<void>) => void;
  <T>(
    table: readonly T[],
  ): (name: string, body: (arg: T) => void | Promise<void>) => void;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const each =
  (run: Run): Each =>
  (table: readonly unknown[]) =>
  (name: string, body: (...args: unknown[]) => void | Promise<void>) => {
    table.forEach((row, index) => {
      const args = Array.isArray(row) ? (row as unknown[]) : [row];
      run(title(name, row, index), () => body(...args));
    });
  };

/** node:test's `it`, plus jest's `it.each`. */
export const it: Run & { each: Each } = Object.assign(
  (name: string, body: Body) => nodeTest.it(name, body),
  { each: each((name, body) => nodeTest.it(name, body)) },
);

/** node:test's `describe`, plus jest's `describe.each`. */
export const describe: Run & { each: Each } = Object.assign(
  (name: string, body: Body) => nodeTest.describe(name, body),
  { each: each((name, body) => nodeTest.describe(name, body)) },
);
