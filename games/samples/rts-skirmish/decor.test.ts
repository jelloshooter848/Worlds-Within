import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mustLoad } from '@engine/core/content/game-content';
import { readGameFiles } from '@engine/core/node/game-files';
import { isFullMap } from '@engine/core/present';
import { RTS_DECOR_CHARS } from '@kits/rts';
import {
  loadSkirmish,
  skirmishDecor,
  skirmishEnemy,
  skirmishMap,
  skirmishSkin,
  skirmishTypes,
} from './content';
import { createView } from './view';

// The River Ford's scenery (polish Q, Q6): `content/maps/ford.decor.txt`, the kit's `rts-decor`
// grid the skin draws over the terrain. Presentation only (no hash depends on it, checked for
// every run by `tests/runs/rts-decor.test.ts`); these tests check the dressing itself: on the
// grass only, and nothing standing (a tree, pine, bush, stump, rock or boulder) on or by a road,
// a ford, a gold node, a building or a building site the AI or the runs use, or a unit's
// starting cell, so nothing on the map looks blocked.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadSkirmish(readGameFiles(ROOT)));
const map = skirmishMap(content);
const terrain = map.terrain!;
const decor = skirmishDecor(content)!;
const cell = (x: number, y: number) => [...(terrain.rows[y] ?? '')][x];
const at = (x: number, y: number) => [...(decor[y] ?? '')][x] ?? '.';

/** The props that stand up from the ground (the rest are ground marks a unit walks over). */
const STANDING = new Set(['T', 'P', 'S', 'b', 'r', 'R']);
/** A big tree (`T`, up to 30 x 52 px) also covers the two cells above it and one either side. */
const TALL = new Set(['T']);

/** Every standing prop as `[x, y, char]`. */
const standing: [number, number, string][] = decor.flatMap((row, y) =>
  [...row].flatMap((ch, x) => (STANDING.has(ch) ? [[x, y, ch] as [number, number, string]] : [])),
);

/** The cells a prop's sprite covers: its own, and for a big tree the two above it, one either side. */
const covered = (x: number, y: number, ch: string): [number, number][] =>
  TALL.has(ch)
    ? [-1, 0, 1].flatMap((dx) => [0, 1, 2].map((dy) => [x + dx, y - dy] as [number, number]))
    : [[x, y]];

/** Cells within `r` (in both directions) of a w x h box at (x, y). */
function around(x: number, y: number, w: number, h: number, r: number): Set<string> {
  const out = new Set<string>();
  for (let j = y - r; j < y + h + r; j++) for (let i = x - r; i < x + w + r; i++) out.add(`${i},${j}`);
  return out;
}

/** The building sites the runs use: interface `build` cells and recorded `build` targets. */
function runSites(): { x: number; y: number; building: string }[] {
  const out: { x: number; y: number; building: string }[] = [];
  for (const f of readdirSync(`${ROOT}runs`).filter((n) => n.endsWith('.run.json'))) {
    const run = JSON.parse(readFileSync(`${ROOT}runs/${f}`, 'utf8')) as {
      orders?: Record<string, unknown>[];
    };
    for (const o of run.orders ?? []) {
      const where = (o['ui'] === 'build' ? o['cell'] : o['type'] === 'build' ? o['target'] : null) as {
        x: number;
        y: number;
      } | null;
      if (where !== null) out.push({ ...where, building: String(o['building']) });
    }
  }
  return out;
}

