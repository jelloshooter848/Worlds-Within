import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SpriteDef } from '@engine/core/gfx/pixelart';
import type { Facing, PresentEntity, PresentFrame, PresentMap, SkinFile } from '@engine/core/present';
import { Rng } from '@engine/core/rng';

// The synthetic RTS scene of the rendering benchmark (Engine 0.9 T3, decision 6 in the build log):
// a 128 x 128 map of 16 px tiles, larger than the 320 x 240 picture, with N units walking in eight
// directions, each drawn as three entities (a selection ring, the animated unit, a health bar), and
// a camera that pans round the map at a fixed zoom. Two layouts: `spread` scatters the units over
// the whole map (a few dozen on screen), `crowd` keeps them all in a 640 x 480 world-px box that
// travels with the camera (the whole box on screen at zoom 0.5: the worst case, a battle in view). Everything comes from one seed, so the same
// case draws the same frames in every backend and on every run. It knows no kit: it writes
// presentation frames directly, as `kits/rts` will.

/** The RTS sample's picture size (decided in T3, in the range of the other samples). */
export const BENCH_SCREEN: ScreenSize = { width: 320, height: 240 };
export const TILE = 16;
export const MAP_CELLS = 128;
export const SHEET = 'rts-bench';
const UNIT = 16;

/** The eight directions a unit walks, as `[dx, dy, facing]`, one world px per tick on each axis. */
const DIRS: readonly (readonly [number, number, Facing])[] = [
  [0, -1, 'up'],
  [1, -1, 'up-right'],
  [1, 0, 'right'],
  [1, 1, 'down-right'],
  [0, 1, 'down'],
  [-1, 1, 'down-left'],
  [-1, 0, 'left'],
  [-1, -1, 'up-left'],
];

/** The right-hand facings the sheet draws; left-hand ones are those mirrored (`flipFacing`). */
const DRAWN: readonly Facing[] = ['up', 'up-right', 'right', 'down-right', 'down'];
const TEAMS = ['blue', 'red'] as const;

/** Palette: `.` is transparent, `0`-`9` and `a`-`c` index these colours. */
export const BENCH_PALETTE: readonly string[] = [
  '#000000',
  '#202020', // 1 outline
  '#3cbcfc', // 2 blue team
  '#fcfcfc', // 3 face
  '#00e800', // 4 selection ring
  '#00a800', // 5 health
  '#007800', // 6 grass
  '#00a844', // 7 grass speck
  '#ac7c00', // 8 dirt
  '#0058f8', // 9 water
  '#a4e4fc', // a wave
  '#7c7c7c', // b rock
  '#d82800', // c red team
];

/** Draws a `w` x `h` frame by asking `at(x, y)` for each pixel's character. */
function paint(w: number, h: number, at: (x: number, y: number) => string): string[] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y)).join(''));
}

/** A round soldier with a face toward `facing` and feet that swap on `step` 1. */
function unitFrame(team: string, facing: Facing, step: number): string[] {
  const dir = DIRS.find((d) => d[2] === facing)!;
  const body = team === 'blue' ? '2' : 'c';
  const fx = 8 + dir[0] * 3;
  const fy = 8 + dir[1] * 3;
  return paint(UNIT, UNIT, (x, y) => {
    const d = (x - 7.5) ** 2 + (y - 8) ** 2;
    if (y >= 13 && y <= 14 && (step === 0 ? x === 5 || x === 9 : x === 6 || x === 10)) return '1';
    if (Math.abs(x - fx) <= 1 && Math.abs(y - fy) <= 1 && d < 25) return '3';
    if (d < 20) return body;
    if (d < 30) return '1';
    return '.';
  });
}

