import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSong, parseMml } from '@engine/core/audio/mml';
import { NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { canonicalJson } from '@engine/core/headless';
import { validate } from '@engine/core/content/validate';
import { isFullMap, presentFrameSchema } from '@engine/core/present';
import { PRESENT_TILES, presentWorld, TdPresentState, topdownGame } from '@kits/topdown';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { dungeonRooms, dungeonSkin, loadDungeon, mustLoad } from './content';
import { createGame, createWorld } from './headless';
import { DungeonPicture, dungeonEnd, dungeonLook } from './picture';
import { DungeonScene, END_HOLD } from './scene';

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
const content = mustLoad(loadDungeon(FILES));

/** The sample's files with one file's JSON changed by `edit`. */
function withJson(path: string, edit: (data: Record<string, unknown>) => void): Record<string, string> {
  const data = JSON.parse(FILES[path]!) as Record<string, unknown>;
  edit(data);
  return { ...FILES, [path]: JSON.stringify(data) };
}

describe('the dungeon sample', () => {
  it('loads its manifest and every content file', () => {
    expect(content.manifest).toMatchObject({ id: 'dungeon', kit: 'topdown', headless: 'headless.ts' });
    expect(content.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'room:bat-hall',
      'room:courtyard',
      'room:crypt',
      'room:guard-room',
      'room:store-room',
      'song:crypt',
      'song:daylight',
      'palette:dungeon',
      'palette:hero',
      'sprite:dungeon',
      'sprite:hero',
      'sfx:blast',
      'sfx:chest',
      'sfx:door',
      'sfx:fall',
      'sfx:fanfare',
      'sfx:fuse',
      'sfx:hit',
      'sfx:hurt',
      'sfx:kill',
      'sfx:pickup',
      'sfx:spit',
      'sfx:sword',
      'sfx:unlock',
      'skin:canvas2d',
    ]);
  });

  it('builds its rooms, starting in the courtyard', () => {
    const d = dungeonRooms(content);
    expect(d.startRoom).toBe('courtyard');
    expect([...d.rooms.keys()].sort()).toEqual([
      'bat-hall',
      'courtyard',
      'crypt',
      'guard-room',
      'store-room',
    ]);
    expect(d.rooms.get('store-room')?.def.chests).toEqual(['bomb']);
    expect(d.rooms.get('crypt')?.def).toMatchObject({ goal: true, chests: ['triforce'] });
  });

  it('runs headless: the hero walks east into the guard room, drawn through the skin', () => {
    const world = createWorld(content);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const { r, sprites } = countingRenderer();
    const picture = new DungeonPicture(r, dungeonLook(content));
    for (let i = 0; i < 400 && world.room.id === 'courtyard'; i++) {
      input.next();
      world.update(input);
      picture.draw(world, world.events.splice(0));
    }
    expect(world.room.id).toBe('guard-room');
    expect(sprites.get('hero')).toBeGreaterThan(0);
    // The map is drawn from the dungeon sheet (no map surface in Node: tile by tile).
    expect(sprites.get('dungeon')).toBeGreaterThan(0);
  });

  it('has songs that compile, every channel of a song as long as the others', () => {
    const songs = contentSongs(content);
    expect(songs.map((s) => s.id)).toEqual(['crypt', 'daylight']);
    for (const song of songs) {
      expect(compileSong(song).length).toBeGreaterThan(0);
      const lengths = (['pulse1', 'pulse2', 'triangle', 'noise'] as const).flatMap((ch) =>
        song[ch]
          ? [parseMml(song[ch], ch.startsWith('pulse') ? 'pulse' : (ch as 'triangle' | 'noise')).length]
          : [],
      );
      expect(new Set(lengths).size, song.id).toBe(1);
    }
  });

  it('has a sound effect for every sound its skin names', () => {
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    const sounds = Object.values(dungeonSkin(content).events ?? {}).flatMap((e) =>
      e.sound ? [e.sound] : [],
    );
    expect(sounds.length).toBeGreaterThan(0);
    for (const s of sounds) expect(sfx.has(s)).toBe(true);
  });
});

describe('the dungeon sample: broken content', () => {
  it('names the file and the field of a broken room field', () => {
    const r = loadDungeon(withJson('content/rooms/courtyard.json', (d) => (d.at = [0, 'one'])));
    expect(r.errors).toMatchObject([
      { file: 'games/samples/dungeon/content/rooms/courtyard.json', path: 'at.1', code: 'invalid_type' },
    ]);
  });

  it('names the map file, row and line of a bad map character', () => {
    const map = FILES['content/rooms/guard-room.map.txt']!.replace('#...b', '#...?');
    const r = loadDungeon({ ...FILES, 'content/rooms/guard-room.map.txt': map });
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
    const r = loadDungeon(withJson('content/songs/crypt.json', (d) => (d.noise = 'k s q9')));
    expect(r.errors).toMatchObject([
      { file: 'games/samples/dungeon/content/songs/crypt.json', path: 'noise', code: 'invalid_mml' },
    ]);
  });

  it('names game.json and the field of a broken manifest', () => {
    const r = loadDungeon(withJson('game.json', (d) => (d.start = { seed: -1 })));
    expect(r.errors).toMatchObject([
      { file: 'games/samples/dungeon/game.json', path: 'start.seed', code: 'too_small' },
    ]);
  });
});

