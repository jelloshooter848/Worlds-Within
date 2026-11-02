import { describe, expect, it } from 'vitest';
import { canonicalJson } from './headless';

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('writes strings, booleans and numbers as JSON does', () => {
    expect(canonicalJson(['x"y', true, 1.5, -0])).toBe('["x\\"y",true,1.5,0]');
  });

  it.each([
    [{ a: undefined }, 'a'],
    [{ a: [1, Number.NaN] }, 'a.1'],
    [{ a: Infinity }, 'a'],
    [{ m: new Map() }, 'm'],
    [{ f: () => 1 }, 'f'],
  ])('throws on a value that is not JSON-safe (%#), naming the path', (value, path) => {
    expect(() => canonicalJson(value)).toThrow(`not JSON-safe at "${path}"`);
  });
});