/** The sheet: four tiles, a ring, a health bar per level and the units of both teams. */
export function benchSheet(): SpriteDef {
  const frames: Record<string, string[]> = {
    grass: paint(TILE, TILE, (x, y) => ((x * 7 + y * 3) % 11 === 0 ? '7' : '6')),
    dirt: paint(TILE, TILE, (x, y) => ((x + y * 5) % 13 === 0 ? '1' : '8')),
    water: paint(TILE, TILE, (x, y) => ((x + y * 2) % 8 === 0 ? 'a' : '9')),
    rock: paint(TILE, TILE, (x, y) => (x === 0 || y === 0 ? '1' : 'b')),
    ring: paint(UNIT, 6, (x, y) => {
      const d = ((x - 7.5) / 8) ** 2 + ((y - 2.5) / 3) ** 2;
      return d <= 1 && d > 0.45 ? '4' : '.';
    }),
  };
  for (let hp = 1; hp <= 4; hp++) {
    frames[`hp-${hp}`] = paint(14, 3, (x, y) =>
      x === 0 || y === 0 || x === 13 || y === 2 ? '1' : x <= hp * 3 ? '5' : '0',
    );
  }
  for (const team of TEAMS) {
    for (const facing of DRAWN) {
      for (const step of [0, 1]) frames[`${team}-${facing}-${step}`] = unitFrame(team, facing, step);
    }
  }
  return { palette: 'rts-bench', frames };
}

/** The `canvas2d` skin over the sheet: tiles, two unit kinds (walk cycles, mirrored), ring, bar. */
export function benchSkin(): SkinFile {
  const unit = (team: string) => ({
    flipFacing: true,
    frames: {
      walk: Object.fromEntries(
        DRAWN.map((f) => [f, { frames: [`${team}-${f}-0`, `${team}-${f}-1`], ticks: 8 }]),
      ),
    },
  });
  return {
    backend: 'canvas2d',
    sheets: { sheet: SHEET, fallbackColor: '#ff00ff' },
    kinds: {
      blue: unit('blue'),
      red: unit('red'),
      ring: { frames: { idle: 'ring' } },
      hp: { frames: { hp1: 'hp-1', hp2: 'hp-2', hp3: 'hp-3', hp4: 'hp-4' } },
    },
    tiles: {
      '.': { frame: 'grass' },
      ',': { frame: 'dirt' },
      '~': { frame: 'water' },
      '#': { frame: 'rock' },
    },
  } as SkinFile;
}

/** The map: a seeded mix of grass, dirt, water and rock. */
export function benchMap(seed: number): PresentMap {
  const rng = new Rng(seed);
  const tiles = Array.from({ length: MAP_CELLS }, () =>
    Array.from({ length: MAP_CELLS }, () => {
      const n = rng.int(100);
      return n < 70 ? '.' : n < 85 ? ',' : n < 95 ? '~' : '#';
    }).join(''),
  );
  return { id: 'bench', version: 1, tileSize: TILE, cols: MAP_CELLS, rows: MAP_CELLS, tiles };
}

export type BenchLayout = 'spread' | 'crowd';

export interface BenchCase {
  units: number;
  zoom: number;
  /** Default `spread`. */
  layout?: BenchLayout;
  seed?: number;
}

/** The `crowd` box, in world px: what the picture shows at zoom 0.5. */
export const CROWD_BOX = { w: BENCH_SCREEN.width * 2, h: BENCH_SCREEN.height * 2 };

/** Frames that pan the camera round the map once in this many frames. */
export const PAN_PERIOD = 600;

/**
 * Makes the frames of one case in order. `next()` steps every unit one tick (a new direction
 * every 30 to 89 ticks, turning back at the map's edge) and returns the frame: the full map on the
 * first frame and a `{ id, version }` reference after, and per unit its ring (layer 0), body
 * (layer 1) and health bar (layer 2).
 */
export class BenchScene {
  private readonly rng: Rng;
  private readonly map: PresentMap;
  private readonly x: Int32Array;
  private readonly y: Int32Array;
  private readonly dir: Uint8Array;
  private readonly timer: Int32Array;
  private readonly hp: Uint8Array;
  private tick = 0;

