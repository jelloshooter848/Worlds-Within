import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, resolveConfig } from 'prettier';
import { blockLines, gridRuler, parseGridRegion, parsePath, pasteBlock } from './content-path';
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

/** A temp folder holding a copy of one game folder (repo path) and the repo's Prettier settings. */
function gameCopy(game: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-edit-'));
  temps.push(dir);
  cpSync(join(ROOT, game), join(dir, game), { recursive: true });
  cpSync(join(ROOT, '.prettierrc'), join(dir, '.prettierrc'));
  return dir;
}

/** The text mode: what a person sees on stdout. */
async function cliText(cwd: string, ...argv: string[]): Promise<{ code: number; out: string }> {
  let stdout = '';
  const io = { stdout: (t: string) => void (stdout += t), stderr: () => {}, cwd, outDir: '.ww-out' };
  const code = await main(argv, io);
  return { code, out: stdout };
}

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

  it('writes a set that breaks the dungeon across rooms, reporting it in crossErrors', async () => {
    const cwd = demoCopy();
    const before = read(cwd, ROOM);
    const set = await cli(cwd, 'set', ROOM, 'at.0', '2');
    expect(set.code).toBe(EXIT.ok);
    expect(set.out).toMatchObject({ written: true, verified: true, before: 1, after: 2 });
    expect(set.out.crossErrors).toEqual([
      expect.objectContaining({
        file: 'games/demo/content/rooms/courtyard.map.txt',
        path: 'map.5',
        code: 'invalid_dungeon',
        message: 'room "courtyard": the e door leads nowhere',
      }),
      expect.objectContaining({
        file: 'games/demo/content/rooms/guard-room.map.txt',
        path: 'map.5',
        code: 'invalid_dungeon',
      }),
    ]);
    // validate still fails until the matching edit is made.
    expect((await cli(cwd, 'validate', 'games/demo')).code).toBe(EXIT.invalidContent);
    const back = await cli(cwd, 'set', ROOM, 'at.0', '1');
    expect(back.code).toBe(EXIT.ok);
    expect(back.out.crossErrors).toEqual([]);
    expect(read(cwd, ROOM)).toBe(before);
    expect((await cli(cwd, 'validate', 'games/demo')).code).toBe(EXIT.ok);
  });

  it('removes a door pair with one set per room, and the game validates after the second', async () => {
    const cwd = demoCopy();
    const COURTYARD_MAP = 'games/demo/content/rooms/courtyard.map.txt';
    const first = await cli(cwd, 'set', COURTYARD_MAP, 'rows.5.15', '#');
    expect(first.code).toBe(EXIT.ok);
    expect(first.out).toMatchObject({ written: true, verified: true, before: 'O', after: '#' });
    expect(first.out.crossErrors).toEqual([expect.objectContaining({ file: MAP, code: 'invalid_dungeon' })]);
    expect((await cli(cwd, 'validate', 'games/demo')).code).toBe(EXIT.invalidContent);
    const second = await cli(cwd, 'set', MAP, 'rows.5.0', '#');
    expect(second.code).toBe(EXIT.ok);
    expect(second.out).toMatchObject({ written: true, verified: true, crossErrors: [] });
    expect((await cli(cwd, 'validate', 'games/demo')).code).toBe(EXIT.ok);
  });

  it('still refuses a set that breaks a room file itself', async () => {
    const cwd = demoCopy();
    const before = read(cwd, MAP);
    const set = await cli(cwd, 'set', MAP, 'rows.5.0', 'Z');
    expect(set.code).toBe(EXIT.invalidContent);
    expect(set.out).toMatchObject({ written: false, verified: false });
    expect(read(cwd, MAP)).toBe(before);
  });

  it('validate and run report a second player start as invalid content, not a crash', async () => {
    const cwd = demoCopy();
    const rows = read(cwd, MAP).split('\n');
    rows[3] = '#......@.......#';
    writeFileSync(join(cwd, MAP), rows.join('\n'));
    const error = {
      file: MAP,
      path: 'map.3',
      code: 'invalid_dungeon',
      row: 3,
      col: 7,
      line: 4,
      message: 'rooms "courtyard" and "guard-room" both have a player start',
    };
    const validate = await cli(cwd, 'validate', 'games/demo');
    expect(validate.code).toBe(EXIT.invalidContent);
    expect(validate.out.errors).toEqual([expect.objectContaining(error)]);
    const run = await cli(cwd, 'run', RUN);
    expect(run.code).toBe(EXIT.invalidContent);
    expect(run.out.errors).toEqual([expect.objectContaining(error)]);
  });
});

