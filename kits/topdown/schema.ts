import { z } from 'zod';
import type { ContentKind, KindIssue } from '@engine/core/content/kinds';
import { addGridIssues, gridProblems } from '@engine/core/content/text-grid';
import { DIRS, ROOM_COLS, type Dir, ROOM_ROWS } from './geometry';
import { checkDungeon, LEGEND, parseRoom, type LegendEntry, type RoomDef } from './room';

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
 * row they name when there is one. Checks across rooms (doors that line up, one player start) are
 * `buildDungeon`'s (`checkDungeon`): the kind's `checkAll` runs them over every room file once
 * each passes, as `invalid_dungeon` errors at the room file and field they are about (a map row
 * names the `.map.txt` file and its line).
 */

const cond = z.enum(['clear', 'plates', 'switches', 'torches']);

const entrance = z.strictObject({
  id: z.string().min(1).describe('the door id, unique in the dungeon'),
  col: z.number().int().describe("the door cell's column"),
  row: z.number().int().describe("the door cell's row"),
  enter: z.enum(DIRS as [Dir, ...Dir[]]).describe('the way the hero walks to go in'),
  to: z.string().min(1).describe('the paired door\'s id, or "@<action>" for the game to handle'),
  needs: z.string().min(1).exactOptional().describe('a secret that must be found before it opens'),
  shut: z.boolean().exactOptional().describe('starts closed until its secret is found'),
});

/** The room schema for a game's legend (the kit's `LEGEND` plus `extraLegend`). */
export function roomSchema(
  extraLegend: Readonly<Record<string, LegendEntry>> = {},
  wall = 1,
): z.ZodType<RoomDef> {
  const legend = new Set([...Object.keys(LEGEND), ...Object.keys(extraLegend)]);
  return z
    .strictObject({
      id: z.string().min(1).describe('the room id: its file name'),
      at: z
        .tuple([z.number().int().min(0), z.number().int().min(0)])
        .describe("the room's cell on the dungeon map, [column, row]; neighbours share an edge"),
      map: z
        .array(z.string())
        .describe('11 rows of 16 kit legend characters; usually in the sibling `.map.txt` file'),
      shutters: cond.exactOptional().describe("what opens the room's shutter doors (X)"),
      reveal: cond.exactOptional().describe("what makes the room's hidden pickups appear"),
      music: z.string().min(1).exactOptional().describe("the song id played in the room (else the game's)"),
      hint: z
        .string()
        .min(1)
        .exactOptional()
        .describe('read to screen readers when the room is first entered'),
      dark: z.boolean().exactOptional().describe('a free flag a game may use (a darker palette)'),
      goal: z.boolean().exactOptional().describe('the room the compass points to'),
      chests: z
        .array(z.string().min(1))
        .exactOptional()
        .describe('what each chest (c) holds, in reading order: an item id or a pickup kind'),
      wall: z
        .number()
        .int()
        .min(0)
        .max(3)
        .exactOptional()
        .describe("the outer wall's thickness in tiles, over the dungeon's; 0 is an outdoor screen"),
      art: z
        .array(z.array(z.string().min(1)).nullable())
        .exactOptional()
        .describe("each cell's tile-sheet frames, bottom to top, in reading order; null draws its tile"),
      entrances: z.array(entrance).exactOptional().describe('building doors inside the room'),
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

export interface RoomKindOptions {
  /**
   * The room files make one dungeon (the default): `checkAll` runs `buildDungeon`'s checks over
   * them. Set false for a game whose room files make several dungeons and that checks each itself.
   */
  oneDungeon?: boolean;
}

/** The `room` content kind: JSON with its `map` in a sibling `.map.txt` text grid (or inline). */
export function roomKind(
  extraLegend: Readonly<Record<string, LegendEntry>> = {},
  wall = 1,
  opts: RoomKindOptions = {},
): ContentKind<z.ZodType<RoomDef>> {
  const kind: ContentKind<z.ZodType<RoomDef>> = {
    name: 'room',
    description: 'A top-down room: id, map cell, music, chests and an 11x16 map grid of the kit legend',
    schema: roomSchema(extraLegend, wall),
    gridParts: { map: '.map.txt' },
  };
  if (opts.oneDungeon === false) return kind;
  kind.checkAll = (entries) =>
    checkDungeon(
      entries.map((e) => e.value),
      extraLegend,
      { wall },
    ).problems.map((p) => {
      const issue: KindIssue = {
        name: p.room ?? '',
        path: p.path,
        code: 'invalid_dungeon',
        message: p.message,
      };
      if (p.row !== undefined) issue.row = p.row;
      if (p.col !== undefined) issue.col = p.col;
      return issue;
    });
  return kind;
}
