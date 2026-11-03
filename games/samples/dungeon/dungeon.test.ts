import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSong } from '@engine/core/audio/mml';
import { NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { canonicalJson } from '@engine/core/headless';
import { validate } from '@engine/core/content/validate';
import { isFullMap, presentFrameSchema } from '@engine/core/present';
import { PRESENT_TILES, presentWorld, TdPresentState, topdownGame } from '@kits/topdown';
import { demoDungeon, demoSfx, demoSkin, demoSongs, loadDemo, mustLoad } from './content';
import { createWorld } from './headless';
import { DemoPicture, demoLook } from './picture';

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
    expect(content.manifest).toMatchObject({ id: 'dungeon', kit: 'topdown', headless: 'headless.ts' });
    expect(content.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'room:courtyard',
      'room:guard-room',
      'room:store-room',
      'song:demo',
      'palette:demo-hero',
      'palette:demo-placeholders',
      'sprite:demo-hero',
      'sprite:demo-placeholders',
      'sfx:door',
      'sfx:hurt',
      'sfx:spit',
      'skin:canvas2d',
    ]);
  });

  it('builds its rooms, starting in the courtyard', () => {
    const d = demoDungeon(content);
    expect(d.startRoom).toBe('courtyard');
    expect([...d.rooms.keys()].sort()).toEqual(['courtyard', 'guard-room', 'store-room']);
    expect(d.rooms.get('store-room')?.def.chests).toEqual(['bombs']);
  });

  it('runs headless: the hero walks east into the guard room, drawn through the skin', () => {
    const world = createWorld(content);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const { r, sprites } = countingRenderer();
    const picture = new DemoPicture(r, demoLook(content));
    for (let i = 0; i < 400 && world.room.id === 'courtyard'; i++) {
      input.next();
      world.update(input);
      picture.draw(world, world.events.splice(0));
    }
    expect(world.room.id).toBe('guard-room');
    expect(sprites.get('demo-hero')).toBeGreaterThan(0);
    // The map is drawn from the placeholder sheet (no map surface in Node: tile by tile).
    expect(sprites.get('demo-placeholders')).toBeGreaterThan(0);
  });

  it('has a song that compiles', () => {
    const songs = demoSongs(content);
    expect(songs.map((s) => s.id)).toEqual(['demo']);
    expect(compileSong(songs[0]!).length).toBeGreaterThan(0);
  });

  it('has a sound effect for every sound its skin names', () => {
    const sfx = new Set(demoSfx(content).map((s) => s.id));
    const sounds = Object.values(demoSkin(content).events ?? {}).flatMap((e) => (e.sound ? [e.sound] : []));
    expect(sounds.length).toBeGreaterThan(0);
    for (const s of sounds) expect(sfx.has(s)).toBe(true);
  });
});

describe('engine demo: broken content', () => {
  it('names the file and the field of a broken room field', () => {
    const r = loadDemo(withJson('content/rooms/courtyard.json', (d) => (d.at = [0, 'one'])));
    expect(r.errors).toMatchObject([
      { file: 'games/samples/dungeon/content/rooms/courtyard.json', path: 'at.1', code: 'invalid_type' },
    ]);
  });

  it('names the map file, row and line of a bad map character', () => {
    const map = FILES['content/rooms/guard-room.map.txt']!.replace('#...b', '#...?');
    const r = loadDemo({ ...FILES, 'content/rooms/guard-room.map.txt': map });
    expect(r.errors).toMatchObject([
      {
        file: 'games/samples/dungeon/content/rooms/guard-room.map.txt',
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
      { file: 'games/samples/dungeon/content/songs/demo.json', path: 'noise', code: 'invalid_mml' },
    ]);
  });

  it('names game.json and the field of a broken manifest', () => {
    const r = loadDemo(withJson('game.json', (d) => (d.start = { seed: -1 })));
    expect(r.errors).toMatchObject([
      { file: 'games/samples/dungeon/game.json', path: 'start.seed', code: 'too_small' },
    ]);
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

describe('engine demo: drawn by the Canvas2D backend through its skin (0.4-7)', () => {
  const skin = demoSkin(content);

  it('maps every tile the kit presents, and every kind and HUD value walk-east shows', () => {
    for (const ch of Object.values(PRESENT_TILES)) expect(Object.keys(skin.tiles ?? {})).toContain(ch);
    const world = createWorld(content);
    const game = topdownGame(world);
    const state = new TdPresentState();
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const kinds = new Set<string>();
    let status: Record<string, unknown> = {};
    for (let tick = 1; tick <= 240; tick++) {
      input.next();
      game.step(input);
      const frame = presentWorld(world, [], { state });
      for (const e of frame.entities) kinds.add(e.kind);
      status = frame.status;
    }
    for (const k of kinds) expect(Object.keys(skin.kinds)).toContain(k);
    for (const item of skin.hud ?? []) expect(Object.keys(status)).toContain(item.status);
  });

  it("plays the skin's sound for an event in the walk-east run (the room change)", () => {
    const world = createWorld(content);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    world.events.splice(0); // entering the first room, before any step (the scene drops it too)
    const sounds: { tick: number; id: string }[] = [];
    let tick = 0;
    const picture = new DemoPicture(new NullRenderer(), demoLook(content), {
      onSound: (id) => sounds.push({ tick, id }),
    });
    for (tick = 1; tick <= 240; tick++) {
      input.next();
      world.update(input);
      picture.draw(world, world.events.splice(0));
    }
    // walk-east emits `room` at tick 89 (into the guard room) and `spit` at tick 240.
    expect(sounds).toEqual([
      { tick: 89, id: skin.events?.['room']?.sound },
      { tick: 240, id: skin.events?.['spit']?.sound },
    ]);
    expect(sounds.map((s) => s.id)).toEqual(['door', 'spit']);
  });

  it('calls no kit drawing function: the backend draws from the frame', () => {
    const dir = fileURLToPath(new URL('./', import.meta.url));
    const code = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(`${dir}${f}`, 'utf8'))
      .join('\n');
    for (const name of [
      'renderWorld',
      'drawTdHud',
      'drawRoomTiles',
      'drawFrame',
      'drawStunned',
      'DEMO_SHEETS',
    ]) {
      expect(code).not.toContain(name);
    }
    expect(code).not.toMatch(/\.render\(r, /);
  });
});