describe('text maps: ruler, regions and paste (G10)', () => {
  const COURTYARD = 'games/demo/content/rooms/courtyard.map.txt';

  it('get rows --ruler gives the rows, a column ruler, the width, height and first row', async () => {
    const cwd = demoCopy();
    const all = await cli(cwd, 'get', COURTYARD, 'rows', '--ruler');
    expect(all.code).toBe(EXIT.ok);
    expect(all.out).toMatchObject({
      path: 'rows',
      ruler: ['0         1', '0123456789012345'],
      width: 16,
      height: 11,
      firstRow: 0,
      firstColumn: 0,
    });
    expect((all.out.rows as string[])[0]).toBe('#######OO#######');
    const range = await cli(cwd, 'get', COURTYARD, 'rows.4-5', '--ruler');
    expect(range.out).toMatchObject({
      rows: ['#......h.......#', '#......@.......O'],
      width: 16,
      height: 2,
      firstRow: 4,
    });
    const text = await cliText(cwd, 'get', COURTYARD, 'rows.4-5', '--ruler');
    expect(text.out).toBe(
      ['  0         1', '  0123456789012345', '4 #......h.......#', '5 #......@.......O', ''].join('\n'),
    );
    // Wide row numbers are padded so the ruler stays over the cells.
    const full = await cliText(cwd, 'get', COURTYARD, 'rows', '--ruler');
    expect(full.out.split('\n').slice(0, 3)).toEqual([
      '   0         1',
      '   0123456789012345',
      ' 0 #######OO#######',
    ]);
    // --ruler needs rows, and only text grids have them.
    expect((await cli(cwd, 'get', COURTYARD, 'rows.2', '--ruler')).code).toBe(EXIT.usage);
    expect((await cli(cwd, 'get', SONG, 'bpm', '--ruler')).code).toBe(EXIT.usage);
  });

  it('get of a rectangle copies it, and bad corners are usage errors', async () => {
    const cwd = demoCopy();
    const rect = await cli(cwd, 'get', COURTYARD, 'rows.4.6:5.8');
    expect(rect.code).toBe(EXIT.ok);
    expect(rect.out).toMatchObject({
      value: ['.h.', '.@.'],
      width: 3,
      height: 2,
      firstRow: 4,
      firstColumn: 6,
    });
    expect((await cliText(cwd, 'get', COURTYARD, 'rows.4.6:5.8')).out).toBe('.h.\n.@.\n');
    for (const bad of [
      'rows.5.6:4.8',
      'rows.4.8:5.6',
      'rows.4.6:11.8',
      'rows.4.6:5.16',
      'rows.3-2',
      'rows.0-11',
    ]) {
      expect((await cli(cwd, 'get', COURTYARD, bad)).code, bad).toBe(EXIT.usage);
    }
  });

  it('paste moves a block in one call, verified, and the same paste again changes nothing', async () => {
    const cwd = demoCopy();
    // Move the top-left boulder (row 2, col 3) one cell down and left: one 2x2 paste.
    const moved = await cli(cwd, 'paste', COURTYARD, 'rows.2.2', '..\\nB.');
    expect(moved.code).toBe(EXIT.ok);
    expect(moved.out).toMatchObject({
      kind: 'room',
      path: 'rows.2.2',
      pointer: '/rows/2/2',
      region: { row: 2, col: 2, height: 2, width: 2 },
      written: true,
      verified: true,
      changed: true,
      before: ['.B', '..'],
      after: ['..', 'B.'],
      crossErrors: [],
    });
    expect(read(cwd, COURTYARD).split('\n').slice(2, 4)).toEqual(['#...........B..#', '#.B............#']);
    const again = await cli(cwd, 'paste', COURTYARD, 'rows.2.2', '..\\nB.');
    expect(again.out).toMatchObject({ verified: true, changed: false });
    expect((await cli(cwd, 'validate', 'games/demo')).code).toBe(EXIT.ok);
    const text = await cliText(cwd, 'paste', COURTYARD, 'rows.2.2', '..\\nB.');
    expect(text.out).toContain('pasted 2 line(s) of 2 (verified, unchanged)');
  });

  it('a block off the grid or of ragged width is a usage error and leaves the file untouched', async () => {
    const cwd = demoCopy();
    const before = read(cwd, COURTYARD);
    for (const [at, block] of [
      ['rows.10.0', '#\\n#'], // past the last row
      ['rows.0.15', '##'], // past the last column
      ['rows.20.0', '#'],
      ['rows.2.2', '..\\nB..'], // ragged
      ['rows.2', '..'], // not a cell
    ]) {
      const out = await cli(cwd, 'paste', COURTYARD, at!, block!);
      expect(out.code, `${at} ${block}`).toBe(EXIT.usage);
    }
    expect((await cli(cwd, 'paste', COURTYARD, 'rows.10.0', '#\\n#')).out.error).toMatchObject({
      message: expect.stringContaining('out_of_bounds') as unknown,
    });
    expect(read(cwd, COURTYARD)).toBe(before);
  });

  it("a block breaking the room's schema is refused with exit 3 and the file is untouched", async () => {
    const cwd = demoCopy();
    const before = read(cwd, COURTYARD);
    const bad = await cli(cwd, 'paste', COURTYARD, 'rows.2.2', 'QQ');
    expect(bad.code).toBe(EXIT.invalidContent);
    expect(bad.out).toMatchObject({ written: false, verified: false, region: { row: 2, col: 2 } });
    expect(bad.out.errors).toEqual([
      expect.objectContaining({ code: 'unknown_char', file: COURTYARD }),
      expect.objectContaining({ code: 'unknown_char', file: COURTYARD }),
    ]);
    // Two player starts in one room break it too.
    // (A block starting with a real `@` is typed `\@`: `@path` names a block file.)
    const start = await cli(cwd, 'paste', COURTYARD, 'rows.1.1', '\\@');
    expect(start.code).toBe(EXIT.invalidContent);
    expect(start.out.before).toEqual(['.']);
    expect(start.out.after).toEqual(['@']);
    expect(read(cwd, COURTYARD)).toBe(before);
  });

  it('cross-file problems come back in crossErrors, as with set', async () => {
    const cwd = demoCopy();
    const out = await cli(cwd, 'paste', COURTYARD, 'rows.5.15', '#');
    expect(out.code).toBe(EXIT.ok);
    expect(out.out.verified).toBe(true);
    expect(out.out.crossErrors).toEqual([expect.objectContaining({ code: 'invalid_dungeon' })]);
  });

  it('takes the block from a file (@path or --from-file) and leaves --transparent cells as they are', async () => {
    const cwd = demoCopy();
    writeFileSync(join(cwd, 'block.txt'), 'B.B\n...\n');
    const at = await cli(cwd, 'paste', COURTYARD, 'rows.6.2', '@block.txt');
    expect(at.out).toMatchObject({ verified: true, after: ['B.B', '...'] });
    writeFileSync(join(cwd, 'block.txt'), 'xBx\nB\\B\n');
    const transparent = await cli(
      cwd,
      'paste',
      COURTYARD,
      'rows.6.2',
      '--from-file',
      'block.txt',
      '--transparent',
      'x',
    );
    // The block's backslash is a cell, not an escape: a block from a file is taken as it is.
    expect(transparent.code).toBe(EXIT.invalidContent);
    writeFileSync(join(cwd, 'block.txt'), 'x.x\nBxB\n');
    const ok = await cli(
      cwd,
      'paste',
      COURTYARD,
      'rows.6.2',
      '--from-file',
      'block.txt',
      '--transparent',
      'x',
    );
    expect(ok.out).toMatchObject({ verified: true, before: ['B.B', '...'], after: ['B.B', 'B.B'] });
    // Exactly one block, a file that is there, and only text grids.
    expect((await cli(cwd, 'paste', COURTYARD, 'rows.6.2')).code).toBe(EXIT.usage);
    expect((await cli(cwd, 'paste', COURTYARD, 'rows.6.2', '.', '--from-file', 'block.txt')).code).toBe(
      EXIT.usage,
    );
    expect((await cli(cwd, 'paste', COURTYARD, 'rows.6.2', '@nothing.txt')).code).toBe(EXIT.usage);
    expect((await cli(cwd, 'paste', SONG, 'rows.0.0', 'x')).code).toBe(EXIT.usage);
  });

  it('works on a tower-defence map and a platformer level', async () => {
    const td = gameCopy('games/samples/tower-defense');
    const ROAD = 'games/samples/tower-defense/content/maps/road.map.txt';
    const ruler = await cli(td, 'get', ROAD, 'rows.0-1', '--ruler');
    expect(ruler.out).toMatchObject({ rows: ['................', 'S#######........'], width: 16 });
    const build = await cli(td, 'paste', ROAD, 'rows.0.10', 'BB');
    expect(build.out).toMatchObject({ verified: true, changed: true, after: ['BB'] });
    expect((await cli(td, 'validate', 'games/samples/tower-defense')).code).toBe(EXIT.ok);

    const pf = gameCopy('games/platformer-test');
    const LEVEL = 'games/platformer-test/content/levels/level-1.map.txt';
    const rows = (await cli(pf, 'get', LEVEL, 'rows', '--ruler')).out;
    expect(rows.height).toBe((rows.rows as string[]).length);
    const same = await cli(pf, 'paste', LEVEL, 'rows.0.0', (rows.rows as string[]).slice(0, 2).join('\\n'));
    expect(same.out).toMatchObject({ verified: true, changed: false });
  });
});

