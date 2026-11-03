import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './headless';
import { sha256Hex, stateHash } from './state-hash';

const node = (text: string) => createHash('sha256').update(text).digest('hex');

describe('sha256Hex', () => {
  it('gives the standard digests', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it("matches Node's crypto at every length around the block edges, and on UTF-8", () => {
    for (let n = 0; n < 200; n++) {
      const text = 'x'.repeat(n);
      expect(sha256Hex(text), `length ${n}`).toBe(node(text));
    }
    for (const text of ['é', '城 siege', '\u{1F3AE} pad', 'a\nb\tc'])
      expect(sha256Hex(text)).toBe(node(text));
  });
});

describe('stateHash', () => {
  it('is the first 16 hex digits of the SHA-256 of the canonical JSON, key order ignored', () => {
    const snapshot = { tick: 3, world: { b: [1, 2], a: 'x' } };
    expect(stateHash(snapshot)).toBe(node(canonicalJson(snapshot)).slice(0, 16));
    expect(stateHash({ world: { a: 'x', b: [1, 2] }, tick: 3 })).toBe(stateHash(snapshot));
    expect(stateHash(snapshot)).toMatch(/^[0-9a-f]{16}$/);
  });
});
