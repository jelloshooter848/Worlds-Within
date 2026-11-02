import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, resolveConfig } from 'prettier';
import { parsePath } from './content-path';
import { EXIT } from './exit-codes';
import { main } from './main';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temp folder holding a copy of the demo (games/demo) and the repo's Prettier settings. */
function demoCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-edit-'));
  temps.push(dir);
  cpSync(join(ROOT, 'games/demo'), join(dir, 'games/demo'), { recursive: true });
  cpSync(join(ROOT, '.prettierrc'), join(dir, '.prettierrc'));
  return dir;
}

async function cli(cwd: string, ...argv: string[]): Promise<{ code: number; out: Record<string, unknown> }> {
  let stdout = '';
  const io = { stdout: (t: string) => void (stdout += t), stderr: () => {}, cwd, outDir: '.ww-out' };
  const code = await main([...argv, '--json'], io);
  return { code, out: JSON.parse(stdout) as Record<string, unknown> };
}

const SONG = 'games/demo/content/songs/demo.json';
const PALETTE = 'games/demo/content/palettes/demo-hero.json';
const ROOM = 'games/demo/content/rooms/guard-room.json';
const MAP = 'games/demo/content/rooms/guard-room.map.txt';
const SPRITE = 'games/demo/content/sprites/demo-hero.txt';
const RUN = 'games/demo/runs/walk-east.run.json';

const read = (cwd: string, file: string) => readFileSync(join(cwd, file), 'utf8');

