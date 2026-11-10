import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// The content rule (docs/ROADMAP.md, 0.2): the engine and kits keep only tiny test fixtures, and all
// game content (rooms, songs, sprites) lives in games/. This test scans every source file under
// engine/ and kits/ that is not a test (`*.test.ts`) or a fixture (anything inside a `__fixtures__/`
// folder) and fails on anything that looks like content, so the rule cannot drift.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCANNED = ['engine', 'kits'];
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.test\.(ts|tsx|js|mjs)$/;
const FIXTURES = '__fixtures__';
/** Content kept in its own text format (an MML song file) is never allowed outside fixtures. */
const CONTENT_FILE = /\.mml$/;

/** Every file under `dir` (repo paths), skipping fixture folders; empty when it does not exist. */
function scannedFiles(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== FIXTURES && entry.name !== 'node_modules') out.push(...scannedFiles(path));
    } else if ((SOURCE.test(entry.name) && !TEST.test(entry.name)) || CONTENT_FILE.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** MML commands and notes only (see engine/core/audio/mml.ts), with at least one real command. */
const MML_CHARS = /^[a-grLolvq@xpnksh0-9<>[\]\s.+#\-^&|]+$/;
const MML_COMMAND = /[olv@q]\d|[<>[\]]|\bL\b/;
/** Channel keys of a `Song` or `Sfx` (engine/core/audio/mml.ts). */
const CHANNELS = ['pulse', 'pulse1', 'pulse2', 'triangle', 'noise'];

function isMml(text: string): boolean {
  if (text.length < 12 || !MML_CHARS.test(text) || !MML_COMMAND.test(text)) return false;
  return (text.match(/[a-g]/g) ?? []).length >= 6;
}

/** The string literals of an array literal, or null when any element is something else. */
function stringRows(node: ts.Node | undefined): string[] | null {
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const rows: string[] = [];
  for (const el of node.elements) {
    if (!ts.isStringLiteralLike(el)) return null;
    rows.push(el.text);
  }
  return rows;
}

/**
 * A text grid: three or more equal-length rows of at least four characters with no spaces or
 * hyphens (so lists of frame or palette names are not grids), not all plain words. Room maps and
 * pixel-art frames are both grids.
 */
function isGrid(rows: string[] | null): boolean {
  if (!rows || rows.length < 3) return false;
  const width = rows[0]?.length ?? 0;
  if (width < 4 || rows.some((r) => r.length !== width || /[\s-]/.test(r))) return false;
  return rows.some((r) => !/^[A-Za-z]+$/.test(r));
}

function propName(p: ts.ObjectLiteralElementLike): string | null {
  if (!p.name) return null;
  if (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) return p.name.text;
  return null;
}

function propValue(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propName(p) === name) return p.initializer;
  }
  return undefined;
}