describe('the dungeon sample: presentation frames (0.4-5)', () => {
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

describe('the dungeon sample: drawn by the Canvas2D backend through its skin (0.4-7)', () => {
  const skin = dungeonSkin(content);

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

  it("draws the kit's `triforce` item as the sample's own relic frame, not a borrowed symbol", () => {
    expect(skin.kinds['pickup:triforce']?.frames).toEqual({ idle: 'relic' });
    expect(skin.kinds['held']?.frames?.triforce).toBe('relic');
    const sheet = FILES['content/sprites/dungeon.txt']!;
    expect(sheet).toMatch(/^frame relic$/m);
    expect(sheet).not.toMatch(/^frame triforce$/m);
  });

  it("plays the skin's sound for an event in the walk-east run (the room change)", () => {
    const world = createWorld(content);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    world.events.splice(0); // entering the first room, before any step (the scene drops it too)
    const sounds: { tick: number; id: string }[] = [];
    let tick = 0;
    const picture = new DungeonPicture(new NullRenderer(), dungeonLook(content), {
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
    for (const name of ['renderWorld', 'drawTdHud', 'drawRoomTiles', 'drawFrame', 'drawStunned']) {
      expect(code).not.toContain(name);
    }
    expect(code).not.toMatch(/\.render\(r, /);
  });
});

describe('the dungeon sample: original art, end states and the scene (Engine 0.15 T12)', () => {
  interface Run {
    seed: number;
    ticks: number;
    input: InputScript;
  }
  const runs = readdirSync(fileURLToPath(new URL('./runs/', import.meta.url)))
    .filter((f) => f.endsWith('.run.json'))
    .sort();
  const readRun = (name: string) =>
    JSON.parse(readFileSync(new URL(`./runs/${name}`, import.meta.url), 'utf8')) as Run;
  const FALLBACK = dungeonSkin(content).sheets?.fallbackColor;

  it('has run files for the walk, the way out and a fall', () => {
    expect(runs).toEqual(['escape.run.json', 'lost-in-the-guard-room.run.json', 'walk-east.run.json']);
  });

  it("names no placeholder art: every sheet and palette is the sample's own", () => {
    for (const f of Object.keys(FILES)) expect(f).not.toMatch(/placeholder|demo/);
    expect(FALLBACK).toBeDefined();
    for (const entry of Object.values(dungeonSkin(content).kinds))
      expect(entry.fallbackColor).toBeUndefined();
    for (const entry of Object.values(dungeonSkin(content).tiles ?? {}))
      expect(entry.fallbackColor).toBeUndefined();
  });

  it.each(runs)('draws every tick of %s from the art, never a fallback box', (name) => {
    const run = readRun(name);
    const world = createWorld(content, run.seed);
    const input = new ScriptedInput(run.input);
    world.events.splice(0);
    let sprites = 0;
    let fallbacks = 0;
    const r: Renderer = Object.assign(new NullRenderer(), {
      sprite() {
        sprites++;
      },
      rect(_x: number, _y: number, _w: number, _h: number, color: string) {
        if (color === FALLBACK) fallbacks++;
      },
    });
    const picture = new DungeonPicture(r, dungeonLook(content));
    for (let tick = 0; tick <= run.ticks; tick++) {
      if (tick > 0) {
        input.next();
        world.update(input);
      }
      picture.draw(world, world.events.splice(0));
    }
    expect(sprites).toBeGreaterThan(0);
    expect(fallbacks).toBe(0);
  });

  it('ends escaped after the way out and fallen after the guard room', () => {
    const play = (name: string) => {
      const run = readRun(name);
      const world = createWorld(content, run.seed);
      const input = new ScriptedInput(run.input);
      for (let t = 0; t < run.ticks; t++) {
        input.next();
        world.update(input);
      }
      return world;
    };
    const escaped = play('escape.run.json');
    expect(dungeonEnd(escaped)).toBe('escaped');
    expect(escaped.found.has('triforce')).toBe(true);
    expect(dungeonEnd(play('lost-in-the-guard-room.run.json'))).toBe('fallen');
    expect(dungeonEnd(createWorld(content))).toBeNull();
  });

  it('plays the run files in its scene: the same snapshots, then holds the end until Z starts over', () => {
    const run = readRun('escape.run.json');
    const music: string[] = [];
    const scene = new DungeonScene(content, dungeonLook(content), { music: (id) => music.push(id) });
    scene.enter();
    const game = createGame(content, run.seed);
    const input = new ScriptedInput(run.input);
    expect(scene.headless().snapshot()).toEqual(game.snapshot());
    for (let t = 1; t <= run.ticks; t++) {
      input.next();
      scene.update(input);
      game.step(input);
      if (t % 60 === 0) expect(scene.headless().snapshot(), `tick ${t}`).toEqual(game.snapshot());
    }
    expect(music).toEqual(['crypt', 'daylight']);
    expect(scene.headless().snapshot()['exited']).toBe(true);
    // The end holds until Z (jump) is pressed at least END_HOLD steps after it (the world steps
    // on, as headless); then a new run starts in the courtyard.
    const press = (held: Action[]) => {
      const i = new ScriptedInput({ steps: [{ frame: 0, hold: held }] });
      i.next();
      return i;
    };
    const fresh = new DungeonScene(content, dungeonLook(content));
    const exited = (s: DungeonScene) => s.headless().snapshot()['exited'];
    for (let t = 1; t <= run.ticks && !exited(fresh); t++) fresh.update(press([]));
    expect(exited(fresh)).toBe(false); // nobody walked: still playing
    expect(scene.headless().snapshot()).toEqual(game.snapshot());
    for (let i = 0; i < END_HOLD; i++) scene.update(press([]));
    expect(scene.headless().snapshot()).toMatchObject({ exited: true, frame: run.ticks + END_HOLD });
    scene.update(press(['jump']));
    expect(scene.headless().snapshot()).toMatchObject({ exited: false, room: 'courtyard', frame: 0 });
    expect(music.at(-1)).toBe('crypt');
  });
});
