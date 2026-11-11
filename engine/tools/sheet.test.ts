import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, UsageError } from './exit-codes';
import { loadGame } from './game-loader';
import { main } from './main';
import { launchChromium, NoBrowserError, pngSize } from './screenshot';
import { parseTiles } from './sheet';
import { contentFonts } from '@engine/core/ui';
import { checkOverlay, sheetLevels, overlayTransition, overlayUi, parseOverlay } from './sheet-overlay';

// `pnpm cli sheet` (Engine 0.16 T14): the tile grammar, the overlays worked out from the fx lab's
// content (Node), and the command end to end in headless Chromium (skipped without one, required
// in CI), in 2D and 3D (software WebGL).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LEVEL1 = 'games/fx-lab/runs/level-1.run.json';

function labContent() {
  const game = loadGame(ROOT, 'games/fx-lab');
  if (!game.content.ok) throw new Error('the fx lab does not load');
  return game.content.value;
}

describe('sheet tiles', () => {
  it('reads ticks, other runs, overlays and backends', () => {
    expect(parseTiles('216, level-3/120,300+pause,40+ui=lab.talk*90,352+level*22,200@3d')).toEqual([
      { run: null, tick: 216, overlay: null, backend: null, text: '216' },
      { run: 'level-3', tick: 120, overlay: null, backend: null, text: 'level-3/120' },
      {
        run: null,
        tick: 300,
        overlay: { kind: 'menu', screen: 'pause', frames: 30 },
        backend: null,
        text: '300+pause',
      },
      {
        run: null,
        tick: 40,
        overlay: { kind: 'ui', file: 'lab', widget: 'talk', frames: 90 },
        backend: null,
        text: '40+ui=lab.talk*90',
      },
      {
        run: null,
        tick: 352,
        overlay: { kind: 'transition', what: 'level', age: 22 },
        backend: null,
        text: '352+level*22',
      },
      { run: null, tick: 200, overlay: null, backend: 'three', text: '200@3d' },
    ]);
    expect(parseTiles('1@2d,2@canvas2d,3@three').map((t) => t.backend)).toEqual([
      'canvas2d',
      'canvas2d',
      'three',
    ]);
  });

  it('refuses a bad tile with a usage error naming it', () => {
    for (const bad of ['', 'abc', '12+nope', '12@4d', '12+ui=', '12+pause*x'])
      expect(() => parseTiles(bad), bad).toThrow(UsageError);
    expect(() => parseOverlay('ui=lab.')).toThrow(/widget id/);
  });
});

