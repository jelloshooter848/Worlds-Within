import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter, NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import { compileSong, parseMml } from '@engine/core/audio/mml';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { readGameFiles } from '@engine/core/node/game-files';
import { isFullMap, resolveSkinEvent, resolveSkinFrame, type PresentFrame } from '@engine/core/present';
import {
  loadSkirmish,
  PLAYER,
  SKIRMISH_MUSIC,
  skirmishEnemy,
  skirmishMap,
  skirmishScenario,
  skirmishTypes,
} from './content';
import { createGame, sidesOf, skirmishResult } from './headless';
import { sideKinds, skirmishCanvasPicture, skirmishFrames, skirmishLook } from './picture';
import { createView } from './view';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadSkirmish(readGameFiles(ROOT)));
const NO_INPUT = {} as InputFrame;

interface RunEntry extends JsonObject {
  tick: number;
}

/** A run file's orders (recorded orders or interface actions) and length. */
function runFile(name: string): { ticks: number; orders?: RunEntry[] } {
  return JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
    ticks: number;
    orders?: RunEntry[];
  };
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

describe('rts-classic: the skirmish content', () => {
  it('has one map, one types table and one enemy plan', () => {
    expect(skirmishMap(content).systems).toBe('rts');
    expect(Object.keys(skirmishTypes(content).units).sort()).toEqual(['hero', 'soldier', 'worker']);
    expect(Object.keys(skirmishTypes(content).buildings).sort()).toEqual(['barracks', 'town-centre']);
    expect(skirmishEnemy(content).faction).toBe('blue');
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

describe('rts-classic: the skirmish headless', () => {
  it('lists both sides in the snapshot, the beaten one as empty', () => {
    const sides = sidesOf(createGame(content, 9).rts.view(), ['red', 'blue', 'green']);
    expect(sides['red']!.unitTypes).toEqual({ worker: 3, hero: 1 });
    expect(sides['red']!.stock).toEqual({ gold: 250 });
    expect(sides['blue']!.units).toBe(4);
    expect(sides['green']).toEqual({ units: 0, unitTypes: {}, buildings: {}, sites: 0, stock: {} });
  });

  it('is repeatable: the same seed and orders give the same snapshots', () => {
    const a: string[] = [];
    const b: string[] = [];
    play('battle', (g) => a.push(canonicalJson(g.snapshot())));
    play('battle', (g) => b.push(canonicalJson(g.snapshot())));
    expect(a).toEqual(b);
  });

  it('plays the battle through the interface actions into exactly the recorded orders', () => {
    const recorded = runFile('battle').orders;
    expect(play('commands').rts.recorded()).toEqual(recorded);
  });

  it('refuses an interface action nothing selected can take, and one that is not an action', () => {
    const game = createGame(content, 9);
    expect(game.order({ ui: 'train', unit: 'soldier' })).toBe('no selected building trains soldier');
    expect(game.order({ ui: 'wave' })).toMatch(/^not an interface action/);
    expect(game.rts.recorded()).toEqual([]);
  });
});

describe('rts-classic: the skirmish picture', () => {
  it('gives the enemy side kinds of its own, drawn with the enemy palette', () => {
    const frame = sideKinds({
      frame: 0,
      size: { width: 320, height: 240 },
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
    expect(skirmishLook(content).skin.kinds['unit:soldier:enemy']!.palette).toBe('skirmish-blue');
  });

  it('has a sprite frame for every kind, state, facing and tile the battle shows', () => {
    const { skin } = skirmishLook(content);
    const frames = skirmishFrames(content.manifest.screen);
    const presenter = new NullPresenter({ validate: true });
    const missing = new Set<string>();
    const tiles = new Set<string>();
    play('commands', (g) => {
      const frame = frames.next(g.rts, []);
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
    const frames = skirmishFrames(content.manifest.screen);
    const seen = new Map<string, number[]>();
    play('commands', (g) => {
      for (const e of frames.next(g.rts, []).entities) {
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
    const run = runFile('battle');
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
    // The 20 x 15 tiles in view (no map cache in Node), the units, the town centre and the HUD.
    expect(sprites).toBeGreaterThan(300);
    const snapshot = canonicalJson(view.snapshot());
    view.render(r);
    expect(canonicalJson(view.snapshot())).toBe(snapshot);
  });
});

describe('rts-classic: the finished skirmish: art, sound and its end (Engine 0.15 T14)', () => {
  const runs = readdirSync(fileURLToPath(new URL('./runs/', import.meta.url)))
    .filter((f) => f.endsWith('.run.json'))
    .map((f) => f.slice(0, -'.run.json'.length))
    .sort();
  const { skin } = skirmishLook(content);
  const FALLBACK = skin.sheets?.fallbackColor;

  it('has run files for a win, a loss and the rest', () => {
    expect(runs).toEqual(['battle', 'commands', 'economy', 'hold', 'lost']);
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
      picture.draw(g.rts, []);
    });
    expect(sprites).toBeGreaterThan(0);
    expect(fallbacks.slice(0, 5)).toEqual([]);
  });

  it('has one song, its channels the same length, and an sfx for every sound the skin names', () => {
    const songs = contentSongs(content);
    expect(songs.map((s) => s.id)).toEqual([SKIRMISH_MUSIC]);
    const song = songs[0]!;
    expect(compileSong(song).length).toBeGreaterThan(0);
    const lengths = (['pulse1', 'pulse2', 'triangle', 'noise'] as const).map(
      (ch) => parseMml(song[ch]!, ch.startsWith('pulse') ? 'pulse' : (ch as 'triangle' | 'noise')).length,
    );
    expect(new Set(lengths).size).toBe(1);
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    const sounds = Object.values(skin.events ?? {}).flatMap((e) => (e.sound ? [e.sound] : []));
    expect(sounds.length).toBeGreaterThanOrEqual(9);
    for (const sound of sounds) expect(sfx.has(sound), sound).toBe(true);
  });

  /** Every event the frames of `name` carry, as `type:side` (or `type:result`), with the last frame's status. */
  function eventsOf(name: string) {
    const frames = skirmishFrames(content.manifest.screen);
    const seen = new Map<string, number>();
    const sounds = new Set<string>();
    let status: PresentFrame['status'] = {};
    // A frame before each tick's orders and one after, as the page draws many frames a tick.
    const draw = (g: ReturnType<typeof createGame>) => {
      const frame = frames.next(g.rts, []);
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

  it('sounds the battle: the site, the barracks, the soldiers, gold, the fight and the win once', () => {
    const { seen, sounds, status } = eventsOf('battle');
    for (const key of [
      'site-placed:own',
      'building-done:own',
      'unit-ready:own',
      'stock-up:own',
      'unit-hit:own',
      'unit-hit:enemy',
      'unit-down:enemy',
    ])
      expect(seen.has(key), key).toBe(true);
    expect(seen.get('unit-down:enemy')).toBe(4);
    expect(seen.get('battle-end:won')).toBe(1);
    expect(seen.has('battle-end:lost')).toBe(false);
    // One of the three soldiers falls in the fight (`fall`).
    expect([...sounds].sort()).toEqual([
      'built',
      'clash',
      'coin',
      'fall',
      'placed',
      'ready',
      'slain',
      'victory',
    ]);
    expect(status['won']).toBe(true);
    expect(status['lost']).toBeUndefined();
  });

  it('ends the lost run with the defeat: every red unit down, the jingle once and the banner', () => {
    const { seen, sounds, status } = eventsOf('lost');
    expect(seen.get('unit-down:own')).toBe(4);
    expect(seen.get('battle-end:lost')).toBe(1);
    expect(sounds.has('defeat')).toBe(true);
    expect(sounds.has('fall')).toBe(true);
    expect(status['lost']).toBe(true);
    expect(skin.hud?.find((h) => h.status === 'lost')?.frame).toBe('banner-lost');
    expect(skin.hud?.find((h) => h.status === 'won')?.frame).toBe('banner-won');
  });

  it('reads the end off the view: won, lost, or still going', () => {
    expect(skirmishResult(play('battle').rts.view())).toBe('won');
    expect(skirmishResult(play('lost').rts.view())).toBe('lost');
    expect(skirmishResult(play('hold').rts.view())).toBeNull();
    expect(skirmishResult(play('economy').rts.view())).toBeNull();
  });
});
