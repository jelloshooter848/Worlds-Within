import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGameFiles } from './game-files';

describe('readGameFiles', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads game.json and everything under content/, sorted, skipping hidden files', () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-game-'));
    mkdirSync(join(dir, 'content/rooms'), { recursive: true });
    writeFileSync(join(dir, 'game.json'), '{}');
    writeFileSync(join(dir, 'main.ts'), 'code');
    writeFileSync(join(dir, 'content/rooms/b.json'), 'b');
    writeFileSync(join(dir, 'content/rooms/a.map.txt'), 'a');
    writeFileSync(join(dir, 'content/.DS_Store'), 'x');
    const files = readGameFiles(dir);
    expect(Object.keys(files)).toEqual(['game.json', 'content/rooms/a.map.txt', 'content/rooms/b.json']);
    expect(files['content/rooms/b.json']).toBe('b');
  });

  it('reads assets/ too: text as text, a PNG as a base64 data URL (Engine 0.16 T10)', () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-game-'));
    mkdirSync(join(dir, 'assets/pack'), { recursive: true });
    writeFileSync(join(dir, 'game.json'), '{}');
    writeFileSync(join(dir, 'assets/CREDITS.md'), '# Credits');
    writeFileSync(join(dir, 'assets/pack/a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const files = readGameFiles(dir);
    expect(Object.keys(files)).toEqual(['game.json', 'assets/CREDITS.md', 'assets/pack/a.png']);
    expect(files['assets/CREDITS.md']).toBe('# Credits');
    expect(files['assets/pack/a.png']).toBe('data:image/png;base64,iVBORw==');
  });

  it('returns nothing for an empty folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-game-'));
    expect(readGameFiles(dir)).toEqual({});
  });
});
