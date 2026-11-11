import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mustLoad } from '@engine/core/content/game-content';
import { readGameFiles } from '@engine/core/node/game-files';
import { contentDecor, skinSet, type PresentMap } from '@engine/core/present';
import { loadMiniSiege, siegeMap } from './content';
import { createGame, starts } from './headless';
import { siegeFrames } from './picture';

// The siege map in 3D low-poly (Engine 0.16 F6): the `three` skin frames a 16:9 picture at full
// HD, dresses each scenario's map with its own decor grid and names its places, and its scenery
// stands clear of every road cell, every entity's starting cell and the rows the battle is fought
// on, so no unit is ever drawn inside a wall or a house (the paths are the sim's, unchanged).

vi.setConfig({ testTimeout: 60_000 });

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadMiniSiege(readGameFiles(ROOT)));
const skin = skinSet(content, 'three').main!;
const SCENARIOS: string[] = [...(starts(content).entries ?? [])];
/** Decor that a unit could not plausibly walk through: walls, towers, buildings, tents, rocks. */
const SOLID = new Set([...'wWThHMmlanKFc']);

describe('the mini siege in 3D low-poly', () => {
  it('draws a 320x180 picture at render scale 6: full HD, through a ground view', () => {
    expect(content.manifest.screen).toEqual({ width: 320, height: 180 });
    expect(skin.scene3d?.renderScale).toBe(6);
    expect(skin.camera3d?.view).toBe('ground');
    expect(skin.scene3d?.toneMapping?.kind).toBe('aces');
    expect(skin.scene3d?.sun?.shadow).toBeDefined();
    expect(skin.scene3d?.fog).toBeDefined();
    expect(skin.scene3d?.timeOfDay?.keys.length).toBeGreaterThan(3);
  });

  it.each(SCENARIOS)('presents %s as its own map, dressed with its decor and places', (scenario) => {
    const game = createGame(content, 11, { start: { entry: scenario } });
    const frame = siegeFrames(content).next(game, []);
    const map = frame.map as PresentMap;
    expect(map.id).toBe(scenario);
    const decor = skin.decor?.[scenario];
    expect(decor?.grid).toBe(scenario);
    const rows = contentDecor(content)[scenario]!;
    expect([rows.length, rows[0]!.length]).toEqual([map.rows, map.cols]);
    expect(skin.places?.[scenario]?.map((p) => p.text)).toEqual(['THE HALL', "RAIDERS' CAMP"]);
  });

  it.each(SCENARIOS)(
    'keeps %s’s scenery off the roads, the starting cells and the battle rows',
    (scenario) => {
      const rows = contentDecor(content)[scenario]!;
      const terrain = siegeMap(content, scenario).terrain.rows;
      const game = createGame(content, 11, { start: { entry: scenario } });
      const taken = new Set<string>();
      for (const e of siegeFrames(content).next(game, []).entities)
        for (let x = e.x; x < e.x + e.w; x += 16)
          for (let y = e.y; y < e.y + e.h; y += 16) taken.add(`${Math.floor(x / 16)},${Math.floor(y / 16)}`);
      const blocked: string[] = [];
      rows.forEach((row, r) =>
        [...row].forEach((ch, c) => {
          if (!SOLID.has(ch)) return;
          const road = terrain[r]![c] === ',';
          // The battle's rows between the village's east gate and the camp (the units' corridor).
          const battle = r >= 12 && r <= 19 && c >= 13 && c <= 44;
          if (road || battle || taken.has(`${c},${r}`)) blocked.push(`${ch} at ${c},${r}`);
        }),
      );
      expect(blocked).toEqual([]);
    },
  );

  it('maps every kind the RTS kit presents in the siege to a model, with the burnt and site looks', () => {
    for (const kind of [
      'unit:worker',
      'unit:soldier',
      'unit:captain',
      'unit:raider',
      'unit:ram',
      'unit:catapult',
      'building:hall',
      'building:watchtower',
      'building:wall',
      'building:wall-tower',
      'resource:gold',
      'mission-offer',
    ])
      expect(skin.kinds[kind]?.model, kind).toMatch(/^assets\//);
    const looks = (kind: string) => (skin.kinds[kind]?.byTag ?? []).map((l) => l.tag ?? l.prefix);
    expect(looks('unit:ram')).toEqual(['damaged', 'frozen']);
    expect(skin.kinds['unit:ram']!.byTag![0]!.model).toMatch(/siege-ram-demolished/);
    expect(looks('building:watchtower').filter((t) => t === 'progress:')).toHaveLength(3);
    expect(looks('unit:soldier')).toEqual(['frozen', 'hero']);
    for (const kind of ['unit:raider', 'unit:soldier', 'unit:ram'])
      expect(skin.labels?.[kind], kind).toBeDefined();
  });
});
