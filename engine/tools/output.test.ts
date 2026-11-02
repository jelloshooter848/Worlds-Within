import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capJson, capText, writeFullOutput } from './output';

describe('capJson', () => {
  const noFile = () => {
    throw new Error('should not write');
  };

  it('leaves a short result alone', () => {
    expect(capJson({ ok: true, list: [1, 2] }, 1000, noFile)).toBe('{"ok":true,"list":[1,2]}');
  });

  it('cuts the longest arrays until it fits and says how many it dropped', () => {
    const result = {
      ok: false,
      command: 'x',
      exitCode: 3,
      a: Array.from({ length: 100 }, (_, i) => i),
      b: ['b'],
    };
    let full = '';
    const text = capJson(result, 120, (t) => ((full = t), 'out/x.json'));
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(120);
    const capped = JSON.parse(text) as {
      a: number[];
      omitted: { a: number };
      truncated: boolean;
      fullOutput: string;
    };
    expect(capped).toMatchObject({ truncated: true, fullOutput: 'out/x.json' });
    expect(capped.a.length + capped.omitted.a).toBe(100);
    expect(capped.a).toEqual(result.a.slice(0, capped.a.length));
    expect(JSON.parse(full)).toEqual(result);
  });

  it('falls back to the envelope when one field alone is too long', () => {
    const text = capJson({ ok: true, command: 'x', exitCode: 0, blob: 'z'.repeat(500) }, 100, () => 'f.json');
    expect(JSON.parse(text)).toEqual({
      truncated: true,
      fullOutput: 'f.json',
      ok: true,
      command: 'x',
      exitCode: 0,
    });
  });
});

describe('capText', () => {
  it('keeps whole lines and names the file', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const out = capText(text, 120, () => 'out/t.txt');
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(120);
    expect(out.split('\n')[0]).toBe('line 0');
    expect(out).toMatch(/\.\.\. \d+ more line\(s\): the full output is in out\/t\.txt$/);
  });
});

describe('writeFullOutput', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes under the output folder, named by command and content hash', () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-out-'));
    const a = writeFullOutput(dir, '.ww-out', 'validate', 'hello', 'json');
    expect(a).toMatch(/^\.ww-out\/validate-[0-9a-f]{12}\.json$/);
    expect(readFileSync(join(dir, a), 'utf8')).toBe('hello');
    expect(writeFullOutput(dir, '.ww-out', 'validate', 'hello', 'json')).toBe(a);
    expect(existsSync(join(dir, '.ww-out'))).toBe(true);
  });
});
