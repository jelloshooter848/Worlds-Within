import { z } from 'zod';
import type { ContentKind, KindIssue } from '@engine/core/content/kinds';
import { addGridIssues, gridProblems } from '@engine/core/content/text-grid';
import { DIRS, ROOM_COLS, type Dir, ROOM_ROWS } from './geometry';
import { checkDungeon, DECOR_CHARS, LEGEND, parseRoom, type LegendEntry, type RoomDef } from './room';

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
 * names the `.map.txt` file and its line). With `oneDungeon: false` (a game's `rooms: "separate"`,
 * gap G17) each room file is checked alone as its own dungeon.
 *
 * A room may also carry a decoration grid (`decor`, Engine 0.16 polish P4), usually in its
 * `rooms/hall.decor.txt`: the map's size, `.` for nothing and `DECOR_CHARS` for props the skin
 * draws. It is presentation only; a bad character is `unknown_char`, a short row `ragged_row` and
 * a grid not the map's size `size_mismatch`.
 */

const cond = z.enum(['clear', 'plates', 'switches', 'torches', 'boss']);

const ticks = (what: string) => z.number().int().min(1).describe(what);
const optTicks = (what: string) => z.number().int().min(1).exactOptional().describe(what);

/** A boss step (`BossStep`, `boss.ts`), told apart by `do`. */
const bossStep = z.discriminatedUnion('do', [
  z.strictObject({ do: z.literal('idle'), ticks: ticks('ticks it stands') }),
  z.strictObject({
    do: z.literal('telegraph'),
    ticks: ticks('ticks it announces the attack (`boss-telegraph`)'),
    attack: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe('the attack announced, usually the next step: presented as `telegraph-<attack>`'),
  }),
  z.strictObject({
    do: z.literal('charge'),
    speed: z
      .number()
      .positive()
      .max(8)
      .exactOptional()
      .describe("pixels a tick (the phase's or boss's speed)"),
    ticks: optTicks('the longest it runs (90); a wall stops it sooner'),
  }),
  z.strictObject({
    do: z.literal('shoot'),
    pattern: z.enum(['ring', 'spread']).describe('`ring`: all round; `spread`: a fan at the hero'),
    count: z.number().int().min(1).max(32).describe('shots in the volley'),
    speed: z.number().positive().max(8).exactOptional().describe('pixels a tick (2)'),
    damage: z.number().int().min(1).exactOptional().describe('half hearts a shot takes (1)'),
    gap: z.number().int().min(1).max(16).exactOptional().describe("a spread's gap in 11.25-degree steps (2)"),
    start: z
      .number()
      .int()
      .min(0)
      .max(31)
      .exactOptional()
      .describe("a ring's first direction, 0 right, 8 down"),
    aim: z.boolean().exactOptional().describe('a ring starts at the hero'),
    jitter: z
      .number()
      .int()
      .min(0)
      .max(16)
      .exactOptional()
      .describe('each volley turned by a random -n..n steps'),
    ticks: optTicks('ticks the step lasts (1)'),
  }),
  z.strictObject({
    do: z.literal('slam'),
    radius: z.number().int().min(1).max(256).describe('pixels round its centre the hit reaches'),
    damage: z.number().int().min(1).exactOptional().describe("half hearts (the boss's contact)"),
    ticks: optTicks('ticks the step lasts (1)'),
  }),
  z.strictObject({
    do: z.literal('summon'),
    kinds: z
      .array(z.string().min(1))
      .min(1)
      .describe("spawn kinds to call up (`bat`, `knight`, a game's own), picked by the seeded RNG"),
    count: z.number().int().min(1).max(4).exactOptional().describe('how many a summon calls (1)'),
    max: z.number().int().min(1).exactOptional().describe('the most of its minions alive at once (3)'),
    ticks: optTicks('ticks the step lasts (1)'),
  }),
]);

const bossPattern = z.array(bossStep).min(1);

/**
 * A room's boss (Engine 0.16 part C T6): its whole form as data (`BossDef` in `boss.ts`). Phases
 * come highest `hp` first, each under the boss's hp and the phase before.
 */
