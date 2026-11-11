import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/core/input/actions';
import { parseContent } from '@engine/core/content/kinds';
import { validate } from '@engine/core/content/validate';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { presentFrameSchema, type PresentMap } from '@engine/core/present';
import { stateHash } from '@engine/core/state-hash';
import { PRESENT_TILES, presentMap, presentWorld } from './present';
import { buildDungeon, DECOR_CHARS, LEGEND, type RoomDef } from './room';
import { roomKind, roomSchema } from './schema';
import { snapshotWorld } from './snapshot';
import { TopDownWorld } from './world';

/** Engine 0.16 polish P4: a room's decoration grid, presentation only. */

const ROW = '#..............#';
const WALL = '################';
const MAP = [WALL, ...Array.from({ length: 9 }, () => ROW), WALL];
const BLANK = Array.from({ length: 11 }, () => '................');

/** Replaces characters of `rows`: `at` is a list of [col, row, char]. */
function put(rows: readonly string[], at: [number, number, string][]): string[] {
  const out = rows.map((r) => r.split(''));
  for (const [c, r, ch] of at) out[r]![c] = ch;
  return out.map((r) => r.join(''));
}

const DECOR = put(BLANK, [
  [0, 0, '%'],
  [3, 2, 'g'],
  [12, 8, '*'],
]);

describe('the decoration grid', () => {
  it('allows no legend nor presented tile character but `.`', () => {
    for (const ch of [...Object.keys(LEGEND), ...Object.values(PRESENT_TILES)])
      expect(DECOR_CHARS.has(ch), ch).toBe(ch === '.');
    for (const ch of ['%', '*', 'g', 'w', '1', 'A', '|']) expect(DECOR_CHARS.has(ch), ch).toBe(true);
    expect(DECOR_CHARS.has(' ')).toBe(false);
  });

  it('is checked by the room schema: unknown characters, ragged rows and the wrong size', () => {
    const room = { id: 'hall', at: [0, 0], map: put(MAP, [[7, 5, '@']]) };
    const ok = validate('hall.json', { ...room, decor: DECOR }, roomSchema());
    expect(ok.ok && ok.value.decor).toEqual(DECOR);
    const legend = validate('hall.json', { ...room, decor: put(DECOR, [[5, 4, 'k']]) }, roomSchema());
    expect(legend.errors).toMatchObject([{ path: 'decor.4', code: 'unknown_char', row: 4, col: 5 }]);
    const ragged = DECOR.map((r, i) => (i === 6 ? r.slice(2) : r));
    expect(validate('hall.json', { ...room, decor: ragged }, roomSchema()).errors).toMatchObject([
      { path: 'decor.6', code: 'ragged_row', row: 6 },
    ]);
    expect(validate('hall.json', { ...room, decor: DECOR.slice(1) }, roomSchema()).errors).toMatchObject([
      { path: 'decor', code: 'size_mismatch' },
    ]);
    const narrow = DECOR.map((r) => r.slice(1));
    expect(validate('hall.json', { ...room, decor: narrow }, roomSchema()).errors).toMatchObject([
      { path: 'decor', code: 'size_mismatch' },
    ]);
  });

  it('loads from the room file’s `.decor.txt` part, naming that file on an error', () => {
    const json = JSON.stringify({ id: 'hall', at: [0, 0] });
    const map = { file: 'rooms/hall.map.txt', text: `${put(MAP, [[7, 5, '@']]).join('\n')}\n` };
    const decor = { file: 'rooms/hall.decor.txt', text: `${DECOR.join('\n')}\n` };
    const r = parseContent(roomKind(), 'rooms/hall.json', json, { map, decor });
    expect(r.ok && r.value.decor).toEqual(DECOR);
    expect(parseContent(roomKind(), 'rooms/hall.json', json, { map }).ok).toBe(true);
    const bad = { ...decor, text: put(DECOR, [[2, 3, '#']]).join('\n') };
    expect(parseContent(roomKind(), 'rooms/hall.json', json, { map, decor: bad }).errors).toMatchObject([
      { file: 'rooms/hall.decor.txt', path: 'decor.3', line: 4, code: 'unknown_char' },
    ]);
  });
});

/** A hall (start) and an east room, joined by an open door; `decor` decorates them. */
function world(decor: { hall?: string[]; east?: string[] } = {}, seed = 3): TopDownWorld {
  const hall: RoomDef = {
    id: 'hall',
    at: [0, 0],
    map: put(MAP, [
      [7, 5, '@'],
      [15, 5, 'O'],
      [3, 3, 'b'],
    ]),
    ...(decor.hall && { decor: decor.hall }),
  };
  const east: RoomDef = {
    id: 'east',
    at: [1, 0],
    map: put(MAP, [
      [0, 5, 'O'],
      [10, 4, 'b'],
    ]),
    ...(decor.east && { decor: decor.east }),
  };
  return new TopDownWorld(buildDungeon([hall, east]), { seed });
}

function stepper(w: TopDownWorld): (held: Action[]) => void {
  const input = new ScriptedInput({ steps: [] });
  return (held) => {
    input.setHeld(held);
    input.next();
    w.update(input);
    w.events.splice(0);
  };
}

describe('the `decor` map layer', () => {
  it('presents a room’s decoration over its tiles, empty cells as spaces', () => {
    const map = presentMap(world({ hall: DECOR })).map;
    const tiles = DECOR.map((r) => r.replaceAll('.', ' '));
    expect(map.layers).toEqual([{ name: 'decor', tiles }]);
    expect(map.version).toBe(presentMap(world()).map.version);
    expect(presentMap(world()).map.layers).toBeUndefined();
    expect(validate('f.json', presentWorld(world({ hall: DECOR })), presentFrameSchema).errors).toEqual([]);
  });

  it('slides both rooms’ decoration with them, each in its part', () => {
    const east = put(BLANK, [[1, 5, '&']]);
    const w = world({ east });
    const step = stepper(w);
    for (let i = 0; i < 200 && !w.transition; i++) step(['right']);
    expect(w.transition).not.toBeNull();
    const { map } = presentMap(w);
    expect(map.parts?.map((p) => [p.id, p.col, p.row])).toEqual([
      ['hall', 0, 0],
      ['east', 16, 0],
    ]);
    const layer = (map as PresentMap).layers![0]!;
    expect(layer.name).toBe('decor');
    expect(layer.tiles).toHaveLength(11);
    expect(layer.tiles[5]).toBe(`${' '.repeat(16)} &${' '.repeat(14)}`);
    expect((layer.tiles as string[]).filter((r) => r.trim() !== '')).toHaveLength(1);
  });

  it('never enters the world’s state: the same hashes with and without it', () => {
    const plain = world();
    const dressed = world({ hall: DECOR, east: put(BLANK, [[1, 5, '&']]) });
    const [a, b] = [stepper(plain), stepper(dressed)];
    const plan: Action[][] = [['right'], ['right', 'attack'], ['down'], ['right'], ['up', 'attack'], []];
    for (let t = 0; t < 400; t++) {
      const held = plan[Math.floor(t / 7) % plan.length]!;
      a(held);
      b(held);
      expect(stateHash(snapshotWorld(dressed) as never)).toBe(stateHash(snapshotWorld(plain) as never));
    }
    expect(dressed.visited()).toContain('east');
  });
});
