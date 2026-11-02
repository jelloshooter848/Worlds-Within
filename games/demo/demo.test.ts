import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { compileSong } from '@engine/core/audio/mml';
import { NullRenderer } from '@engine/backends/null';
import { AssetRegistry } from '@engine/core/assets/registry';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { renderWorld, sheetLookup } from '@kits/topdown';
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