describe("The River Ford's scenery (content/maps/ford.decor.txt)", () => {
  it("is the map's size, in the kit's decoration characters", () => {
    expect(decor).toHaveLength(terrain.rows.length);
    for (const row of decor) {
      expect([...row]).toHaveLength([...terrain.rows[0]!].length);
      for (const ch of row) expect(RTS_DECOR_CHARS.has(ch), ch).toBe(true);
    }
  });

  it('dresses only the grass: never a road, the river or a rock', () => {
    const grass = Object.entries(terrain.legend).find(([, t]) => t.name === 'grass')![0];
    decor.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== '.') expect(cell(x, y), `${ch} at ${x},${y}`).toBe(grass);
      }),
    );
  });

  it('has trees, rocks, bushes, ground marks and reeds along both banks', () => {
    const all = decor.join('');
    for (const ch of ['T', 'P', 'b', 'r', 'R', 'S', 'f', 'g', 'D', 'l', 'p', 'm', 'd', '|'])
      expect(all, ch).toContain(ch);
    const water = Object.entries(terrain.legend).find(([, t]) => t.name === 'water')![0];
    // A reed stands beside the river, west and east.
    let west = 0;
    let east = 0;
    decor.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== '|') return;
        expect(cell(x + 1, y) === water || cell(x - 1, y) === water, `reeds at ${x},${y}`).toBe(true);
        if (cell(x + 1, y) === water) west++;
        else east++;
      }),
    );
    expect(west).toBeGreaterThan(10);
    expect(east).toBeGreaterThan(10);
  });

  it('keeps the roads and fords clear: nothing standing on or beside a road', () => {
    const road = Object.entries(terrain.legend).find(([, t]) => t.name === 'dirt')![0];
    for (const [x, y, ch] of standing)
      for (const [cx, cy] of covered(x, y, ch))
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          expect(cell(cx + dx, cy + dy), `${ch} at ${x},${y}`).not.toBe(road);
  });

  it('keeps gold, buildings, building sites and starting cells clear', () => {
    const types = skirmishTypes(content);
    const size = (kind: string) => types.buildings[kind]!.size;
    const keep = new Set<string>();
    const add = (cells: Set<string>) => cells.forEach((c) => keep.add(c));
    for (const e of map.entities ?? []) {
      const c = e.components as Record<string, Record<string, unknown> | undefined>;
      const pos = c['Position'] as { x: number; y: number } | undefined;
      if (pos === undefined) continue;
      const b = c['Building'] as { w: number; h: number } | undefined;
      if (c['Resource']) add(around(pos.x, pos.y, 1, 1, 2));
      else if (b) add(around(pos.x, pos.y, b.w, b.h, 1));
      else add(around(pos.x, pos.y, 1, 1, 1));
    }
    const squads = (map.squads ?? []) as {
      members: { components: { Position?: { x: number; y: number } } }[];
    }[];
    for (const squad of squads)
      for (const m of squad.members) {
        const pos = m.components.Position;
        if (pos) add(around(pos.x, pos.y, 1, 1, 1));
      }
    // The AI's barracks cells (content/enemy/blue.json) and the runs' building sites.
    for (const step of skirmishEnemy(content).steps) {
      const order = step.order as { type: string; building?: string; cells?: { x: number; y: number }[] };
      if (order.type !== 'build') continue;
      for (const c of order.cells ?? []) {
        const { w, h } = size(order.building!);
        add(around(c.x, c.y, w, h, 1));
      }
    }
    const sites = runSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) add(around(s.x, s.y, size(s.building).w, size(s.building).h, 1));
    for (const [x, y, ch] of standing)
      for (const [cx, cy] of covered(x, y, ch))
        expect(keep.has(`${cx},${cy}`), `${ch} at ${x},${y}`).toBe(false);
  });

  it("stands its props point-symmetric like the map's fair halves (most of them)", () => {
    const rows = decor.length;
    const cols = [...decor[0]!].length;
    const mirrored = standing.filter(([x, y]) => STANDING.has(at(cols - 1 - x, rows - 1 - y)));
    expect(mirrored.length / standing.length).toBeGreaterThan(0.9);
  });

  it('is drawn: the view gives the map a decor layer of the grid, never in the minimap', () => {
    const view = createView(content, 9);
    const frame = view.frame!();
    expect(frame.map !== undefined && isFullMap(frame.map)).toBe(true);
    const layers = frame.map !== undefined && isFullMap(frame.map) ? frame.map.layers : undefined;
    expect(layers?.map((l) => l.name)).toEqual(['decor']);
    expect(layers![0]!.tiles[0]).toBe(decor[0]!.replaceAll('.', ' '));
    // The minimap colours the terrain's types only (its `tiles` keys are type indexes).
    const hud = skirmishSkin(content, 'canvas2d').hud ?? [];
    const minimap = hud.find((item) => item.as === 'minimap') as { tiles?: Record<string, string> };
    for (const key of Object.keys(minimap.tiles ?? {})) expect(RTS_DECOR_CHARS.has(key), key).toBe(false);
  });
});