/** What content a file holds, as `<line>: <kind>` strings; empty when it holds none. */
function contentMarkers(text: string, fileName = 'x.ts'): string[] {
  if (CONTENT_FILE.test(fileName)) return ['1: MML file'];
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const mark = (node: ts.Node, kind: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    out.push(`${line}: ${kind}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && isMml(node.text)) mark(node, 'MML source string');
    else if (ts.isArrayLiteralExpression(node) && isGrid(stringRows(node)))
      mark(node, 'text grid (room map or sprite rows)');
    else if (ts.isObjectLiteralExpression(node)) {
      const names = new Set(node.properties.map(propName));
      const channels = CHANNELS.map((c) => propValue(node, c)).filter((v) => v !== undefined);
      if (channels.length > 0 && channels.every((v) => ts.isStringLiteralLike(v))) {
        mark(node, 'Song or Sfx object');
      }
      if (names.has('map') && stringRows(propValue(node, 'map'))) mark(node, 'RoomDef literal');
      const frames = propValue(node, 'frames');
      if (
        names.has('palette') &&
        frames &&
        ts.isObjectLiteralExpression(frames) &&
        frames.properties.some((p) => ts.isPropertyAssignment(p) && stringRows(p.initializer))
      ) {
        mark(node, 'SpriteDef literal');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('content rule: engine and kits hold no game content', () => {
  const files = SCANNED.flatMap(scannedFiles);

  it('scans the engine and kit sources', () => {
    expect(files).toContain('kits/topdown/room.ts');
    expect(files).toContain('engine/core/audio/mml.ts');
    expect(files.some((f) => TEST.test(f))).toBe(false);
  });

  it('finds no rooms, songs or sprites outside tests and fixtures', () => {
    const found = files.flatMap((f) =>
      contentMarkers(readFileSync(join(ROOT, f), 'utf8'), f).map((m) => `${f}:${m}`),
    );
    expect(found).toEqual([]);
  });

  it('still recognises the demo game content (the detector works on real content)', () => {
    // The demo keeps its content in data files; written back as TypeScript, it must be flagged.
    const song = readFileSync(join(ROOT, 'games/samples/dungeon/content/songs/crypt.json'), 'utf8');
    const music = contentMarkers(`export const SONG = ${song};`);
    expect(music.some((m) => m.endsWith('Song or Sfx object'))).toBe(true);
    expect(music.some((m) => m.endsWith('MML source string'))).toBe(true);
    const room = JSON.parse(
      readFileSync(join(ROOT, 'games/samples/dungeon/content/rooms/courtyard.json'), 'utf8'),
    );
    room.map = readFileSync(join(ROOT, 'games/samples/dungeon/content/rooms/courtyard.map.txt'), 'utf8')
      .trim()
      .split('\n');
    const rooms = contentMarkers(`export const ROOM = ${JSON.stringify(room)};`);
    expect(rooms.some((m) => m.endsWith('RoomDef literal'))).toBe(true);
    expect(rooms.some((m) => m.includes('text grid'))).toBe(true);
  });
});

describe('content rule: the demo keeps its content in data files', () => {
  it('has no rooms, songs or sprites in its TypeScript', () => {
    const files = readdirSync(join(ROOT, 'games/samples/dungeon')).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('content.ts');
    const found = files.flatMap((f) =>
      contentMarkers(readFileSync(join(ROOT, 'games/samples/dungeon', f), 'utf8'), f).map((m) => `${f}:${m}`),
    );
    expect(found).toEqual([]);
  });
});

describe('content rule: the detector', () => {
  it.each([
    [
      'a Song object',
      "export const S = { id: 's', bpm: 120, loop: true, pulse1: 'o4 l8 c d e f g a b' };",
      'Song or Sfx object',
    ],
    ['a short Sfx', "export const HIT = { id: 'hit', pulse: 'o5 c16 e16' };", 'Song or Sfx object'],
    [
      'an MML string on its own',
      "export const TUNE = 'v10 @2 l8 o4 [e g a > c < b a g e]2';",
      'MML source string',
    ],
    [
      'a room literal',
      "export const R = { id: 'r', at: [0, 0], map: ['#####', '#.@.#', '#####'] };",
      'RoomDef literal',
    ],
    ['a bare room map', "export const MAP = ['########', '#..@...#', '########'];", 'text grid'],
    [
      'a sprite definition',
      "export const SPR = { palette: 'p', frames: { idle: ['..11..', '.1221.', '..11..'] } };",
      'SpriteDef literal',
    ],
  ])('flags %s', (_name, code, kind) => {
    expect(contentMarkers(code).some((m) => m.includes(kind))).toBe(true);
  });

  it.each([
    ['frame name lists', "export const F = ['wall', 'wall-top', 'door-open', 'door-locked'];"],
    ['equal-length id lists', "export const B = ['link-td-beam-0', 'link-td-beam-1', 'link-td-beam-2'];"],
    ['sheet ids', "export const D = { tiles: 'dungeon', tilesDark: 'dungeon-dark', hero: 'link-td' };"],
    ['plain words', "export const W = ['left', 'down', 'back', 'face'];"],
    ['prose', "export const H = 'press a to attack, b to use the item';"],
    [
      'a frame helper',
      'export const f = (def: { frames: Record<string, string[]> }) => ({ ...def.frames });',
    ],
    ['colour names', "export const NES = { black: '#000000', white: '#fcfcfc', gray: '#7c7c7c' };"],
  ])('leaves %s alone', (_name, code) => {
    expect(contentMarkers(code)).toEqual([]);
  });

  it('rejects MML files outright', () => {
    expect(contentMarkers('', 'engine/core/audio/theme.mml')).toEqual(['1: MML file']);
  });
});

// Binary files (Engine 0.16 T10; docs/DESIGN.md, item 322): content is text, and the one
// exception is a game's own `assets/` folder (CC0 packs and original sheets made by a script,
// credited in its `assets/CREDITS.md`, which `validate` checks). This walks the whole repo (not
// only engine/ and kits/) and fails on any binary file anywhere else.

/** Folders never scanned: tools' output, dependencies and git's own. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite', '.ww-out', '.claude']);
/** Extensions that are binary (or binary model and sound formats) whatever their bytes. */
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|glb|gltf|bin|ogg|wav|mp3|flac|ttf|otf|woff2?|zip|gz)$/i;
/**
 * Where binary files may live: a game's assets folder, the owner's reviewed mockups, and the
 * owner's screenshot review sheets (`docs/reports/<release>-<name>-sheet.png`, made by
 * `pnpm cli sheet`, Engine 0.16 T14) and review screenshots, one folder per release
 * (`docs/reports/screenshots/<release>/*.png`, made by `pnpm cli screenshot`, Engine 0.16 part B
 * T11).
 */
const BINARY_ALLOWED = [
  /^games\/(?:samples\/)?[^/]+\/assets\//,
  /^docs\/reports\/mockups\/[^/]+\.png$/,
  /^docs\/reports\/[^/]+-sheet\.png$/,
  /^docs\/reports\/screenshots\/[^/]+\/[^/]+\.png$/,
];

/** Whether a file is binary: by its extension, or a NUL byte in its first 8 KiB. */
function isBinaryFile(path: string): boolean {
  if (BINARY_EXT.test(path)) return true;
  return readFileSync(join(ROOT, path)).subarray(0, 8192).includes(0);
}

function repoFiles(dir = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...repoFiles(path));
    } else if (entry.isFile()) out.push(path);
  }
  return out;
}

