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
import { withContentImages } from '@engine/core/assets/content-images';
import type { ContentBundle } from '@engine/core/content/bundle';
import { dataUrlBytes, readPngSize } from '@engine/core/content/png';
import { canonicalJson } from '@engine/core/headless';
import { validate } from '@engine/core/content/validate';
import { isFullMap, presentFrameSchema, resolveSkinEvent, skinSoundCue } from '@engine/core/present';
import { PRESENT_TILES, presentWorld, TdPresentState, topdownGame } from '@kits/topdown';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { LayerMix, mixWhenHolds } from '@engine/core/audio/mix';
import { Mixer, type MixerAudio } from '@engine/core/audio/mixer';
import { dungeonRooms, dungeonSkin, loadDungeon, mustLoad } from './content';
import { createGame, createWorld } from './headless';
import { bossBeaten, DungeonPicture, dungeonEnd, dungeonLook, endBanner, endLines, HUD_TOP } from './picture';
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
const loaded = mustLoad(loadDungeon(FILES));
/**
 * The bundle with its skin's PNG sheets "decoded" for Node: each image's size from its header and
 * no pixels (the recording renderers here never look at them), as `withContentImages` gives the
 * page and the screenshot tool the real ones.
 */
const content: ContentBundle = await withContentImages(loaded, async (url) => {
  const size = readPngSize(dataUrlBytes(url)!)!;
  return { image: null, width: size.width, height: size.height, data: null };
});

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
      'room:chasm',
      'room:courtyard',
      'room:crypt',
      'room:guard-room',
      'room:ossuary',
      'room:store-room',
      'room:warden-hall',
      'song:crypt',
      'song:daylight',
      // The boss music (Engine 0.16 part C T9): three layers and the victory tune.
      'song:warden-calm',
      'song:warden-falls',
      'song:warden-fight',
      'song:warden-rage',
      // The art pass (Engine 0.16 part C T3): two text sheets derived from the CC0 pack.
      'palette:crypt-art',
      'palette:crypt-floor',
      'sprite:crypt-art',
      'sprite:crypt-floor',
      'sfx:blast',
      'sfx:chest',
      'sfx:dash',
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
      'sfx:ui-back',
      'sfx:ui-move',
      'sfx:ui-select',
      'sfx:unlock',
      'sfx:warden-charge',
      'sfx:warden-defeat',
      'sfx:warden-hit',
      'sfx:warden-roar',
      'sfx:warden-shoot',
      'sfx:warden-slam',
      'sfx:warden-summon',
      'sfx:warden-warn',
      'skin:canvas2d',
      // The menus' fonts (Engine 0.16 T9).
      'font:crypt-small',
      'font:crypt-title',
    ]);
  });

  it('builds its rooms, starting in the courtyard', () => {
    const d = dungeonRooms(content);
    expect(d.startRoom).toBe('courtyard');
    expect([...d.rooms.keys()].sort()).toEqual([
      'bat-hall',
      'chasm',
      'courtyard',
      'crypt',
      'guard-room',
      'ossuary',
      'store-room',
      'warden-hall',
    ]);
    expect(d.rooms.get('store-room')?.def.chests).toEqual(['bomb']);
    expect(d.rooms.get('crypt')?.def).toMatchObject({ goal: true, chests: ['relic'] });
  });

  it('has its final eight rooms (Engine 0.16 part C T8): the dash, a key past the pits and the locked boss door', () => {
    const d = dungeonRooms(content);
    expect(d.rooms.size).toBe(8);
    const chasm = d.rooms.get('chasm')!;
    expect(chasm.def.chests).toEqual(['dash']);
    expect(chasm.doors).toMatchObject({ n: 'open', e: 'locked', s: 'open' });
    const ossuary = d.rooms.get('ossuary')!;
    expect([ossuary.gx, ossuary.gy]).toEqual([0, 3]);
    expect(ossuary.doors).toEqual({ n: 'open' });
    expect(ossuary.spawns.filter((s) => s.kind === 'key')).toHaveLength(1);
    expect(ossuary.tiles.filter((t) => t === 'pit').length).toBeGreaterThan(20);
    expect(d.rooms.get('warden-hall')?.def.boss?.id).toBe('warden');
    // Every room is lit: braziers or lit torches, and the new rooms dressed with the pack's props.
    const lighting = dungeonSkin(content).lighting;
    for (const id of ['chasm', 'ossuary', 'warden-hall'])
      expect(lighting?.maps?.[id]?.lights?.length ?? 0).toBeGreaterThan(2);
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
    // The hero from the CC0 sheet, the map from the text sheets cut from it (no map surface in
    // Node: tile by tile).
    expect(sprites.get('crypt-actors')).toBeGreaterThan(0);
    expect(sprites.get('crypt-art')).toBeGreaterThan(0);
    expect(sprites.get('crypt-floor')).toBeGreaterThan(0);
  });

  it('has songs that compile, every channel of a song as long as the others', () => {
    const songs = contentSongs(content);
    expect(songs.map((s) => s.id)).toEqual([
      'crypt',
      'daylight',
      'warden-calm',
      'warden-falls',
      'warden-fight',
      'warden-rage',
    ]);
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
    // The boss bar's values exist only while a boss is in the room (the win run shows them).
    for (const item of skin.hud ?? [])
      if (item.status !== undefined && !item.status.startsWith('boss'))
        expect(Object.keys(status)).toContain(item.status);
  });

  it("draws the kit's `relic` item as a gem-set sword from the CC0 sheet, not a borrowed symbol", () => {
    expect(skin.kinds['pickup:relic']?.frames).toEqual({ idle: 'gem-sword' });
    expect(skin.kinds['pickup:relic']?.sheet).toBe('crypt-items');
    expect(JSON.stringify(skin.kinds['held']?.frames?.relic)).toContain('gem-sword');
    for (const f of Object.keys(FILES)) expect(FILES[f]!).not.toMatch(/triforce/i);
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
    for (const name of [
      'renderWorld',
      'drawTdHud',
      'drawRoomTiles',
      'drawFrame',
      'drawStunned',
      'debugText',
    ]) {
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

  it('has run files for the walk, the way out, a fall, (0.16 part C T5) the dash over the chasm, (T8) the way to the boss door and (T9) the win and the loss to the boss', () => {
    expect(runs).toEqual([
      'boss-lost.run.json',
      'cross-the-chasm.run.json',
      'escape.run.json',
      'lost-in-the-guard-room.run.json',
      'to-the-boss-door.run.json',
      'walk-east.run.json',
      'win.run.json',
    ]);
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

  it('shows the warden (Engine 0.16 part C T6): its kind, its HUD bar and placed boss events', () => {
    const run = readRun('win.run.json');
    const world = createWorld(content, run.seed);
    const input = new ScriptedInput(run.input);
    const state = new TdPresentState();
    const skin = dungeonSkin(content);
    const seen = new Set<string>();
    let bar = false;
    // T8 put the warden behind the ossuary's key and the chasm's locked door; T9's fight ends at 1879.
    for (let t = 0; t < run.ticks; t++) {
      input.next();
      world.update(input);
      const frame = presentWorld(world, world.events.splice(0), { state });
      for (const e of frame.entities) seen.add(e.kind);
      if (frame.status['bossName'] === 'The Bone Warden' && frame.status['bossMaxHp'] === 6) bar = true;
      for (const e of frame.events)
        if (String(e.type).startsWith('boss-')) {
          expect(typeof e.x, e.type).toBe('number');
          expect(skin.events?.[e.type], e.type).toBeDefined();
        }
    }
    expect(bar).toBe(true);
    expect([...seen]).toEqual(expect.arrayContaining(['boss:warden', 'boss-shot', 'bat']));
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
    expect(escaped.found.has('relic')).toBe(true);
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

describe('the dungeon sample: 16:9 on the CC0 art (Engine 0.16 part C T3)', () => {
  const skin = dungeonSkin(content);
  const PNG = 'assets/dungeon-tileset-ii/sheet.png';

  it('draws at 320x180, so 6x is 1920x1080, with the room in the middle', () => {
    expect(content.manifest.screen).toEqual({ width: 320, height: 180 });
    const frame = presentWorld(createWorld(content), [], { size: content.manifest.screen, top: HUD_TOP });
    // The 256x176 room is centred: 32 px margins at the sides, 2 px above and below.
    expect(frame.camera).toEqual({ x: 128, y: 88 });
  });

  it('takes every sheet from the CC0 pack: its PNG, or the text sheets cut from it', () => {
    expect(Object.values(skin.images ?? {}).map((i) => i.image)).toEqual([PNG, PNG, PNG]);
    const sheets = new Set(Object.keys(skin.images ?? {}));
    const text = new Set(['crypt-art', 'crypt-floor']);
    const used = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (k === 'sheet' && typeof x === 'string') used.add(x);
          walk(x);
        }
    };
    walk({ kinds: skin.kinds, tiles: skin.tiles, hud: skin.hud });
    used.add(skin.sheets!.sheet!);
    for (const s of used) expect(sheets.has(s) || text.has(s), s).toBe(true);
    expect(FILES['content/sprites/crypt-art.txt']).toMatch(/CC0 DungeonTileset II/);
  });

  it('joins the walls by their neighbours and varies the floor', () => {
    const wall = skin.tiles?.['#'];
    expect(Object.keys(wall?.join?.frames ?? {}).sort()).toEqual(
      [
        'bottom',
        'inner-bottom-left',
        'inner-bottom-right',
        'inner-top-left',
        'inner-top-right',
        'left',
        'right',
        'top',
      ].sort(),
    );
    expect(skin.tiles?.['.']?.vary?.frames).toHaveLength(8);
    for (const door of ['O', 'L', 'X', 'C', 'H', 'E'])
      expect(Object.keys(skin.tiles?.[door]?.join?.frames ?? {}), door).toContain('right bottom');
  });

  it('shows the hero idle, walking with footsteps, and the monsters flashing white when hit', () => {
    const hero = skin.kinds['hero']!;
    expect(Object.keys(hero.frames ?? {})).toEqual(
      expect.arrayContaining(['idle', 'walk', 'attack', 'throw', 'hurt', 'dying', 'poof']),
    );
    expect(JSON.stringify(hero.frames?.['walk'])).toContain('footstep');
    for (const kind of ['bat', 'knight', 'spitter'])
      expect(skin.kinds[kind]?.byTag?.[0]).toMatchObject({ tag: 'flashing' });
    const world = createWorld(content);
    const state = new TdPresentState();
    const at = () =>
      presentWorld(world, [], { state, size: content.manifest.screen, idle: true }).entities.find(
        (e) => e.id === 'hero',
      )!.anim.state;
    expect(at()).toBe('idle');
  });

  it('hides the HUD and the end banner under the title (showHud false)', () => {
    const drawn = (shown: boolean) => {
      let n = 0;
      const r: Renderer = Object.assign(new NullRenderer(), {
        sprite() {
          n++;
        },
      });
      const picture = new DungeonPicture(r, dungeonLook(content));
      picture.showHud(shown);
      picture.draw(createWorld(content), []);
      return n;
    };
    expect(drawn(false)).toBeLessThan(drawn(true));
  });

  it('writes the end banner once a run has ended', () => {
    const look = dungeonLook(content);
    expect(endBanner(look, null, false)).toEqual([]);
    expect(endLines('escaped', true)?.[0]).toBe('You escaped with the relic!');
    expect(endLines('fallen', false)?.[0]).toBe('You fell in the crypt.');
    const draws = endBanner(look, 'fallen', false);
    expect(draws.filter((d) => d.kind === 'image').length).toBe(9);
    expect(draws.some((d) => d.kind === 'glyph')).toBe(true);
  });
});

describe('the dungeon sample: the boss room, the win and the loss (Engine 0.16 part C T9)', () => {
  const skin = dungeonSkin(content);
  const look = dungeonLook(content);
  const readRun = (name: string) =>
    JSON.parse(readFileSync(new URL(`./runs/${name}`, import.meta.url), 'utf8')) as {
      seed: number;
      ticks: number;
      input: InputScript;
    };
  type Frame = ReturnType<typeof presentWorld>;
  /** Plays a run file, presenting every tick (as the page does) to `each`; returns the world. */
  const eachFrame = (name: string, each: (frame: Frame, tick: number) => void) => {
    const run = readRun(name);
    const world = createWorld(content, run.seed);
    const input = new ScriptedInput(run.input);
    const state = new TdPresentState();
    world.events.splice(0);
    for (let tick = 1; tick <= run.ticks; tick++) {
      input.next();
      world.update(input);
      each(presentWorld(world, world.events.splice(0), { state, size: look.screen, top: HUD_TOP }), tick);
    }
    return world;
  };
  const warden = dungeonRooms(content).rooms.get('warden-hall')!.def;

  it('declares the Bone Warden in data: six hit points, three phases, sealed until beaten, its flag', () => {
    expect(warden).toMatchObject({ shutters: 'boss', dark: true, music: 'warden' });
    expect(warden.boss).toMatchObject({ id: 'warden', name: 'The Bone Warden', hp: 6, flag: 'bossDefeated' });
    expect(warden.boss!.phases!.map((p) => p.hp)).toEqual([4, 2]);
    // Every attack is announced by a telegraph naming it, in every phase.
    for (const pattern of [warden.boss!.pattern, ...warden.boss!.phases!.map((p) => p.pattern)])
      pattern.forEach((step, i) => {
        if (step.do === 'idle' || step.do === 'telegraph') return;
        expect(pattern[i - 1], `${step.do} at ${i}`).toMatchObject({ do: 'telegraph', attack: step.do });
      });
  });

  it('ends won after the win run, fallen in the boss hall after the loss', () => {
    const won = eachFrame('win.run.json', () => {});
    expect(dungeonEnd(won)).toBe('won');
    expect(bossBeaten(won)).toBe('The Bone Warden');
    expect([...won.flags]).toEqual(['bossDefeated']);
    expect(won.hero.dead).toBe(false);
    expect(endLines('won', false, 'The Bone Warden')?.[0]).toBe('The Bone Warden is at rest!');
    const lost = eachFrame('boss-lost.run.json', () => {});
    expect(dungeonEnd(lost)).toBe('fallen');
    expect(lost.room.id).toBe('warden-hall');
    expect(bossBeaten(lost)).toBeNull();
  });

  it("fires the shell's endings from the frame status: the victory dialog and tune after the win, the fall after the loss", () => {
    const menus = content.manifest.menus!;
    const ending = (name: string) => {
      let hit: string | undefined;
      eachFrame(name, (frame) => {
        hit ??= menus.triggers!.end!.find((t) => mixWhenHolds(t.when, frame.status))?.dialog;
      });
      return hit;
    };
    expect(ending('win.run.json')).toBe('victory');
    expect(ending('boss-lost.run.json')).toBe('fallen');
    const victory = menus.triggers!.end!.find((t) => t.dialog === 'victory')!;
    expect(victory.music).toBe('warden-falls');
    expect(contentSongs(content).find((s) => s.id === 'warden-falls')?.loop).toBe(false);
    // The intro says who the hero is and why the crypt; the end dialogs have his portrait.
    expect(menus.triggers!.intro).toBe('intro');
    expect(menus.dialogs!['intro']!.pages.join(' ')).toMatch(/Edrin.*Bone Warden/s);
    for (const id of ['intro', 'victory', 'escaped'])
      expect(menus.dialogs![id]!.portrait).toEqual({ sheet: 'crypt-actors', frame: 'knight-idle-0' });
    expect(menus.end!.lines!.map((l) => l.status)).toEqual(['time', 'roomsSeen', 'hp']);
  });

  it('plays the win in its scene with the headless snapshots: the crypt, the warden music, the victory tune', () => {
    const run = readRun('win.run.json');
    const music: string[] = [];
    const scene = new DungeonScene(content, look, { music: (id) => music.push(id) });
    scene.enter();
    const game = createGame(content, run.seed);
    const input = new ScriptedInput(run.input);
    const r: Renderer = new NullRenderer();
    for (let t = 1; t <= run.ticks; t++) {
      input.next();
      scene.update(input);
      game.step(input);
      if (t % 30 === 0) {
        scene.render(r);
        expect(scene.headless().snapshot(), `tick ${t}`).toEqual(game.snapshot());
      }
    }
    expect(music).toEqual(['crypt', 'warden', 'warden-falls']);
    expect(scene.headless().snapshot()['flags']).toEqual(['bossDefeated']);
    // With the shell's endings the shell plays the victory tune.
    const shell: string[] = [];
    const shellScene = new DungeonScene(content, look, { music: (id) => shell.push(id), shellEnds: true });
    shellScene.enter();
    const again = new ScriptedInput(run.input);
    for (let t = 1; t <= run.ticks; t++) {
      again.next();
      shellScene.update(again);
    }
    expect(shell).toEqual(['crypt', 'warden']);
  });

  it('shows hearts, keys, the selected item and the boss bar with its name in the HUD', () => {
    const hud = skin.hud ?? [];
    const item = (status: string, as: string) => hud.find((h) => h.status === status && h.as === as);
    expect(item('hp', 'hearts')).toBeDefined();
    expect(item('keys', 'counter')).toBeDefined();
    expect(item('item', 'icon')?.frames).toEqual({ bomb: 'bomb', dash: 'flask-big-green' });
    expect(item('bossHp', 'bar')).toMatchObject({ max: 'bossMaxHp', when: 'bossHp' });
    expect(item('bossName', 'text')).toMatchObject({ when: 'bossHp' });
    let fight: Frame['status'] | null = null;
    eachFrame('win.run.json', (frame, tick) => {
      if (tick === 1400) fight = frame.status;
    });
    expect(fight).toMatchObject({
      item: 'dash',
      bossName: 'The Bone Warden',
      bossHp: 4,
      bossMaxHp: 6,
      keys: 0,
    });
  });

  it('draws the warden in its own poses: telegraphs, the hit flash and its red-hot last phase', () => {
    const entry = skin.kinds['boss:warden']!;
    for (const step of [warden.boss!.pattern, ...warden.boss!.phases!.map((p) => p.pattern)].flat())
      if (step.do === 'telegraph') expect(Object.keys(entry.frames!)).toContain(`telegraph-${step.attack}`);
    const rage = entry.byTag!.find((l) => l.prefix === 'phase:')!;
    expect(rage.min).toBe(2);
    expect(JSON.stringify(rage.frames)).toContain('demon-rage');
    const states = new Set<string>();
    const tags = new Set<string>();
    eachFrame('win.run.json', (frame) => {
      for (const e of frame.entities)
        if (e.kind === 'boss:warden') {
          states.add(e.anim.state);
          for (const t of e.tags) tags.add(t);
        }
    });
    expect([...states]).toEqual(
      expect.arrayContaining(['idle', 'telegraph-charge', 'charge', 'telegraph-shoot', 'hurt', 'dying']),
    );
    expect([...tags]).toEqual(expect.arrayContaining(['phase:2', 'flashing']));
  });

  it('has a sound for every boss action and the dash, and their sfx', () => {
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    const attacks = new Set(
      [warden.boss!.pattern, ...warden.boss!.phases!.map((p) => p.pattern)].flat().map((s) => s.do),
    );
    attacks.delete('idle');
    attacks.delete('telegraph');
    const sounds = new Set<string>();
    for (const attack of attacks) {
      for (const type of ['boss-telegraph', 'boss-attack']) {
        const entry = resolveSkinEvent(skin.events, { type, attack });
        expect(entry?.sound, `${type} ${attack}`).toBeDefined();
        expect(sfx.has(entry!.sound!)).toBe(true);
        sounds.add(entry!.sound!);
      }
    }
    expect(sounds.size).toBeGreaterThanOrEqual(5); // each attack its own sound, the warnings shared
    for (const type of ['boss-hit', 'boss-phase', 'boss-defeat', 'boss-defeated', 'dash'])
      expect(sfx.has(resolveSkinEvent(skin.events, { type })?.sound ?? ''), type).toBe(true);
  });

  it('mixes the warden music from the frame status: calm at first, the fight on a hit, rage in the last phase, silence once beaten', () => {
    const music = skin.music!['warden']!;
    expect(music.layers).toEqual({ calm: 'warden-calm', fight: 'warden-fight', rage: 'warden-rage' });
    const songs = new Map(contentSongs(content).map((s) => [s.id, s]));
    const lengths = Object.values(music.layers).map((id) => {
      const song = songs.get(id)!;
      expect(song).toMatchObject({ bpm: 132, loop: true });
      return compileSong(song).length;
    });
    expect(new Set(lengths).size).toBe(1);
    const mix = new LayerMix(music);
    const seen: { status: Frame['status']; gains: Record<string, number> }[] = [];
    eachFrame('win.run.json', (frame) => {
      if (frame.status['room'] === 'warden-hall')
        seen.push({ status: frame.status, gains: mix.update(frame.status) });
    });
    const first = seen[1]!;
    expect(first.gains).toMatchObject({ calm: 1, rage: 0 });
    expect(first.gains['fight']!).toBeLessThan(0.5);
    expect(
      seen.some((s) => s.status['bossHp'] === 5 && s.gains['fight'] === 1 && s.gains['rage'] === 0),
    ).toBe(true);
    expect(seen.some((s) => s.status['bossPhase'] === 2 && s.gains['rage'] === 1)).toBe(true);
    expect(Math.max(...Object.values(seen.at(-1)!.gains))).toBe(0);
  });

  it('ducks the music under big hits through the shell mixer: each boss hit, the slam and the defeat', () => {
    for (const key of ['hurt', 'boss-hit', 'boss-attack:attack=slam', 'boss-defeat'])
      expect(skin.events![key]!.duck?.amount, key).toBeGreaterThanOrEqual(0.5);
    const ducks: number[] = [];
    const played: string[] = [];
    const audio: MixerAudio = {
      playMusic: (id) => void played.push(id),
      sfx: () => {},
      setLayerGains: () => {},
      setDuck: (f) => void ducks.push(f),
      volumeLevels: { master: 1, music: 1, sfx: 1, muted: false },
    };
    const mixer = new Mixer({ audio, music: skin.music!, seed: 1 });
    mixer.play('warden');
    const hits: number[] = [];
    eachFrame('win.run.json', (frame, tick) => {
      mixer.frameStatus(frame.status);
      for (const ev of frame.events) {
        const entry = resolveSkinEvent(skin.events, ev as { type: string });
        if (entry?.sound !== undefined) mixer.sound(entry.sound, skinSoundCue(entry, frame.frame));
        if (ev.type === 'boss-hit') hits.push(tick);
      }
      mixer.tick();
    });
    expect(played).toEqual(['warden']);
    expect(hits.length).toBe(6); // the sixth starts the defeat too
    for (const tick of hits) expect(Math.min(...ducks.slice(tick - 1, tick + 6))).toBeLessThan(0.6);
    expect(ducks.slice(hits[0]!, hits[1]!)).toContain(1);
  });
});
