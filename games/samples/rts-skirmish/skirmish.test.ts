import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter, NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import { compileSong, parseMml } from '@engine/core/audio/mml';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { mustLoad } from '@engine/core/content/game-content';
import { withContentImages } from '@engine/core/assets/content-images';
import type { ContentBundle } from '@engine/core/content/bundle';
import { dataUrlBytes, readPngSize } from '@engine/core/content/png';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { readGameFiles } from '@engine/core/node/game-files';
import { isFullMap, resolveSkinEvent, resolveSkinFrame, type PresentFrame } from '@engine/core/present';
import { stateHash } from '@engine/core/state-hash';
import {
  loadSkirmish,
  PLAYER,
  SKIRMISH_MUSIC,
  skirmishEnd,
  skirmishEnemy,
  skirmishMap,
  skirmishNames,
  skirmishScenario,
  skirmishTypes,
} from './content';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import { presentWorld, RtsControls, RtsPresentState, RTS_TILE_SIZE, type RtsView } from '@kits/rts';
import { RtsCamera } from '@engine/core/present';
import { createGame, sidesOf, skirmishResult, type SkirmishResult } from './headless';
import {
  BARK_TICKS,
  heardEvents,
  sideKinds,
  skirmishCanvasPicture,
  skirmishFrames,
  skirmishLook,
  type ShowsWorld,
} from './picture';
import { createView, directorCamera } from './view';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
/**
 * The bundle with its skin's PNG sheets (the CC0 pack, Engine 0.16 part D, D7) "decoded" for Node:
 * each image's size from its header and no pixels (the recording renderers here never look at
 * them), as `withContentImages` gives the page and the screenshot tool the real ones.
 */
const content: ContentBundle = await withContentImages(
  mustLoad(loadSkirmish(readGameFiles(ROOT))),
  async (url) => {
    const size = readPngSize(dataUrlBytes(url)!)!;
    return { image: null, width: size.width, height: size.height, data: null };
  },
);
const NO_INPUT = {} as InputFrame;

interface RunEntry extends JsonObject {
  tick: number;
}

/**
 * The ticks the drawing tests here play of a long run (D9: the ten-minute `match-won` and
 * `match-lost`, ~6000 ticks, are checked whole headless by `pnpm cli run`, the run-file tests and
 * `mutants`; drawing every tick of them here would take minutes), as `tests/runs/view-play.ts`'s
 * `presentedRun` cuts them for the presentation tests.
 */
const LONG_RUN_TICKS = 5000;
const PRESENTED_TICKS = 600;

/** A run file's orders (recorded orders or interface actions) and length (cut when long). */
function runFile(name: string): { ticks: number; hashEvery: number; orders?: RunEntry[] } {
  const run = JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
    ticks: number;
    hashEvery: number;
    orders?: RunEntry[];
  };
  return run.ticks < LONG_RUN_TICKS ? run : { ...run, ticks: PRESENTED_TICKS };
}

/**
 * Plays `name` headless as `pnpm cli run` does; `each` sees the game after every tick's orders,
 * `before` before them (as a page draws a tick's first frame before the player's clicks).
 */
function play(
  name: string,
  each?: (game: ReturnType<typeof createGame>) => void,
  before?: (game: ReturnType<typeof createGame>) => void,
) {
  const run = runFile(name);
  const game = createGame(content, 9);
  for (let t = 0; t < run.ticks; t++) {
    before?.(game);
    for (const { tick, ...o } of run.orders ?? []) if (tick === t) game.order(o as JsonObject);
    each?.(game);
    game.step(NO_INPUT);
  }
  return game;
}