describe('content rule: binary files only in games/*/assets', () => {
  const allowed = (path: string) => BINARY_ALLOWED.some((re) => re.test(path));

  it("finds no binary file outside a game's assets folder", () => {
    const binary = repoFiles().filter(isBinaryFile);
    expect(binary).toContain('games/fx-lab/assets/fx-lab-png/torch.png');
    expect(binary.filter((p) => !allowed(p))).toEqual([]);
  });

  it('allows games/<game>/assets, games/samples/<game>/assets, review sheets and screenshots, nothing else', () => {
    expect(allowed('games/fx-lab/assets/pack/a.png')).toBe(true);
    expect(allowed('games/samples/dungeon/assets/tiles/a.png')).toBe(true);
    expect(allowed('games/fx-lab/content/a.png')).toBe(false);
    expect(allowed('engine/core/assets/a.png')).toBe(false);
    expect(allowed('games/assets/a.png')).toBe(false);
    expect(allowed('docs/reports/0.16a-effects-sheet.png')).toBe(true);
    expect(allowed('docs/reports/notes.png')).toBe(false);
    expect(allowed('docs/reports/screenshots/0.16-B/07-title.png')).toBe(true);
    expect(allowed('docs/reports/screenshots/0.16-B/notes.glb')).toBe(false);
    expect(allowed('docs/reports/screenshots/a.png')).toBe(false);
    expect(allowed('docs/reports/screenshots/0.16-B/more/a.png')).toBe(false);
    expect(isBinaryFile('games/fx-lab/game.json')).toBe(false);
  });
});
