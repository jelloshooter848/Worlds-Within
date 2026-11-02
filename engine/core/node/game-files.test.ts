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

  it('returns nothing for an empty folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'ww-game-'));
    expect(readGameFiles(dir)).toEqual({});
  });
});