describe('grid helpers', () => {
  it('rulers, regions, blocks and pastes', () => {
    expect(gridRuler(12)).toEqual(['0         1', '012345678901']);
    expect(gridRuler(4, 8)).toEqual(['0 1', '8901']);
    const rows = ['abcd', 'efgh', 'ijkl'];
    expect(parseGridRegion('rows.1', rows)).toBeNull();
    expect(parseGridRegion('rows.0-2', rows)).toEqual({ row: 0, col: 0, height: 3, width: 4 });
    expect(parseGridRegion('rows.1.1:2.2', rows)).toEqual({ row: 1, col: 1, height: 2, width: 2 });
    expect(blockLines('ab\\ncd', true)).toEqual(['ab', 'cd']);
    expect(blockLines('a\\b\r\n', false)).toEqual(['a\\b']);
    expect(() => blockLines('', true)).toThrow(/empty/);
    expect(pasteBlock(rows, 1, 1, ['XY', 'Z.'], '.').rows).toEqual(['abcd', 'eXYh', 'iZkl']);
    expect(() => pasteBlock(rows, 2, 0, ['X', 'Y'])).toThrow(/out_of_bounds/);
    expect(() => pasteBlock(rows, 0, 3, ['XY'])).toThrow(/out_of_bounds/);
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
