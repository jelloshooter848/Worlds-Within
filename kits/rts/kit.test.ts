import { describe, expect, it } from 'vitest';
import { loadContent } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentError } from '@engine/core/content/validate';
import { TYPES } from './__fixtures__/world';
import { kit } from './kit';
import { RTS_RULES } from './rules';

const MANIFEST = JSON.stringify({
  id: 'skirmish',
  kit: 'rts',
  content: {
    'rts-map': ['content/maps/*.world.json'],
    'rts-types': ['content/types.json'],
    'rts-enemy': ['content/enemy/*.json'],
  },
  start: { seed: 1 },
  headless: 'headless.ts',
});

const MAP = {
  format: 'worlds-within/scenario',
  version: 1,
  seed: 3,
  systems: 'rts',
  terrain: {
    legend: {
      '.': { name: 'ground', cost: 1, passable: true },
      '#': { name: 'rock', cost: 1, passable: false },
    },
    rows: ['..#', '...'],
    elevation: ['000', '000'],
  },
  entities: [{ key: 'w', components: { Position: { x: 0, y: 0 }, Owner: { faction: 'red' } } }],
};

const PLAN = {
  faction: 'blue',
  steps: [
    { id: 'train', order: { type: 'train', building: 'barracks', unit: 'soldier' } },
    {
      id: 'go',
      when: { count: 'units', side: 'self', type: 'soldier', op: 'gte', value: 2 },
      order: { type: 'attack', units: { type: 'soldier' }, target: 'nearest-building' },
    },
  ],
};

function load(over: Record<string, unknown> = {}) {
  const kinds = engineContentKinds();
  for (const k of kit.kinds()) kinds.register(k);
  const files: Record<string, string> = {
    'game.json': MANIFEST,
    'content/maps/field.world.json': JSON.stringify(MAP),
    'content/types.json': JSON.stringify(TYPES),
    'content/enemy/blue.json': JSON.stringify(PLAN),
  };
  for (const [k, v] of Object.entries(over)) files[k] = JSON.stringify(v);
  return loadContent(files, kinds, { root: 'games/skirmish/' });
}

const brief = (errors: readonly ContentError[]) =>
  errors.map((e) => ({ file: e.file, path: e.path, code: e.code }));

describe('the rts kit hook', () => {
  it('names the kit, its three kinds and its rules', () => {
    expect(kit.name).toBe('rts');
    expect(kit.kinds().map((k) => k.name)).toEqual(['rts-map', 'rts-types', 'rts-enemy']);
    expect(kit.rules).toBe(RTS_RULES);
    expect(kit.strictMutants).toBeUndefined();
  });

  it('takes a map with mission opportunities (checked by the sim when the world is built)', () => {
    const opportunities = [{ id: 'window', mission: 'raid', opens: 0, closes: 10 }];
    const loaded = load({ 'content/maps/field.world.json': { ...MAP, opportunities } });
    expect(loaded.ok ? [] : brief(loaded.errors)).toEqual([]);
  });

  it('loads a map, a types table and an enemy plan as a game would', () => {
    expect(load().errors).toEqual([]);
  });

  it('reports a bad map grid at its row, and a map that is not an rts scenario', () => {
    const village = { ...MAP, systems: 'village' };
    expect(brief(load({ 'content/maps/field.world.json': village }).errors)).toEqual([
      { file: 'games/skirmish/content/maps/field.world.json', path: 'systems', code: 'invalid_value' },
    ]);
    const bad = { ...MAP, terrain: { ...MAP.terrain, rows: ['..#', '.x.'], elevation: ['000'] } };
    expect(brief(load({ 'content/maps/field.world.json': bad }).errors)).toEqual([
      { file: 'games/skirmish/content/maps/field.world.json', path: 'terrain.rows.1', code: 'unknown_char' },
      { file: 'games/skirmish/content/maps/field.world.json', path: 'terrain.elevation', code: 'custom' },
    ]);
  });

  it('reports a plan naming a unit or building type no types table has', () => {
    const plan = {
      ...PLAN,
      steps: [{ id: 'train', order: { type: 'train', building: 'castle', unit: 'knight' } }],
    };
    expect(brief(load({ 'content/enemy/blue.json': plan }).errors)).toEqual([
      {
        file: 'games/skirmish/content/enemy/blue.json',
        path: 'steps.0.order.building',
        code: 'unknown_type',
      },
      { file: 'games/skirmish/content/enemy/blue.json', path: 'steps.0.order.unit', code: 'unknown_type' },
    ]);
  });

  it('checks a plan against types held in a map, too', () => {
    const map = {
      ...MAP,
      entities: [{ components: { RtsTypes: { units: { scout: TYPES.units.soldier } } } }],
    };
    const plan = {
      faction: 'blue',
      steps: [{ id: 's', order: { type: 'stop', units: { type: 'knight' } } }],
    };
    const kinds = engineContentKinds();
    for (const k of kit.kinds()) kinds.register(k);
    const r = loadContent(
      {
        'game.json': JSON.stringify({
          ...JSON.parse(MANIFEST),
          content: { 'rts-map': ['content/m.json'], 'rts-enemy': ['content/e.json'] },
        }),
        'content/m.json': JSON.stringify(map),
        'content/e.json': JSON.stringify(plan),
      },
      kinds,
    );
    expect(brief(r.errors)).toEqual([
      { file: 'content/e.json', path: 'steps.0.order.units.type', code: 'unknown_type' },
    ]);
  });
});
