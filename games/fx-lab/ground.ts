import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
import {
  mustSkinSet,
  RtsCamera,
  SKIN_KIND,
  skinGroundCamera,
  type Facing,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type SkinFile,
} from '@engine/core/present';

/**
 * The fx lab's ground-view example (Engine 0.16 F2): the 3D backend's `camera3d.view: "ground"`
 * on a small hand-made meadow, not on the platformer's levels. `content/skins/ground.json` is a
 * `three` skin (named `ground`, so it is neither the lab's own `three.json` nor a mini game's) with
 * meshes written for the ground (a part's x, y on the footprint, z its height): Pip with a nose
 * and a cap so his facing shows, four beetles facing four ways, a coin, the door with its `EXIT`
 * label and aura, two braziers (the glTF model, their light and flame), trees, rocks, a wall, a
 * path and a pond. Nothing here plays: `groundFrame(n)` is frame `n` of a fixed scene (Pip and
 * one beetle turn every 30 frames, a coin bursts every 60), framed by an `RtsCamera` with the
 * skin's ground camera, the same one a ground-view RTS picks through. `tests/browser/fx-lab-ground.test.ts`
 * shoots it; `games/fx-lab/ground.test.ts` checks the scene in Node.
 */

/** The meadow, 24 x 18 cells of 16 px (`.` and `,` grass, `=` path, `~` water, `#` wall, `T` tree, `o` rock). */
export const GROUND_ROWS = [
  'TT.,..T.TT.,..T..,TT.,TT',
  'T..,....,......,...T..,T',
  '.,..####...,.....o.....T',
  '....#..=====......,...,.',
  '.,..#..=...=..~~~.......',
  '..o....=.,.=..~~~~.,..o.',
  '.,.....=...=...~~.....,.',
  '..,....=====....T.......',
  '.T..,....=.....,.###..T.',
  '.....,...=...,.....#....',
  '..T......=......T.T..,..',
  '.,...,...o..,...........',
  'T..o.....=...T.,...T....',
  '.....,...=..,......,..o.',
  '.,..T....=.....,........',
  'T......,.=..T......,..TT',
  'TT..,....=..,....TTT..TT',
  'TTT.T,...=...,TTTTTTTTTT',
];

const TS = 16;
const MAP: PresentMap = {
  id: 'meadow',
  version: 0,
  tileSize: TS,
  cols: GROUND_ROWS[0]!.length,
  rows: GROUND_ROWS.length,
  tiles: GROUND_ROWS,
};

/** The ground skin (`content/skins/ground.json`). */
export function groundSkin(content: ContentBundle): SkinFile {
  const found = contentOf(content, SKIN_KIND).find((e) => e.name === 'ground');
  if (!found) throw new Error('the fx lab has no ground skin (content/skins/ground.json)');
  // The lab's own `three` skin must still be there and be the main one.
  mustSkinSet(content, 'three', 'the fx lab');
  return found.value;
}

const FACING_TURN: Facing[] = [
  'down',
  'down-right',
  'right',
  'up-right',
  'up',
  'up-left',
  'left',
  'down-left',
];

const entity = (
  id: string,
  kind: string,
  cx: number,
  cy: number,
  facing: Facing,
  over: Partial<PresentEntity> = {},
) => ({
  id,
  kind,
  x: cx * TS + 2,
  y: cy * TS + 2,
  w: 12,
  h: 12,
  facing,
  anim: { state: 'idle', t: 0 },
  tags: [] as string[],
  ...over,
});

/** The example's camera: an `RtsCamera` over the meadow with the skin's ground camera, at zoom 2. */
export function groundCamera(skin: SkinFile, screen: { width: number; height: number }): RtsCamera {
  return new RtsCamera({
    view: screen,
    area: { x: 0, y: 0, w: MAP.cols * TS, h: MAP.rows * TS },
    zoom: 2,
    centre: { x: 12.5 * TS, y: 8.5 * TS },
    ground: skinGroundCamera(skin),
  });
}

/** Frame `n` of the example (see the file comment), framed by `camera`. */
export function groundFrame(
  n: number,
  camera: RtsCamera,
  screen: { width: number; height: number },
): PresentFrame {
  const turn = FACING_TURN[Math.floor(n / 30) % FACING_TURN.length]!;
  const entities: PresentEntity[] = [
    entity('pip', 'runner', 12, 9, turn),
    entity('b-down', 'beetle', 10, 10, 'down'),
    entity('b-right', 'beetle', 13, 11, 'right'),
    entity('b-up', 'beetle', 15, 9, 'up'),
    entity('b-turn', 'beetle', 11, 12, FACING_TURN[(Math.floor(n / 30) + 4) % FACING_TURN.length]!),
    entity('coin', 'coin', 14, 8, 'down'),
    { ...entity('door', 'goal', 12, 5, 'down'), x: 12 * TS, w: 16, h: 16 },
    entity('t1', 'torch', 11, 5, 'down'),
    entity('t2', 'torch', 13, 5, 'down'),
  ];
  return {
    frame: n,
    size: { width: screen.width, height: screen.height },
    entities,
    map: MAP,
    events: n % 60 === 0 ? [{ type: 'coin', entity: 'coin' }] : [],
    status: { hp: 3, maxHp: 4 },
    camera: camera.hint(),
  };
}