describe('sheet overlays (the fx lab)', () => {
  const content = labContent();
  const fonts = contentFonts(content);
  const frameSize = () => ({ w: 9, h: 9 });

  it('checks what the game can show', () => {
    expect(checkOverlay(content, parseOverlay('title'))).toBeNull();
    expect(checkOverlay(content, parseOverlay('ui=lab.talk'))).toBeNull();
    expect(checkOverlay(content, parseOverlay('ui=nope'))).toMatch(/no ui file "nope"/);
    expect(checkOverlay(content, parseOverlay('ui=lab.nope'))).toMatch(/no widget "nope"/);
    expect(checkOverlay(content, parseOverlay('level*10'))).toBeNull();
    expect(checkOverlay(content, parseOverlay('level*64'))).toMatch(/lasts 64 frames/);
    expect(checkOverlay(content, parseOverlay('mission'))).toBeNull(); // falls back to scene
    const { menus: _m, transitions: _t, ...plain } = content.manifest;
    const bare = { ...content, manifest: plain };
    expect(checkOverlay(bare, parseOverlay('pause'))).toMatch(/no "menus"/);
    expect(checkOverlay(bare, parseOverlay('level'))).toMatch(/no transition/);
    expect(checkOverlay(bare, parseOverlay('wipe'))).toBeNull();
  });

  it('builds the menu screens and ui files as draw items', () => {
    for (const o of ['title', 'pause', 'settings', 'controls', 'ui=lab', 'ui=lab.talk'])
      expect(overlayUi(content, parseOverlay(o), { fonts, frameSize }).length, o).toBeGreaterThan(0);
    expect(overlayUi(content, parseOverlay('fade'), { fonts, frameSize })).toEqual([]);
  });

  it('shows the level select, the level-clear banner and the end screen (Engine 0.16 part B)', () => {
    for (const o of ['levels', 'clear', 'end']) expect(checkOverlay(content, parseOverlay(o)), o).toBeNull();
    expect(sheetLevels(content)).toEqual([
      { id: 'fx-1', name: 'First steps' },
      { id: 'fx-2', name: 'Over the spikes' },
      { id: 'fx-3', name: 'Torchlight' },
    ]);
    const glyphs = (o: string, status?: Record<string, number>) =>
      overlayUi(content, parseOverlay(o), { fonts, frameSize, ...(status && { status }) })
        .filter((d) => 'ch' in d)
        .map((d) => (d as { ch: string }).ch)
        .join('');
    expect(glyphs('levels')).toContain('Torchlight');
    expect(glyphs('clear', { coins: 7, time: 600, deaths: 2 })).toContain('0:10');
    expect(glyphs('end', { coins: 7 })).toContain('Thanksforplaying');
    expect(checkOverlay(content, parseOverlay('respawn'))).toBeNull(); // the respawn transition slot
    const { menus, ...rest } = content.manifest;
    const { clear: _c, end: _e, ...noStats } = menus!;
    const bare = { ...content, manifest: { ...rest, menus: noStats } };
    expect(checkOverlay(bare, parseOverlay('clear'))).toMatch(/no "clear"/);
    expect(checkOverlay(bare, parseOverlay('end'))).toMatch(/no "end"/);
  });

  it('places a transition at its age', () => {
    expect(overlayTransition(content, parseOverlay('level*0'))?.phase).toBe('out');
    // No age: the frame it first covers everything (the iris's 28-frame out half, then the hold).
    expect(overlayTransition(content, parseOverlay('level'))).toMatchObject({ phase: 'out', coverage: 1 });
    expect(overlayTransition(content, parseOverlay('level*30'))).toMatchObject({ phase: 'hold' });
    expect(overlayTransition(content, parseOverlay('fade*30'))?.phase).toBe('in');
    expect(overlayTransition(content, parseOverlay('pause'))).toBeNull();
  });
});

describe('dialog overlays (the dungeon, Engine 0.16 part C T7)', () => {
  const game = loadGame(ROOT, 'games/samples/dungeon');
  if (!game.content.ok) throw new Error('the dungeon does not load');
  const content = game.content.value;
  const fonts = contentFonts(content);
  const frameSize = () => ({ w: 16, h: 28 });
  const glyphs = (o: string, status?: Record<string, number | boolean>) =>
    overlayUi(content, parseOverlay(o), { fonts, frameSize, ...(status && { status }) })
      .filter((d) => 'ch' in d)
      .map((d) => (d as { ch: string }).ch)
      .join('');

  it('reads dialog:<id> with frames, checks the id and types the first page out by default', () => {
    expect(parseOverlay('dialog:intro')).toEqual({ kind: 'dialog', id: 'intro', frames: null });
    expect(parseOverlay('dialog:intro*12')).toEqual({ kind: 'dialog', id: 'intro', frames: 12 });
    expect(() => parseOverlay('dialog:')).toThrow(/dialog id/);
    expect(checkOverlay(content, parseOverlay('dialog:intro'))).toBeNull();
    expect(checkOverlay(content, parseOverlay('dialog:nope'))).toMatch(/no dialog "nope"; it has intro/);
    // Each typed glyph is drawn twice, its shadow first.
    expect(glyphs('dialog:intro')).toContain('oollddccrryyppttbbeelloowwtthheehhiillll..');
    expect(glyphs('dialog:intro')).toContain('hhiillllwwaattcchh..');
    expect(glyphs('dialog:intro')).toContain('SirEdrin');
    expect(glyphs('dialog:intro*10').length).toBeLessThan(glyphs('dialog:intro').length);
  });

  it("draws the end screen with the matching end trigger's heading", () => {
    expect(glyphs('end', { exited: true, time: 600, roomsSeen: 4 })).toContain('Youescaped!');
    expect(glyphs('end', { dead: true, time: 600 })).toContain('Youfell');
    expect(glyphs('end', {})).toContain('Theend');
  });
});

