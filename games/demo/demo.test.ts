import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSong } from '@engine/core/audio/mml';
import { NullRenderer } from '@engine/backends/null';
import { AssetRegistry } from '@engine/core/assets/registry';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { sheetLookup } from '@engine/core/assets/sheet-lookup';
import { canonicalJson } from '@engine/core/headless';
import { validate } from '@engine/core/content/validate';
import { isFullMap, presentFrameSchema } from '@engine/core/present';
import { presentWorld, renderWorld, TdPresentState, topdownGame } from '@kits/topdown';
import { DEMO_SHEETS, demoArt, demoDungeon, demoSongs, loadDemo, mustLoad } from './content';
import { createWorld } from './headless';

/** The null renderer, counting the sprites drawn from each sheet. */
function countingRenderer(): { r: Renderer; sprites: Map<string, number> } {
  const sprites = new Map<string, number>();
  const r: Renderer = Object.assign(new NullRenderer(), {
    sprite(sheet: SpriteSheet) {
      sprites.set(sheet.id, (sprites.get(sheet.id) ?? 0) + 1);
    },
  });
  return { r, sprites };
}

const FILES = readGameFiles(fileURLToPath(new URL('./', import.meta.url)));
const content = mustLoad(loadDemo(FILES));

/** The demo's files with one file's JSON changed by `edit`. */
function withJson(path: string, edit: (data: Record<string, unknown>) => void): Record<string, string> {
  const data = JSON.parse(FILES[path]!) as Record<string, unknown>;
  edit(data);
  return { ...FILES, [path]: JSON.stringify(data) };
}

describe('engine demo', () => {
  it('loads its manifest and every content file', () => {
    expect(content.manifest).toMatchObject({ id: 'demo', kit: 'topdown', headless: 'headless.ts' });
    expect(content.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'room:courtyard',
      'room:guard-room',
      'room:store-room',
      'song:demo',
      'palette:demo-hero',
      'sprite:demo-hero',
    ]);
  });

  it('builds its rooms, starting in the courtyard', () => {
    const d = demoDungeon(content);
    expect(d.startRoom).toBe('courtyard');
    expect([...d.rooms.keys()].sort()).toEqual(['courtyard', 'guard-room', 'store-room']);
    expect(d.rooms.get('store-room')?.def.chests).toEqual(['bombs']);
  });

  it('runs headless: the hero walks east into the guard room, drawn from its sprite', () => {
    const world = createWorld(content);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const { r, sprites } = countingRenderer();
    const art = demoArt(content);
    const assets = new AssetRegistry({ default: art.palettes });
    assets.defineAll(art.sprites);
    const view = { frame: 0, reduceFlashing: false, sheets: DEMO_SHEETS, sheet: sheetLookup(assets) };
    for (let i = 0; i < 400 && world.room.id === 'courtyard'; i++) {
      input.next();
      world.update(input);
      renderWorld(r, view, world);
    }
    expect(world.room.id).toBe('guard-room');
    expect(sprites.get('demo-hero')).toBeGreaterThan(0);
  });

  it('has a song that compiles', () => {
    const songs = demoSongs(content);
    expect(songs.map((s) => s.id)).toEqual(['demo']);
    expect(compileSong(songs[0]!).length).toBeGreaterThan(0);
  });
});

describe('engine demo: broken content', () => {
  it('names the file and the field of a broken room field', () => {
    const r = loadDemo(withJson('content/rooms/courtyard.json', (d) => (d.at = [0, 'one'])));
    expect(r.errors).toMatchObject([
      { file: 'games/demo/content/rooms/courtyard.json', path: 'at.1', code: 'invalid_type' },
    ]);
  });

  it('names the map file, row and line of a bad map character', () => {
    const map = FILES['content/rooms/guard-room.map.txt']!.replace('#...b', '#...?');
    const r = loadDemo({ ...FILES, 'content/rooms/guard-room.map.txt': map });
    expect(r.errors).toMatchObject([
      {
        file: 'games/demo/content/rooms/guard-room.map.txt',
        path: 'map.2',
        code: 'unknown_char',
        row: 2,
        col: 4,
        line: 3,
      },
    ]);
  });

  it('names the song file and channel of bad MML', () => {
    const r = loadDemo(withJson('content/songs/demo.json', (d) => (d.noise = 'k s q9')));
    expect(r.errors).toMatchObject([
      { file: 'games/demo/content/songs/demo.json', path: 'noise', code: 'invalid_mml' },
    ]);
  });

  it('names game.json and the field of a broken manifest', () => {
    const r = loadDemo(withJson('game.json', (d) => (d.start = { seed: -1 })));
    expect(r.errors).toMatchObject([{ file: 'games/demo/game.json', path: 'start.seed', code: 'too_small' }]);
  });
});

describe('engine demo: presentation frames (0.4-5)', () => {
  /** The walk-east run (runs/walk-east.run.json): seed 1, right held for 240 ticks. */
  const run = JSON.parse(readFileSync(new URL('./runs/walk-east.run.json', import.meta.url), 'utf8')) as {
    seed: number;
    ticks: number;
    hashEvery: number;
  };
  const golden = JSON.parse(
    readFileSync(new URL('./runs/walk-east.hashes.json', import.meta.url), 'utf8'),
  ) as { hashes: { tick: number; hash: string }[] };
  const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);

  it('presents every tick of walk-east with valid frames and the golden state hashes unchanged', () => {
    const world = createWorld(content, run.seed);
    const game = topdownGame(world);
    const state = new TdPresentState();
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const hashes: { tick: number; hash: string }[] = [];
    const maps = new Set<string>();
    let sent = 0;
    for (let tick = 0; tick <= run.ticks; tick++) {
      if (tick > 0) {
        input.next();
        game.step(input);
      }
      const snap = game.snapshot();
      const frame = presentWorld(world, snap['events'] as object[], { state, size: content.manifest.screen });
      if (tick % 40 === 0) expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
      if (isFullMap(frame.map!)) sent++;
      maps.add(frame.map!.id);
      if (tick % run.hashEvery === 0) hashes.push({ tick, hash: hash(game.snapshot()) });
    }
    expect(hashes).toEqual(golden.hashes.filter((h) => h.tick % run.hashEvery === 0));
    expect([...maps]).toEqual(['courtyard', 'courtyard>guard-room', 'guard-room']);
    // Each map is sent once: a slide only moves the camera, so its map is not sent again.
    expect(sent).toBe(maps.size);
  });
});
