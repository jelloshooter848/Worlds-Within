import { z } from 'zod';
import type { ContentKind } from '@engine/core/content/kinds';
import { addGridIssues, gridProblems } from '@engine/core/content/text-grid';
import { DIRS, ROOM_COLS, type Dir, ROOM_ROWS } from './geometry';
import { LEGEND, parseRoom, type LegendEntry, type RoomDef } from './room';

/**
 * Room files: a {@link RoomDef} as JSON, with its map either inline (`"map": [...]`) or, as games
 * usually keep it, in a sibling text grid: `rooms/hall.json` plus `rooms/hall.map.txt`, 11 rows of
 * 16 characters from the kit's `LEGEND` (plus the game's `extraLegend`).
 *
 *   rooms/hall.json      { "id": "hall", "at": [0, 1], "music": "theme", "chests": ["bombs"] }
 *   rooms/hall.map.txt   ################
 *                        #......@.......O
 *                        ...
 *
 * Beyond the shape, the room must parse as the kit reads it (`parseRoom`): doors on edges, a solid
 * border, one chest item per chest and so on. Those problems are `invalid_room` errors, at the map
 * row they name when there is one. Checks across rooms (doors that line up, one player start)
 * belong to `buildDungeon`.
 */

const cond = z.enum(['clear', 'plates', 'switches', 'torches']);

const entrance = z.strictObject({
  id: z.string().min(1),
  col: z.number().int(),
  row: z.number().int(),
  enter: z.enum(DIRS as [Dir, ...Dir[]]),
  to: z.string().min(1),
  needs: z.string().min(1).exactOptional(),
  shut: z.boolean().exactOptional(),
});

/** The room schema for a game's legend (the kit's `LEGEND` plus `extraLegend`). */
export function roomSchema(
  extraLegend: Readonly<Record<string, LegendEntry>> = {},
  wall = 1,
): z.ZodType<RoomDef> {
  const legend = new Set([...Object.keys(LEGEND), ...Object.keys(extraLegend)]);
  return z
    .strictObject({
      id: z.string().min(1),
      at: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
      map: z.array(z.string()),
      shutters: cond.exactOptional(),
      reveal: cond.exactOptional(),
      music: z.string().min(1).exactOptional(),
      hint: z.string().min(1).exactOptional(),
      dark: z.boolean().exactOptional(),
      goal: z.boolean().exactOptional(),
      chests: z.array(z.string().min(1)).exactOptional(),
      wall: z.number().int().min(0).max(3).exactOptional(),
      art: z.array(z.array(z.string().min(1)).nullable()).exactOptional(),
      entrances: z.array(entrance).exactOptional(),
    })
    .superRefine((def, ctx) => {
      let problems = 0;
      const issue = (path: PropertyKey[], code: string, message: string, row?: number, col?: number) => {
        problems++;
        ctx.addIssue({ code: 'custom', path, message, params: { code, row, col } });
      };
      if (def.map.length !== ROOM_ROWS) {
        issue(['map'], 'wrong_size', `${def.map.length} rows, expected ${ROOM_ROWS}`);
      } else if ([...(def.map[0] ?? '')].length !== ROOM_COLS) {
        const w = [...(def.map[0] ?? '')].length;
        issue(['map', 0], 'wrong_size', `row 0 is ${w} wide, expected ${ROOM_COLS}`, 0);
      }
      addGridIssues(ctx, def.map, legend, ['map']);
      if (problems > 0 || gridProblems(def.map, legend).length > 0) return;
      try {
        parseRoom(def, extraLegend, wall);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const at = /row (\d+)(?: col (\d+))?/.exec(msg);
        const row = at ? Number(at[1]) : undefined;
        const col = at?.[2] === undefined ? undefined : Number(at[2]);
        issue(row === undefined ? [] : ['map', row], 'invalid_room', msg, row, col);
      }
    });
}

/** The `room` content kind: JSON with its `map` in a sibling `.map.txt` text grid (or inline). */
export function roomKind(
  extraLegend: Readonly<Record<string, LegendEntry>> = {},
  wall = 1,
): ContentKind<z.ZodType<RoomDef>> {
  return {
    name: 'room',
    description: 'A top-down room: id, map cell, music, chests and an 11x16 map grid of the kit legend',
    schema: roomSchema(extraLegend, wall),
    gridParts: { map: '.map.txt' },
  };
}