async function browserMissing(): Promise<string | null> {
  try {
    await (await launchChromium()).close();
    return null;
  } catch (error) {
    if (process.env.CI || !(error instanceof NoBrowserError)) return null;
    return error.message;
  }
}
const missing = await browserMissing();
if (missing) console.warn(`skipping the sheet browser tests: ${missing}`);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
  const dir = mkdtempSync(join(tmpdir(), 'ww-sheet-'));
  temps.push(dir);
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(dir, 'out'),
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

describe('sheet: usage errors', () => {
  it('refuses labels that do not match the tiles, an overlay the game lacks and a tick past the run', async () => {
    expect((await cli(['sheet', LEVEL1, '--ticks', '1,2', '--labels', 'one'])).code).toBe(EXIT.usage);
    expect((await cli(['sheet', LEVEL1, '--ticks', '1+ui=nope'])).code).toBe(EXIT.usage);
    expect((await cli(['sheet', LEVEL1, '--ticks', '9999'])).code).toBe(EXIT.usage);
    expect((await cli(['sheet', LEVEL1, '--ticks', '1', '--out', 'x.jpg'])).code).toBe(EXIT.usage);
  }, 60_000);
});

describe.skipIf(missing !== null)('sheet (headless Chromium)', () => {
  it('tiles labelled 2D and 3D pictures of the fx lab into one PNG, the same bytes each run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ww-sheet-out-'));
    temps.push(dir);
    const argv = (out: string) => [
      'sheet',
      LEVEL1,
      '--ticks',
      '154,level-3/40,300+pause,100+wipe*12,level-3/120@3d,345+level*22@3d',
      '--labels',
      'dust|PNG torch|pause|wipe|3D shadows|3D iris',
      '--columns',
      '3',
      '--allow-software-gl',
      '--out',
      join(dir, out),
    ];
    const a = await cli(argv('a.png'));
    expect(a.code, JSON.stringify(a.result)).toBe(EXIT.ok);
    expect(a.result).toMatchObject({
      ok: true,
      command: 'sheet',
      run: LEVEL1,
      matchesHeadless: true,
      columns: 3,
    });
    const plays = a.result.plays as { run: string; backend: string; matchesHeadless: boolean }[];
    expect(plays.map((p) => `${p.run} ${p.backend}`)).toEqual([
      `${LEVEL1} canvas2d`,
      'games/fx-lab/runs/level-3.run.json canvas2d',
      'games/fx-lab/runs/level-3.run.json three',
      `${LEVEL1} three`,
    ]);
    const tiles = a.result.tiles as { label: string }[];
    expect(tiles.map((t) => t.label)).toEqual([
      'dust - level-1 t154 [2D]',
      'PNG torch - level-3 t40 [2D]',
      'pause - level-1 t300 + pause [2D]',
      'wipe - level-1 t100 + wipe frame 12 [2D]',
      '3D shadows - level-3 t120 [3D]',
      '3D iris - level-1 t345 + level frame 22 [3D]',
    ]);
    const png = readFileSync(join(dir, 'a.png'));
    // Two rows of three 256x240 pictures with their label lines and gaps.
    const { width, height } = pngSize(png);
    expect(width).toBe(8 + 3 * (256 + 8));
    expect(height).toBeGreaterThan(2 * 240);
    expect(a.result).toMatchObject({ width, height, bytes: png.length });
    const b = await cli(argv('b.png'));
    expect(b.result.sha256).toBe(a.result.sha256);
  }, 300_000);

  it('refuses 3D tiles on software WebGL without --allow-software-gl', async () => {
    const r = await cli(['sheet', LEVEL1, '--ticks', '10', '--backend', 'three']);
    // A machine with a GPU draws it; this container's SwiftShader is refused.
    if (r.code !== EXIT.ok) expect(r.result).toMatchObject({ refused: 'software_gl', backend: 'three' });
  }, 120_000);
});