describe('get, set, add, remove', () => {
  it('a set followed by a get returns the new value, and the set is verified', async () => {
    const cwd = demoCopy();
    const set = await cli(cwd, 'set', SONG, 'bpm', '140');
    expect(set.code).toBe(EXIT.ok);
    expect(set.out).toMatchObject({ ok: true, verified: true, written: true, before: 132, after: 140 });
    expect(set.out).toMatchObject({ file: SONG, kind: 'song', path: 'bpm', pointer: '/bpm' });
    const get = await cli(cwd, 'get', SONG, '/bpm');
    expect(get.code).toBe(EXIT.ok);
    expect(get.out.value).toBe(140);
    // The written file is formatted the way `pnpm lint` wants, with a final newline.
    const text = read(cwd, SONG);
    expect(text.endsWith('}\n')).toBe(true);
    const config = await resolveConfig(join(cwd, SONG));
    expect(await check(text, { ...config, parser: 'json' })).toBe(true);
    // And the game still validates.
    expect((await cli(cwd, 'validate', 'games/demo')).code).toBe(EXIT.ok);
  });

  it('refuses a write that breaks the schema and leaves the file as it was', async () => {
    const cwd = demoCopy();
    const before = read(cwd, SONG);
    const bad = await cli(cwd, 'set', SONG, 'bpm', '"fast"');
    expect(bad.code).toBe(EXIT.invalidContent);
    expect(bad.out).toMatchObject({ ok: false, written: false, verified: false });
    expect(bad.out.errors).toEqual([
      expect.objectContaining({ file: SONG, path: 'bpm', code: 'invalid_type' }),
    ]);
    expect(read(cwd, SONG)).toBe(before);

    const mml = await cli(cwd, 'set', SONG, 'pulse1', 'zzz');
    expect(mml.code).toBe(EXIT.invalidContent);
    expect(mml.out.errors).toEqual([expect.objectContaining({ code: 'invalid_mml' })]);
    expect(read(cwd, SONG)).toBe(before);
  });

  it('refuses a write that gives the game a new error elsewhere (an id that no longer matches)', async () => {
    const cwd = demoCopy();
    const before = read(cwd, ROOM);
    const bad = await cli(cwd, 'set', ROOM, 'id', 'hall');
    expect(bad.code).toBe(EXIT.invalidContent);
    expect(bad.out.errors).toEqual([expect.objectContaining({ code: 'id_mismatch' })]);
    expect(read(cwd, ROOM)).toBe(before);
  });

  it('adds to and removes from arrays, and the file comes back the same', async () => {
    const cwd = demoCopy();
    const before = read(cwd, PALETTE);
    const add = await cli(cwd, 'add', PALETTE, 'colors', '#ffffff');
    expect(add.code).toBe(EXIT.ok);
    expect(add.out).toMatchObject({ verified: true, path: 'colors.5', before: null, after: '#ffffff' });
    expect((await cli(cwd, 'get', PALETTE, 'colors.5')).out.value).toBe('#ffffff');
    const insert = await cli(cwd, 'add', PALETTE, 'colors.0', '#123456');
    expect(insert.out).toMatchObject({ verified: true, path: 'colors.0' });
    expect((await cli(cwd, 'get', PALETTE, 'colors.1')).out.value).toBe('#000000');
    expect((await cli(cwd, 'remove', PALETTE, 'colors.0')).out).toMatchObject({
      verified: true,
      before: '#123456',
    });
    const remove = await cli(cwd, 'remove', PALETTE, 'colors.5');
    expect(remove.out).toMatchObject({ verified: true, before: '#ffffff', after: null });
    expect(read(cwd, PALETTE)).toBe(before);
  });

  it('adds and removes object keys', async () => {
    const cwd = demoCopy();
    const remove = await cli(cwd, 'remove', RUN, 'seed');
    expect(remove.out).toMatchObject({ verified: true, before: 1, after: null });
    expect((await cli(cwd, 'get', RUN, 'seed')).code).toBe(EXIT.usage);
    const add = await cli(cwd, 'add', RUN, 'seed', '3');
    expect(add.out).toMatchObject({ verified: true, before: null, after: 3 });
    expect((await cli(cwd, 'get', RUN, 'seed')).out.value).toBe(3);
    // A key that is there is set, not added.
    expect((await cli(cwd, 'add', RUN, 'seed', '4')).code).toBe(EXIT.usage);
    // A run file with an unknown key breaks its schema.
    expect((await cli(cwd, 'add', RUN, 'speed', '4')).code).toBe(EXIT.invalidContent);
  });

  it('edits text-grid rows and cells in a map part file', async () => {
    const cwd = demoCopy();
    const before = read(cwd, MAP);
    expect((await cli(cwd, 'get', MAP, 'rows.2')).out.value).toBe('#...b......b...#');
    const cell = await cli(cwd, 'set', MAP, 'rows.2.5', '#');
    expect(cell.out).toMatchObject({ verified: true, before: '.', after: '#', path: 'rows.2.5' });
    expect((await cli(cwd, 'get', MAP, 'rows.2')).out.value).toBe('#...b#.....b...#');
    const row = await cli(cwd, 'set', MAP, 'rows.2', '#...b......b...#');
    expect(row.out.verified).toBe(true);
    expect(read(cwd, MAP)).toBe(before);
    // A room's size is fixed, so adding or removing a row is refused by its schema; so is a bad cell.
    const add = await cli(cwd, 'add', MAP, 'rows', '#..............#');
    expect(add.code).toBe(EXIT.invalidContent);
    expect(add.out.errors).toEqual([expect.objectContaining({ code: 'wrong_size', file: MAP })]);
    expect((await cli(cwd, 'remove', MAP, 'rows.3')).code).toBe(EXIT.invalidContent);
    const char = await cli(cwd, 'set', MAP, 'rows.2.5', 'Q');
    expect(char.out.errors).toEqual([expect.objectContaining({ code: 'unknown_char', line: 3 })]);
    expect((await cli(cwd, 'set', MAP, 'rows.2.5', 'ab')).code).toBe(EXIT.usage);
    expect(read(cwd, MAP)).toBe(before);
  });

  it('adds and removes rows and legend keys in a sprite .txt file, keeping its header', async () => {
    const cwd = demoCopy();
    const before = read(cwd, SPRITE);
    const frame = 'frames["down-0"]';
    const add = await cli(cwd, 'add', SPRITE, frame, '................');
    expect(add.out).toMatchObject({ verified: true, path: `${frame}.16` });
    expect((await cli(cwd, 'get', SPRITE, `/frames/down-0/16`)).out.value).toBe('................');
    expect(read(cwd, SPRITE).startsWith('; The demo hero')).toBe(true);
    expect((await cli(cwd, 'remove', SPRITE, `${frame}.16`)).out.verified).toBe(true);
    expect((await cli(cwd, 'add', SPRITE, 'legend.w', '3')).out.verified).toBe(true);
    expect((await cli(cwd, 'remove', SPRITE, 'legend.w')).out.verified).toBe(true);
    expect(read(cwd, SPRITE)).toBe(before);
    // A ragged row breaks the grid.
    const ragged = await cli(cwd, 'add', SPRITE, frame, '...');
    expect(ragged.out.errors).toEqual([expect.objectContaining({ code: 'ragged_row' })]);
    expect(read(cwd, SPRITE)).toBe(before);
  });

  it('refuses to write a sprite .txt file whose comments would be lost', async () => {
    const cwd = demoCopy();
    const text = read(cwd, SPRITE).replace('frame up-0', '; the back\nframe up-0');
    writeFileSync(join(cwd, SPRITE), text);
    const set = await cli(cwd, 'set', SPRITE, 'palette', 'demo-hero');
    expect(set.code).toBe(EXIT.invalidContent);
    expect(set.out.errors).toEqual([expect.objectContaining({ code: 'not_writable' })]);
    expect(read(cwd, SPRITE)).toBe(text);
  });

  it('writing a file back unchanged gives the same text (formatting is kept)', async () => {
    const cwd = demoCopy();
    for (const file of ['games/demo/game.json', SONG, PALETTE, ROOM, MAP, SPRITE, RUN]) {
      const before = read(cwd, file);
      const whole = await cli(cwd, 'get', file, '');
      const set = await cli(cwd, 'set', file, '', JSON.stringify(whole.out.value));
      expect(set.out, file).toMatchObject({ verified: true, changed: false });
      expect(read(cwd, file), file).toBe(before);
    }
  });

  it('a bad path is a usage error and changes nothing', async () => {
    const cwd = demoCopy();
    const before = read(cwd, SONG);
    for (const argv of [
      ['get', SONG, 'nope'],
      ['get', SONG, 'bpm.x'],
      ['get', SONG, 'a..b'],
      ['set', SONG, 'nope', '1'],
      ['set', PALETTE, 'colors.9', '"#fff"'],
      ['add', PALETTE, 'colors.9', '"#fff"'],
      ['remove', SONG, 'nope'],
      ['remove', SONG, ''],
      ['get', SONG, '/a~2'],
      ['get', 'games/demo/missing.json', 'id'],
      ['get', 'games/demo/main.ts', 'id'],
    ]) {
      const result = await cli(cwd, ...argv);
      expect(result.code, argv.join(' ')).toBe(EXIT.usage);
      expect((result.out.error as { kind: string }).kind).toBe('usage');
    }
    expect(read(cwd, SONG)).toBe(before);
    const missing = await cli(cwd, 'get', SONG, 'nope');
    expect((missing.out.error as { message: string }).message).toContain('its keys: id, bpm');
  });
});

describe('parsePath', () => {
  it('reads dotted paths, quoted keys and JSON pointers', () => {
    expect(parsePath('')).toEqual([]);
    expect(parsePath('.')).toEqual([]);
    expect(parsePath('frames.idle.2')).toEqual(['frames', 'idle', '2']);
    expect(parsePath('frames["down-0"].1')).toEqual(['frames', 'down-0', '1']);
    expect(parsePath('legend["#"]')).toEqual(['legend', '#']);
    expect(parsePath('rows[3].5')).toEqual(['rows', '3', '5']);
    expect(parsePath('a["x.y"]')).toEqual(['a', 'x.y']);
    expect(parsePath('/frames/down-0/1')).toEqual(['frames', 'down-0', '1']);
    expect(parsePath('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('rejects malformed paths', () => {
    for (const bad of ['a.', '.a', 'a..b', 'a[', 'a[x]', 'a["x', '/a~2']) {
      expect(() => parsePath(bad), bad).toThrow(/bad/);
    }
  });
});