describe('the skirmish content', () => {
  it('has one map, one types table, one AI plan and one end rule', () => {
    const map = skirmishMap(content);
    expect(map.systems).toBe('rts');
    expect([map.terrain.rows[0]!.length, map.terrain.rows.length]).toEqual([64, 40]);
    expect(Object.keys(skirmishTypes(content).units).sort()).toEqual(['archer', 'hero', 'soldier', 'worker']);
    expect(Object.keys(skirmishTypes(content).buildings).sort()).toEqual(['barracks', 'town-centre']);
    expect(skirmishEnemy(content).faction).toBe('blue');
    expect(skirmishEnemy(content).knowledge).toBe('fog');
    expect(skirmishEnd(content).faction).toBe(PLAYER);
  });

  it('names every unit type and building kind for the HUD (content/names, polish Q, D2)', () => {
    const names = skirmishNames(content);
    const types = skirmishTypes(content);
    expect(Object.keys(names.units).sort()).toEqual(Object.keys(types.units).sort());
    expect(Object.keys(names.buildings).sort()).toEqual(Object.keys(types.buildings).sort());
    expect(names.buildings['town-centre']).toBe('Town Centre');
  });

  it('has the river with three fords, and two bases mirrored across it', () => {
    const rows = skirmishMap(content).terrain.rows;
    const fords = rows.flatMap((row, y) => (row[31] !== '~' ? [y] : []));
    expect(fords).toEqual([6, 7, 19, 20, 32, 33]);
    // The map is the same turned half round (point symmetry), so neither side starts better placed.
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[0]!.length; x++)
        expect(rows[y]![x], `${x},${y}`).toBe(rows[rows.length - 1 - y]![rows[0]!.length - 1 - x]);
  });

  it('starts every unit and building with the numbers of its type', () => {
    const types = skirmishTypes(content);
    const scenario = skirmishScenario(content, 9);
    const all = [
      ...scenario.entities.map((e) => e.components),
      ...scenario.squads.flatMap((s) =>
        ((s['members'] ?? []) as { components: JsonObject }[]).map((m) => m.components),
      ),
    ] as Record<string, Record<string, unknown>>[];
    let units = 0;
    for (const c of all) {
      if (c['Unit'] !== undefined) {
        units++;
        const unit = c['Unit'] as { type: string };
        const t = types.units[unit.type]!;
        expect(c['Unit']).toEqual({
          type: unit.type,
          speed: t.speed,
          attack: t.attack,
          range: t.range,
          cooldown: t.cooldown,
          sight: t.sight,
        });
        expect(c['Health']).toEqual({ hp: t.health, max: t.health });
      }
      if (c['Building'] !== undefined) {
        const b = c['Building'] as { kind: string; w: number; h: number };
        const t = types.buildings[b.kind]!;
        expect({ w: b.w, h: b.h }).toEqual(t.size);
        expect(c['Health']).toEqual({ hp: t.health, max: t.health });
      }
    }
    expect(units).toBe(8);
  });

  it('has a hero: a named squad member with the role hero', () => {
    const view = createGame(content, 9).rts.view();
    const heroes = view.units.filter((u) => u.role === 'hero');
    expect(heroes.map((u) => [u.faction, u.type])).toEqual([[PLAYER, 'hero']]);
  });
});

