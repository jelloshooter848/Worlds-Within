import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter, NullRenderer } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { readGameFiles } from '@engine/core/node/game-files';
import { isFullMap, resolveSkinFrame, type PresentFrame } from '@engine/core/present';
import { loadSkirmish, PLAYER, skirmishEnemy, skirmishMap, skirmishScenario, skirmishTypes } from './content';
import { createGame, sidesOf } from './headless';
import { sideKinds, skirmishFrames, skirmishLook } from './picture';
import { createView } from './view';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadSkirmish(readGameFiles(ROOT)));
const NO_INPUT = {} as InputFrame;

interface RunEntry extends JsonObject {
  tick: number;
}

/** A run file's orders (recorded orders or interface actions) and length. */
function runFile(name: string): { ticks: number; orders: RunEntry[] } {
  return JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
    ticks: number;
    orders: RunEntry[];
  };
}

/** Plays `name` headless as `pnpm cli run` does; `each` sees the game after every tick's orders. */
function play(name: string, each?: (game: ReturnType<typeof createGame>) => void) {
  const run = runFile(name);
  const game = createGame(content, 9);
  for (let t = 0; t < run.ticks; t++) {
    for (const { tick, ...o } of run.orders) if (tick === t) game.order(o as JsonObject);
    each?.(game);
    game.step(NO_INPUT);
  }
  return game;
}

describe('the skirmish content', () => {
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

describe('the skirmish headless', () => {
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

describe('the skirmish picture', () => {
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

  it('takes the same orders as the headless game, and draws without changing it', () => {
    const view = createView(content, 9);
    const game = createGame(content, 9);
    const run = runFile('battle');
    for (let t = 0; t < 60; t++) {
      for (const { tick, ...o } of run.orders)
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