export const bossSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe("names the boss: presented as `boss:<id>`, its events' `boss`"),
    name: z
      .string()
      .min(1)
      .exactOptional()
      .describe('its name for the HUD (`bossName`; the id when left out)'),
    at: z
      .tuple([z.number().int().min(0), z.number().int().min(0)])
      .describe('its top-left cell, [column, row]; its whole box stands on floor'),
    size: z
      .tuple([z.number().int().min(8).max(64), z.number().int().min(8).max(64)])
      .exactOptional()
      .describe('its box in pixels, [width, height] ([32, 32])'),
    hp: z.number().int().min(1).describe('hit points'),
    contact: z.number().int().min(0).exactOptional().describe('half hearts a touch takes (2)'),
    hitInvuln: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe('ticks after a hit it cannot be hit again (30)'),
    knockResist: z
      .number()
      .min(0)
      .max(1)
      .exactOptional()
      .describe('how little the sword pushes it: 0 like a monster, 1 not at all (1)'),
    speed: z.number().positive().max(8).exactOptional().describe("a charge's pixels a tick (2)"),
    flies: z.boolean().exactOptional().describe('flies over water, pits and blocks (it walks)'),
    pattern: bossPattern.describe('its steps, looped: idle, telegraph, charge, shoot, slam, summon'),
    phases: z
      .array(
        z.strictObject({
          hp: z.number().int().min(1).describe('from this many hit points left (or fewer)'),
          pattern: bossPattern.describe("the phase's steps, looped from the first"),
          speed: z.number().positive().max(8).exactOptional().describe("a charge's speed in the phase"),
        }),
      )
      .exactOptional()
      .describe('later phases, highest hp first'),
    defeatTicks: z.number().int().min(1).exactOptional().describe('ticks of its defeat sequence (60)'),
    flag: z
      .string()
      .min(1)
      .exactOptional()
      .describe('a world flag its defeat sets (`flags` in the snapshot), e.g. `bossDefeated`'),
  })
  .superRefine((b, ctx) => {
    let above = b.hp;
    (b.phases ?? []).forEach((ph, i) => {
      if (ph.hp >= above)
        ctx.addIssue({
          code: 'custom',
          path: ['phases', i, 'hp'],
          message: `a phase's hp must be under ${above} (the boss's hp or the phase before)`,
        });
      above = ph.hp;
    });
  });

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
      title: z
        .string()
        .min(1)
        .exactOptional()
        .describe("a title to show for the room: a room challenge's (the mini game's) title"),
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
      boss: bossSchema
        .exactOptional()
        .describe(
          'the room\'s boss, all data (Engine 0.16 part C T6); `shutters: "boss"` seals the room until it is down',
        ),
      decor: z
        .array(z.string())
        .exactOptional()
        .describe(
          "decoration (Engine 0.16 polish P4), presentation only: a grid the map's size, `.` for nothing and any other printable character that is no kit legend character nor `d` for a prop the skin's `tiles` draw over the floor; presented as the map layer `decor`; usually in the `.decor.txt` file",
        ),
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
      // The decoration (presentation only) never stops the room's own checks below.
      if (def.decor !== undefined) {
        addGridIssues(ctx, def.decor, DECOR_CHARS, ['decor']);
        const cols = [...(def.decor[0] ?? '')].length;
        if (
          gridProblems(def.decor, DECOR_CHARS).length === 0 &&
          (cols !== ROOM_COLS || def.decor.length !== ROOM_ROWS)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['decor'],
            message: `the decoration is ${cols}x${def.decor.length} but the map is ${ROOM_COLS}x${ROOM_ROWS}`,
            params: { code: 'size_mismatch' },
          });
      }
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
   * them together (one player start, a map cell each, doors that pair up across rooms). Set false
   * (Engine 0.15, gap G17: a game's `kitOptions.topdown.rooms` `"separate"`) for a game whose room
   * files are separate rooms, each its own one-room dungeon (a challenge or mission room): each is
   * checked alone, with its own start and its doors only within itself.
   */
  oneDungeon?: boolean;
}

/** How a game's room files are checked (`kitOptions.topdown.rooms` in `game.json`, gap G17). */
export const ROOM_MODES = ['dungeon', 'separate'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

/** The dash's tuning in `kitOptions.topdown.dash` (Engine 0.16 part C T5): each field optional. */
export const dashTuningSchema = z.strictObject({
  ticks: z.number().int().min(1).exactOptional().describe('ticks the burst lasts (8 when left out)'),
  distance: z
    .number()
    .int()
    .min(1)
    .exactOptional()
    .describe('pixels it goes at most along the facing (48, three tiles, when left out)'),
  cooldown: z
    .number()
    .int()
    .min(0)
    .exactOptional()
    .describe('ticks after a dash before the next can start (24 when left out)'),
  guard: z
    .number()
    .int()
    .min(0)
    .exactOptional()
    .describe('ticks the hero stays unhurtable after a dash ends (6 when left out); he never is during one'),
});

/** The top-down kit's `game.json` options (`kitOptions.topdown`, Engine 0.15, gap G17). */
export const topdownOptionsSchema = z.strictObject({
  rooms: z
    .enum(ROOM_MODES)
    .exactOptional()
    .describe(
      'how the room files are checked: `dungeon` (the default) as one dungeon, `separate` each room alone (challenge or mission rooms, each with its own start)',
    ),
  dash: dashTuningSchema
    .exactOptional()
    .describe("the dash item's tuning (Engine 0.16 part C T5): `ticks`, `distance`, `cooldown`, `guard`"),
});

/**
 * The `room` content kind: JSON with its `map` in a sibling `.map.txt` text grid (or inline), and
 * its optional `decor` in a `.decor.txt` one (Engine 0.16 polish P4).
 */
export function roomKind(
  extraLegend: Readonly<Record<string, LegendEntry>> = {},
  wall = 1,
  opts: RoomKindOptions = {},
): ContentKind<z.ZodType<RoomDef>> {
  const kind: ContentKind<z.ZodType<RoomDef>> = {
    name: 'room',
    description: 'A top-down room: id, map cell, music, chests and an 11x16 map grid of the kit legend',
    schema: roomSchema(extraLegend, wall),
    gridParts: { map: '.map.txt', decor: '.decor.txt' },
  };
  const dungeons = (defs: readonly RoomDef[]): RoomDef[][] =>
    opts.oneDungeon === false ? defs.map((d) => [d]) : [[...defs]];
  kind.checkAll = (entries) =>
    dungeons(entries.map((e) => e.value)).flatMap((defs) =>
      checkDungeon(defs, extraLegend, { wall }).problems.map((p) => {
        const issue: KindIssue = {
          name: p.room ?? '',
          path: p.path,
          code: 'invalid_dungeon',
          message: p.message,
        };
        if (p.row !== undefined) issue.row = p.row;
        if (p.col !== undefined) issue.col = p.col;
        return issue;
      }),
    );
  return kind;
}