describe('the skirmish headless', () => {
  it('lists both sides in the snapshot, the beaten one as empty', () => {
    const sides = sidesOf(createGame(content, 9).rts.view(), ['red', 'blue', 'green']);
    expect(sides['red']!.unitTypes).toEqual({ worker: 3, hero: 1 });
    expect(sides['red']!.stock).toEqual({ gold: 200 });
    expect(sides['blue']!.unitTypes).toEqual({ worker: 3, soldier: 1 });
    expect(sides['blue']!.buildings).toEqual({ 'town-centre': 1 });
    expect(sides['blue']!.units).toBe(4);
    expect(sides['green']).toEqual({ units: 0, unitTypes: {}, buildings: {}, sites: 0, stock: {} });
  });

  it('is repeatable: the same seed and orders give the same snapshots', () => {
    const a: string[] = [];
    const b: string[] = [];
    play('fog', (g) => a.push(canonicalJson(g.snapshot())));
    play('fog', (g) => b.push(canonicalJson(g.snapshot())));
    expect(a).toEqual(b);
  });

  it('records the interface actions as orders that replay to the same world', () => {
    const played = play('fog');
    const recorded = played.rts.recorded();
    expect(recorded.map((o) => [o.tick, o.type])).toEqual([
      [0, 'move'],
      [420, 'move'],
      [430, 'attack'],
    ]);
    const replay = createGame(content, 9);
    for (let t = 0; t < runFile('fog').ticks; t++) {
      for (const { tick, ...o } of recorded) if (tick === t) expect(replay.order(o)).toBeNull();
      replay.step(NO_INPUT);
    }
    expect(canonicalJson(replay.rts.snapshot())).toBe(canonicalJson(played.rts.snapshot()));
  });

  it('refuses an interface action nothing selected can take, and one that is not an action', () => {
    const game = createGame(content, 9);
    expect(game.order({ ui: 'train', unit: 'soldier' })).toBe('no selected building trains soldier');
    expect(game.order({ ui: 'wave' })).toMatch(/^not an interface action/);
    expect(game.rts.recorded()).toEqual([]);
  });
});

