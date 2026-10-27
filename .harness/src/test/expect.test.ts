import { throws } from 'node:assert';
import { describe, expect, fn, it } from './expect.ts';

// Each matcher must fail as well as pass, or every test using it passes
// whatever the code does.
const fails = (assertion: () => void) => throws(assertion);

describe('expect', () => {
  it('toEqual ignores undefined properties but not values', () => {
    expect({ a: 1, b: undefined }).toEqual({ a: 1 });
    expect([1, { a: [2] }]).toEqual([1, { a: [2] }]);
    fails(() => expect({ a: 1 }).toEqual({ a: 2 }));
    fails(() => expect([1, 2]).toEqual([1]));
    fails(() => expect({ a: 1, b: 2 }).toEqual({ a: 1 }));
    fails(() => expect(new Map([['a', 1]])).toEqual(new Map([['a', 2]])));
    fails(() => expect('1').toEqual(1));
    expect(new Error('a')).toEqual(new Error('a'));
    fails(() => expect(new Error('a')).toEqual(new Error('b')));
    fails(() => expect(new Error('a')).toEqual({}));
  });

  it('toMatchObject matches a subset, with arrays matched whole', () => {
    expect({ a: 1, b: { c: 2, d: 3 } }).toMatchObject({ b: { c: 2 } });
    expect({ a: [{ b: 1, c: 2 }] }).toMatchObject({ a: [{ b: 1 }] });
    fails(() => expect({ a: 1 }).toMatchObject({ a: 1, b: 2 }));
    fails(() => expect({ a: [1, 2] }).toMatchObject({ a: [1] }));
  });

  it('objectContaining and arrayContaining match a subset', () => {
    expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }));
    expect([1, 2, 3]).toEqual(expect.arrayContaining([3, 1]));
    fails(() => expect({ a: 1 }).toEqual(expect.objectContaining({ a: 2 })));
    fails(() => expect([1]).toEqual(expect.arrayContaining([2])));
    // Like jest, each property of objectContaining must equal, not match.
    fails(() =>
      expect({ a: { b: 1, c: 2 } }).toEqual(
        expect.objectContaining({ a: { b: 1 } }),
      ),
    );
  });

  it('negates with not', () => {
    expect(1).not.toBe(2);
    fails(() => expect(1).not.toBe(1));
    fails(() => expect('abc').not.toContain('b'));
  });

  it('checks the simple matchers both ways', () => {
    expect('abc').toContain('b');
    expect(['a']).toContain('a');
    expect('abc').toHaveLength(3);
    expect('abc').toMatch(/b/);
    expect({ a: 1 }).toHaveProperty('a');
    expect(2).toBeGreaterThan(1);
    expect(null).toBeNull();
    expect(0).toBeDefined();
    fails(() => expect(['a']).toContain('b'));
    fails(() => expect([1]).toHaveLength(2));
    fails(() => expect('abc').toMatch('d'));
    fails(() => expect(1).toBeGreaterThan(1));
    fails(() => expect(undefined).toBeDefined());
    fails(() => expect(0).toBeUndefined());
  });

  it('toThrow matches the message by substring, pattern or error', () => {
    const boom = () => {
      throw new Error('it went boom');
    };
    expect(boom).toThrow();
    expect(boom).toThrow('went');
    expect(boom).toThrow(/boom$/);
    expect(boom).toThrow(new Error('it went boom'));
    expect(() => undefined).not.toThrow();
    fails(() => expect(boom).toThrow('fizz'));
    fails(() => expect(() => undefined).toThrow());
    fails(() => expect('not a function').toThrow());
    fails(() => expect('not a function').not.toThrow());
  });

  it('resolves and rejects settle the promise first', async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1);
    await expect(Promise.reject(new Error('no'))).rejects.toThrow(/no/);
    await expect(expect(Promise.resolve(1)).resolves.toBe(2)).rejects.toThrow();
    await expect(
      expect(Promise.resolve(1)).rejects.toThrow(),
    ).rejects.toThrow();
  });

  it('fn records calls and returns its value', () => {
    const mock = fn((a: number) => a + 1);
    expect(mock(1)).toBe(2);
    expect(mock).toHaveBeenCalledWith(1);
    expect(mock).toHaveBeenCalledTimes(1);
    fails(() => expect(mock).toHaveBeenCalledWith(2));
    fails(() => expect(fn()).toHaveBeenCalled());
    expect(fn().mockReturnValue('x')()).toBe('x');
  });
});

describe('it.each', () => {
  const seen: unknown[][] = [];
  it.each([
    [1, 'a'],
    [2, 'b'],
  ])('spreads row %s, %s into the arguments', (n, s) => {
    seen.push([n, s]);
  });
  it.each([{ name: 'x' }])('passes $name as one argument', (row) => {
    expect(row).toEqual({ name: 'x' });
  });
  it('ran every row', () => {
    expect(seen).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });
});