  constructor(readonly opts: BenchCase) {
    const seed = opts.seed ?? 1;
    this.rng = new Rng(seed);
    this.map = benchMap(seed);
    const n = opts.units;
    this.x = new Int32Array(n);
    this.y = new Int32Array(n);
    this.dir = new Uint8Array(n);
    this.timer = new Int32Array(n);
    this.hp = new Uint8Array(n);
    const area = this.area();
    for (let i = 0; i < n; i++) {
      this.x[i] = this.rng.int(area.w - UNIT);
      this.y[i] = this.rng.int(area.h - UNIT);
      this.dir[i] = this.rng.int(8);
      this.timer[i] = 30 + this.rng.int(60);
      this.hp[i] = 1 + this.rng.int(4);
    }
  }

  /** Where units walk: the whole map, or the crowd box (relative to its top-left). */
  private area(): { w: number; h: number } {
    return this.opts.layout === 'crowd' ? CROWD_BOX : { w: MAP_CELLS * TILE, h: MAP_CELLS * TILE };
  }

  next(): PresentFrame {
    const t = this.tick++;
    if (t > 0) this.step();
    // The camera's centre goes round an ellipse inside the map, one lap per PAN_PERIOD frames.
    const half = (MAP_CELLS * TILE) / 2;
    const angle = (2 * Math.PI * t) / PAN_PERIOD;
    const camX = Math.round(half + half * 0.7 * Math.cos(angle));
    const camY = Math.round(half + half * 0.7 * Math.sin(angle));
    const crowd = this.opts.layout === 'crowd';
    const ox = crowd ? camX - CROWD_BOX.w / 2 : 0;
    const oy = crowd ? camY - CROWD_BOX.h / 2 : 0;
    const entities: PresentEntity[] = [];
    for (let i = 0; i < this.opts.units; i++) {
      const x = ox + this.x[i]!;
      const y = oy + this.y[i]!;
      const facing = DIRS[this.dir[i]!]![2];
      const anim = { state: 'idle', t: 0 };
      entities.push(
        { id: `r${i}`, kind: 'ring', x, y: y + 11, w: UNIT, h: 6, facing: 'down', anim, tags: [], layer: 0 },
        {
          id: `u${i}`,
          kind: TEAMS[i % 2]!,
          x,
          y,
          w: UNIT,
          h: UNIT,
          facing,
          anim: { state: 'walk', t: t + i },
          tags: [],
          layer: 1,
        },
        {
          id: `h${i}`,
          kind: 'hp',
          x: x + 1,
          y: y - 4,
          w: 14,
          h: 3,
          facing: 'down',
          anim: { state: `hp${this.hp[i]}`, t: 0 },
          tags: [],
          layer: 2,
        },
      );
    }
    return {
      frame: t,
      size: BENCH_SCREEN,
      entities,
      map: t === 0 ? this.map : { id: this.map.id, version: this.map.version },
      events: [],
      status: {},
      camera: { x: camX, y: camY, zoom: this.opts.zoom },
    };
  }

  private step(): void {
    const area = this.area();
    for (let i = 0; i < this.opts.units; i++) {
      if (--this.timer[i]! <= 0) {
        this.dir[i] = this.rng.int(8);
        this.timer[i] = 30 + this.rng.int(60);
      }
      let [dx, dy] = DIRS[this.dir[i]!]!;
      const nx = this.x[i]! + dx;
      const ny = this.y[i]! + dy;
      if (nx < 0 || nx > area.w - UNIT || ny < 0 || ny > area.h - UNIT) {
        this.dir[i] = (this.dir[i]! + 4) % 8;
        [dx, dy] = DIRS[this.dir[i]!]!;
      }
      this.x[i] = this.x[i]! + dx;
      this.y[i] = this.y[i]! + dy;
    }
  }
}

/** The `p`-th percentile (0 to 100) of `values`, by nearest rank; NaN for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/** Frame-time summary in ms, and fps from the mean. */
export interface FrameStats {
  frames: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  fps: number;
}

export function frameStats(times: readonly number[]): FrameStats {
  const mean = times.reduce((s, t) => s + t, 0) / Math.max(1, times.length);
  return {
    frames: times.length,
    mean,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: times.length === 0 ? NaN : Math.max(...times),
    fps: mean > 0 ? 1000 / mean : NaN,
  };
}

/** The 60 fps budget of decision 6: the 95th-percentile frame time is at most this many ms. */
export const BUDGET_MS = 16.7;