describe('the skirmish picture', () => {
  it('gives the enemy side kinds of its own, drawn from the pack in blue', () => {
    const frame = sideKinds({
      frame: 0,
      size: { width: 480, height: 270 },
      entities: [
        {
          id: 'unit-1',
          kind: 'unit:soldier',
          x: 0,
          y: 0,
          w: 16,
          h: 16,
          facing: 'down',
          anim: { state: 'idle', t: 0 },
          tags: ['enemy'],
          layer: 10,
        },
        {
          id: 'unit-2',
          kind: 'unit:soldier',
          x: 0,
          y: 0,
          w: 16,
          h: 16,
          facing: 'down',
          anim: { state: 'idle', t: 0 },
          tags: ['own'],
          layer: 10,
        },
        {
          id: 'unit-1/hp',
          kind: 'health-bar',
          x: 0,
          y: 0,
          w: 16,
          h: 2,
          facing: 'down',
          anim: { state: 'hp-8', t: 0 },
          tags: ['enemy'],
          layer: 20,
        },
      ],
      events: [],
      status: {},
    } satisfies PresentFrame);
    expect(frame.entities.map((e) => e.kind)).toEqual(['unit:soldier:enemy', 'unit:soldier', 'health-bar']);
    const { skin } = skirmishLook(content);
    expect(resolveSkinFrame(skin, frame.entities[0]!).frame).toBe('soldier-blue');
    expect(resolveSkinFrame(skin, frame.entities[1]!).frame).toBe('soldier-red');
  });

  it('has a sprite frame for every kind, state, facing and tile the match shows', () => {
    const { skin } = skirmishLook(content);
    const frames = skirmishFrames(content.manifest.screen, { fog: false });
    const presenter = new NullPresenter({ validate: true });
    const missing = new Set<string>();
    const tiles = new Set<string>();
    play('fog', (g) => {
      const frame = frames.next(g, []);
      presenter.present(frame);
      for (const e of frame.entities)
        if (resolveSkinFrame(skin, e).frame === null) missing.add(`${e.kind} ${e.anim.state} ${e.facing}`);
      if (frame.map && isFullMap(frame.map))
        for (const row of frame.map.tiles) for (const t of row) tiles.add(String(t));
    });
    expect([...missing].sort()).toEqual([]);
    expect([...tiles].sort()).toEqual(['0', '1', '2', '3']);
    for (const t of tiles) expect(skin.tiles?.[t]?.frame).toBeDefined();
  });

  it('draws a barracks site as scaffold, then half built from progress 50 (a byTag prefix look, M2)', () => {
    const { skin } = skirmishLook(content);
    const frames = skirmishFrames(content.manifest.screen, { fog: false });
    const seen = new Map<string, number[]>();
    play('ai-barracks', (g) => {
      for (const e of frames.next(g, []).entities) {
        const progress = e.tags.find((t) => t.startsWith('progress:'));
        if (!e.kind.startsWith('building:barracks') || progress === undefined) continue;
        const { frame } = resolveSkinFrame(skin, e);
        const at = Number(progress.slice('progress:'.length));
        seen.set(String(frame), [...(seen.get(String(frame)) ?? []), at]);
      }
    });
    expect([...seen.keys()].sort()).toEqual(['site-2x2', 'site-2x2-half']);
    expect(Math.max(...seen.get('site-2x2')!)).toBeLessThan(50);
    expect(Math.min(...seen.get('site-2x2-half')!)).toBeGreaterThanOrEqual(50);
  });

  it('takes the same orders as the headless game, and draws without changing it', () => {
    const view = createView(content, 9);
    const game = createGame(content, 9);
    const run = runFile('opening');
    for (let t = 0; t < 60; t++) {
      for (const { tick, ...o } of run.orders ?? [])
        if (tick === t) expect(view.order(o as JsonObject)).toBe(game.order(o as JsonObject));
      view.step(NO_INPUT);
      game.step(NO_INPUT);
    }
    expect(canonicalJson(view.snapshot())).toBe(canonicalJson(game.snapshot()));
    let sprites = 0;
    const r = new (class extends NullRenderer {
      override sprite(): void {
        sprites++;
      }
    })();
    view.render(r);
    // The 30 x 17 tiles in view (no map cache in Node), the units, the town centre and the HUD.
    expect(sprites).toBeGreaterThan(500);
    const snapshot = canonicalJson(view.snapshot());
    view.render(r);
    expect(canonicalJson(view.snapshot())).toBe(snapshot);
  });

  it("shows the run's selection, its commands' markers and barks, and frames the action (D10)", () => {
    const view = createView(content, 9);
    const run = runFile('fog');
    const frames: PresentFrame[] = [];
    for (let t = 0; t <= 436; t++) {
      for (const { tick, ...o } of run.orders ?? []) if (tick === t) view.order(o as JsonObject);
      frames.push(view.frame!() as PresentFrame);
      view.step(NO_INPUT);
    }
    // Tick 0: the hero clicked and sent off: selected, its marker and bark, the camera on him.
    const first = frames[0]!;
    expect(first.entities.some((e) => e.kind === 'selection-ring')).toBe(true);
    expect(first.entities.some((e) => e.kind === 'order-marker')).toBe(true);
    expect(first.status['bark']).toBe('move');
    // Tick 436: the hero's attack on the sentry: its marker, the path dots, "To arms!".
    const last = frames[436]!;
    expect(last.entities.filter((e) => e.kind === 'order-marker').map((e) => e.anim.state)).toContain(
      'attack',
    );
    expect(last.entities.some((e) => e.kind === 'path-dot')).toBe(true);
    expect(last.status['bark']).toBe('attack');
  });

  it('names the selection and the training unit from content/names, not by id (polish Q, D2)', () => {
    const view = createView(content, 9);
    const run = runFile('match-won');
    let frame: PresentFrame | null = null;
    for (let t = 0; t <= 4; t++) {
      for (const { tick, ...o } of run.orders ?? []) if (tick === t) view.order(o as JsonObject);
      frame = view.frame!() as PresentFrame;
      view.step(NO_INPUT);
    }
    // Tick 4 (before-02-selection-name.png): the town centre selected, training a worker.
    expect(frame!.status).toMatchObject({
      selectedName: 'Town Centre',
      selectedType: 'town-centre',
      training: 'worker',
      trainingName: 'Worker',
    });
  });

  it('the director frames the fight, else the selection, else the own units, zoomed out to fit (D10)', () => {
    const game = createGame(content, 9);
    const screen = content.manifest.screen;
    const v = game.view();
    // Nothing selected and no fight: red's units round its base, at zoom 1.
    const home = directorCamera(v, screen, [])!;
    expect(home.zoom).toBe(1);
    expect(home.x).toBeLessThan(400);
    // The hero alone selected: centred on him.
    const hero = v.units.find((u) => u.id === 19)!;
    const onHero = directorCamera(v, screen, [19])!;
    expect(onHero.x).toBe(Math.max(screen.width / 2, hero.x * RTS_TILE_SIZE + RTS_TILE_SIZE / 2));
    // A red worker and the far sentry selected: zoomed out to fit both, never below 0.5.
    const wide = directorCamera(v, screen, [11, 19])!;
    expect(wide.zoom).toBeLessThanOrEqual(1);
    const fight = { ...v, units: v.units.map((u) => (u.id === 19 ? { ...u, target: 17 } : u)) };
    const onFight = directorCamera(fight, screen, [])!;
    expect(onFight.zoom).toBeLessThan(1);
    expect(onFight.zoom).toBeGreaterThanOrEqual(0.5);
  });
});

