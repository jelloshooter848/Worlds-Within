/**
 * The level text format: what each character of a level's `.map.txt` grid means. One character is
 * one 16x16 tile; row 0 is the top of the level, column 0 its left edge.
 *
 * The legend is the kit's text format, not a level: real levels live in games. Enemy spawns have no
 * fixed character: a level's header maps characters of its own choosing to actor types
 * (`"spawns": { "w": { "actor": "walker" } }`), and those characters may not be legend ones.
 */

/** How a tile collides: open air, solid on every side, or solid from above only. */
export type Collision = 'empty' | 'solid' | 'one-way';

/** What a cell holds, beyond its collision. */
export type CellKind =
  'empty' | 'solid' | 'brick' | 'bump' | 'one-way' | 'hazard' | 'coin' | 'start' | 'goal' | 'trigger';

export interface LegendEntry {
  readonly cell: CellKind;
  readonly collision: Collision;
  /** One line for docs and agents. */
  readonly meaning: string;
}

export const LEGEND: Readonly<Record<string, LegendEntry>> = {
  '.': { cell: 'empty', collision: 'empty', meaning: 'open air' },
  '#': { cell: 'solid', collision: 'solid', meaning: 'solid ground or wall' },
  B: { cell: 'brick', collision: 'solid', meaning: 'a breakable brick' },
  '?': {
    cell: 'bump',
    collision: 'solid',
    meaning: 'a bump block; what it holds is the next entry of the header\'s "blocks" (else a coin)',
  },
  '=': { cell: 'one-way', collision: 'one-way', meaning: 'a one-way platform, solid from above only' },
  '^': { cell: 'hazard', collision: 'empty', meaning: 'a hazard that harms on touch' },
  o: { cell: 'coin', collision: 'empty', meaning: 'a coin' },
  '@': { cell: 'start', collision: 'empty', meaning: 'the player start (exactly one per level)' },
  G: { cell: 'goal', collision: 'empty', meaning: 'a goal: reaching it ends the level (at least one)' },
  '!': {
    cell: 'trigger',
    collision: 'empty',
    meaning: 'a mini-game trigger (reserved for the mini game hook)',
  },
};

/** The legend entry of a character, or undefined for a spawn character or an unknown one. */
export function legendEntry(ch: string): LegendEntry | undefined {
  return Object.hasOwn(LEGEND, ch) ? LEGEND[ch] : undefined;
}
