import { buildDungeon, type Dungeon, type RoomDef } from '@kits/topdown';

/**
 * The proof-of-life rooms: a courtyard with the hero's start, a guard room to the east and a
 * store room to the north. Nothing here is Worlds Within content yet; it only shows the engine
 * and the top-down kit running in this repo.
 */
export const DEMO_ROOMS: readonly RoomDef[] = [
  {
    id: 'courtyard',
    at: [0, 1],
    music: 'demo',
    map: [
      '#######OO#######',
      '#..............#',
      '#..B........B..#',
      '#..............#',
      '#......h.......#',
      '#......@.......O',
      '#..............#',
      '#..............#',
      '#..B........B..#',
      '#..............#',
      '################',
    ],
  },
  {
    id: 'guard-room',
    at: [1, 1],
    map: [
      '################',
      '#..............#',
      '#...b......b...#',
      '#..............#',
      '#......n.......#',
      'O..............#',
      '#..............#',
      '#...r.....b....#',
      '#..............#',
      '#..............#',
      '################',
    ],
  },
  {
    id: 'store-room',
    at: [0, 0],
    map: [
      '################',
      '#..............#',
      '#..t........t..#',
      '#..............#',
      '#......c.......#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#######OO#######',
    ],
    chests: ['bombs'],
  },
];

export function demoDungeon(): Dungeon {
  return buildDungeon(DEMO_ROOMS);
}