describe('the finished skirmish: art, sound and its end (Engine 0.15 T14; the match from 0.16 part D, D8)', () => {
  const runs = readdirSync(fileURLToPath(new URL('./runs/', import.meta.url)))
    .filter((f) => f.endsWith('.run.json'))
    .map((f) => f.slice(0, -'.run.json'.length))
    .sort();
  const { skin } = skirmishLook(content);
  const FALLBACK = skin.sheets?.fallbackColor;

  it('has the guard run files (D8) and the full win and loss (D9)', () => {
    expect(runs).toEqual(['ai-barracks', 'fog', 'match-lost', 'match-won', 'opening', 'razed']);
  });

  it('names no placeholder look: no kind, tag look or tile has its own fallback colour', () => {
    expect(FALLBACK).toBe('#ff00ff');
    for (const [kind, entry] of Object.entries(skin.kinds)) {
      expect(entry.fallbackColor, kind).toBeUndefined();
      for (const tagged of entry.byTag ?? []) expect(tagged.fallbackColor, kind).toBeUndefined();
    }
    for (const [tile, entry] of Object.entries(skin.tiles ?? {}))
      expect(entry.fallbackColor, tile).toBeUndefined();
  });

  it.each(runs)('draws every tick of %s from the art, never a fallback box', (name) => {
    let sprites = 0;
    const fallbacks: number[] = [];
    let tick = 0;
    const r: Renderer = Object.assign(new NullRenderer(), {
      sprite() {
        sprites++;
      },
      rect(_x: number, _y: number, _w: number, _h: number, color: string) {
        if (color === FALLBACK) fallbacks.push(tick);
      },
    });
    const picture = skirmishCanvasPicture(r, skirmishLook(content));
    play(name, (g) => {
      tick = g.rts.tick;
      picture.draw(g, []);
    });
    expect(sprites).toBeGreaterThan(0);
    expect(fallbacks.slice(0, 5)).toEqual([]);
  });

  it('draws the feedback, fog and placing of every run from the art too (Engine 0.16 part D, D7)', () => {
    // What the page adds over a run (selection rings, path dots, order markers of every kind, the
    // placing ghost, fog), presented each tick through Canvas2D: a frame for every kind and state,
    // and never a fallback box.
    const look = skirmishLook(content);
    const kinds = new Set<string>();
    const missing = new Set<string>();
    const fallbacks: string[] = [];
    let name = '';
    let tick = 0;
    const r: Renderer = Object.assign(new NullRenderer(), {
      rect(_x: number, _y: number, _w: number, _h: number, color: string) {
        if (color === FALLBACK) fallbacks.push(`${name} ${tick}`);
      },
    });
    for (name of runs) {
      const state = new RtsPresentState();
      const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, { size: look.screen });
      play(name, (g) => {
        const view = g.rts.view();
        tick = view.tick;
        if (tick % 10 === 0) {
          const kind = (['move', 'attack', 'gather', 'build'] as const)[(tick / 10) % 4]!;
          state.mark(
            { kind, x: 10, y: 10, w: kind === 'build' ? 2 : 1, h: kind === 'build' ? 2 : 1, entity: null },
            tick,
          );
        }
        const frame = sideKinds(
          presentWorld(view, {
            faction: PLAYER,
            size: look.screen,
            selection: [...view.units, ...view.buildings].map((t) => t.id),
            placing: { building: 'barracks', cell: { x: 12, y: 12 }, w: 2, h: 2 },
            box: { x: 16, y: 16, w: 48, h: 32 },
            fog: true,
            state,
          }),
        );
        for (const e of frame.entities) {
          kinds.add(`${e.kind.replace(/:enemy$/, '')} ${e.anim.state}`);
          if (resolveSkinFrame(look.skin, e).frame === null)
            missing.add(`${e.kind} ${e.anim.state} ${e.facing}`);
        }
        presenter.present(frame);
      });
    }
    expect([...missing].sort()).toEqual([]);
    expect(fallbacks.slice(0, 5)).toEqual([]);
    for (const k of ['move', 'attack', 'gather', 'build']) expect(kinds).toContain(`order-marker ${k}`);
    for (const k of [
      'path-dot idle',
      'path-dot goal',
      'ghost:barracks idle',
      'selection-box idle',
      'selection-ring idle',
    ])
      expect(kinds).toContain(k);
  });

  it('has the layered song (calm and danger, D9), its channels the same length, and an sfx for every sound the skin names', () => {
    const songs = contentSongs(content);
    expect(songs.map((s) => s.id).sort()).toEqual([SKIRMISH_MUSIC, `${SKIRMISH_MUSIC}-danger`]);
    const lengths = songs.flatMap((song) => {
      expect(compileSong(song).length).toBeGreaterThan(0);
      return (['pulse1', 'pulse2', 'triangle', 'noise'] as const).map(
        (ch) => parseMml(song[ch]!, ch.startsWith('pulse') ? 'pulse' : (ch as 'triangle' | 'noise')).length,
      );
    });
    expect(new Set(lengths).size).toBe(1);
    expect(new Set(songs.map((s) => s.bpm)).size).toBe(1);
    // The skin's music plays both as layers of `ford`: the danger layer while a seen enemy is near.
    const music = skin.music?.[SKIRMISH_MUSIC];
    expect(music?.layers).toEqual({ calm: SKIRMISH_MUSIC, danger: `${SKIRMISH_MUSIC}-danger` });
    expect(music?.mix?.[0]?.when).toEqual({ status: 'enemyNear', lte: 8 });
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    const sounds = Object.values(skin.events ?? {}).flatMap((e) => (e.sound ? [e.sound] : []));
    expect(sounds.length).toBeGreaterThanOrEqual(9);
    for (const sound of sounds) expect(sfx.has(sound), sound).toBe(true);
    // D9: every presentation event the kit sends has a sound for the player's side (the enemy's
    // training and building stay silent; its losses are heard).
    for (const type of [
      'unit-ready',
      'unit-down',
      'unit-hit',
      'site-placed',
      'building-done',
      'building-down',
      'building-hit',
      'stock-up',
    ])
      expect(resolveSkinEvent(skin.events, { type, side: 'own' })?.sound, type).toBeTruthy();
    for (const type of ['unit-down', 'unit-hit', 'building-down', 'building-hit'])
      expect(resolveSkinEvent(skin.events, { type, side: 'enemy' })?.sound, type).toBeTruthy();
    for (const unitType of ['worker', 'soldier', 'archer', 'hero']) {
      const bark = resolveSkinEvent(skin.events, { type: 'bark', side: 'own', unitType });
      expect(bark?.sound, unitType).toBe(`bark-${unitType}`);
      expect(bark?.pitch, unitType).toEqual([-2, 2]);
    }
  });

  /** Every event the frames of `name` carry, as `type:side` (or `type:result`), with the last frame's status. */
  function eventsOf(name: string, world: (g: ReturnType<typeof createGame>) => ShowsWorld = (g) => g) {
    const frames = skirmishFrames(content.manifest.screen);
    const seen = new Map<string, number>();
    const sounds = new Set<string>();
    let status: PresentFrame['status'] = {};
    // A frame before each tick's orders and one after, as the page draws many frames a tick.
    const draw = (g: ReturnType<typeof createGame>) => {
      const frame = frames.next(world(g), []);
      status = { ...frame.status };
      for (const e of frame.events) {
        const key = `${e.type}:${String(e['side'] ?? e['result'])}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        const sound = resolveSkinEvent(skin.events, e)?.sound;
        if (sound) sounds.add(sound);
      }
    };
    play(name, draw, draw);
    return { seen, sounds, status };
  }

  it('sounds the fog run: the hero seen, struck and fallen, and the enemy heard only in sight', () => {
    const { seen, sounds, status } = eventsOf('fog');
    for (const key of ['unit-hit:own', 'unit-down:own', 'unit-hit:enemy'])
      expect(seen.has(key), key).toBe(true);
    expect(seen.get('unit-down:own')).toBe(1);
    // Blue trains its workers and soldiers out of red's sight; only the one that comes out while
    // the hero stands by the barracks is heard.
    expect(seen.get('unit-ready:enemy')).toBe(1);
    expect(seen.has('battle-end:lost')).toBe(false);
    expect(sounds).toContain('fall');
    expect(sounds).toContain('clash');
    expect(status['won']).toBeUndefined();
    expect(status['lost']).toBeUndefined();
  });

  it('sounds the razed run: the site placed, then lost to the scout', () => {
    const { seen, sounds } = eventsOf('razed');
    expect(seen.get('site-placed:own')).toBe(1);
    expect(seen.get('building-down:own')).toBe(1);
    expect(sounds).toContain('placed');
  });

  it('keeps an unseen side event out of the frame, and every own or placeless one in', () => {
    const fog = { cols: 2, rows: 1, cells: ['20'] };
    const frame = {
      frame: 0,
      size: { width: 32, height: 16 },
      entities: [],
      fog,
      status: {},
      events: [
        { type: 'unit-hit', side: 'enemy', x: 8, y: 8 },
        { type: 'unit-hit', side: 'enemy', x: 24, y: 8 },
        { type: 'unit-hit', side: 'own', x: 24, y: 8 },
        { type: 'battle-end', result: 'won' },
      ],
    } satisfies PresentFrame;
    expect(
      heardEvents(frame).map((e) => `${e.type} ${String(e['side'] ?? '')} ${String(e.x ?? '')}`),
    ).toEqual(['unit-hit enemy 8', 'unit-hit own 24', 'battle-end  ']);
  });

  it('ends with the jingle once and the banner when the end rule says so', () => {
    // The guard runs end before either side falls (D9 has the full win and loss), so the end is
    // forced here at tick 100 of the opening, as the end rule would give it.
    for (const result of ['won', 'lost'] as const) {
      // One wrapper for the run (a stream keeps its state per world object).
      let wrapper: ShowsWorld | null = null;
      const ended = (g: ReturnType<typeof createGame>): ShowsWorld =>
        (wrapper ??= {
          view: () => g.view(),
          result: (): SkirmishResult => (g.view().tick >= 100 ? result : null),
        });
      const { seen, sounds, status } = eventsOf('opening', ended);
      expect(seen.get(`battle-end:${result}`)).toBe(1);
      expect(sounds).toContain(result === 'won' ? 'victory' : 'defeat');
      expect(status[result]).toBe(true);
    }
    expect(skin.hud?.find((h) => h.status === 'lost')?.frame).toBe('banner-lost');
    expect(skin.hud?.find((h) => h.status === 'won')?.frame).toBe('banner-won');
  });

  it('reads the end off the view with the data end rule: won, lost, or still going', () => {
    const end = skirmishEnd(content);
    const view = play('opening').view();
    const without = (v: RtsView, keep: (faction: string | null, kind: string) => boolean): RtsView => ({
      ...v,
      buildings: v.buildings.filter((b) => keep(b.faction, b.kind)),
    });
    expect(skirmishResult(view, end)).toBeNull();
    expect(
      skirmishResult(
        without(view, (f, k) => !(f === 'blue' && k === 'town-centre')),
        end,
      ),
    ).toBe('won');
    expect(
      skirmishResult(
        without(view, (f, k) => !(f === PLAYER && k === 'town-centre')),
        end,
      ),
    ).toBe('lost');
    expect(skirmishResult({ ...view, units: view.units.filter((u) => u.faction !== PLAYER) }, end)).toBe(
      'lost',
    );
    // Both town centres down at once is a loss (the rule checks `lost` first).
    expect(
      skirmishResult(
        without(view, (_f, k) => k !== 'town-centre'),
        end,
      ),
    ).toBe('lost');
    expect(play('razed').result()).toBeNull();
  });

  it('barks an accepted order: a voice per unit type and a short line in the HUD for a while', () => {
    const game = createGame(content, 9);
    const view = game.view();
    const camera = new RtsCamera({ view: content.manifest.screen, area: { x: 0, y: 0, w: 1024, h: 640 } });
    const controls = new RtsControls(PLAYER, camera, RTS_TILE_SIZE);
    controls.selectHeroes(view);
    const draft = controls.stop(view)!;
    expect(game.rts.issue(draft).error).toBeNull();
    const pending = [controls.feedback(draft, view)];
    const frames = skirmishFrames(content.manifest.screen, { feedback: () => pending.splice(0) });
    const first = frames.next(game, []);
    const bark = first.events.find((e) => e.type === 'bark')!;
    expect(bark['unitType']).toBe('hero');
    expect(resolveSkinEvent(skin.events, bark)?.sound).toBe('bark-hero');
    expect(first.status['bark']).toBe('stop');
    const line = skin.hud?.find((h) => typeof h.when === 'object' && h.when.eq === 'stop');
    expect(line?.format).toBe('Holding here.');
    for (let t = 0; t < BARK_TICKS; t++) game.step(NO_INPUT);
    const later = frames.next(game, []);
    expect(later.events.some((e) => e.type === 'bark')).toBe(false);
    expect(later.status['bark']).toBeUndefined();
  });
});

describe("fog of war is the picture and the AI's knowledge only (Engine 0.16 part D, D8)", () => {
  const runs = readdirSync(fileURLToPath(new URL('./runs/', import.meta.url)))
    .filter((f) => f.endsWith('.run.json'))
    .map((f) => f.slice(0, -'.run.json'.length))
    .sort();

  it.each(runs)("%s: the golden hashes with the page's fog drawn on and off", (name) => {
    const golden = (
      JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
        hashes: { tick: number; hash: string }[];
      }
    ).hashes;
    const { ticks, hashEvery } = runFile(name);
    const expected = golden.filter((h) => h.tick <= ticks);
    for (const fog of [true, false]) {
      const picture = skirmishCanvasPicture(new NullRenderer(), skirmishLook(content), { fog });
      const hashes: { tick: number; hash: string }[] = [];
      const game = play(name, undefined, (g) => {
        picture.draw(g, []);
        if (g.rts.tick % hashEvery === 0) hashes.push({ tick: g.rts.tick, hash: stateHash(g.snapshot()) });
      });
      if (ticks % hashEvery === 0) hashes.push({ tick: ticks, hash: stateHash(game.snapshot()) });
      expect(hashes, `fog ${fog ? 'on' : 'off'}`).toEqual(expected);
    }
  });
});
