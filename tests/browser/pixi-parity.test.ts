import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { decodePng, pixelDiff, type PixelRect, type RgbaPicture } from '../../engine/tools/png-diff';
import { launchChromium, NoBrowserError, takeScreenshots, type Shot } from '../../engine/tools/screenshot';
import type { ShotBackend } from '../../engine/tools/screenshot/job';
import { parseOverlay } from '../../engine/tools/sheet-overlay';
import { shotSetup } from '../../engine/tools/shot-job';

// Visual parity of the two 2D backends (Engine 0.16 T13b-5): the same ticks of the fx lab, the RTS
// skirmish (the 0.15 battle and, from part D's D7, The River Ford on its CC0 pack) and the tower defense, drawn by `pnpm cli screenshot`'s page through Canvas2D (the
// view's `render`) and through PixiJS (`frame()` and `pixiDisplay`, WebGL on SwiftShader), are
// compared pixel by pixel. Every presentation effect is on (the presenters' defaults): particles,
// flashes, tints, shake, parallax, the HUD, the pause menu (the fx lab) and a fade or wipe
// transition over the picture. The ticks are chosen where effects show (an event's particles, a
// flash, a tint, a shake).
//
// The tolerance: a pixel differs when one of its R, G or B channels differs by more than the
// game's `threshold`, and the share of differing pixels may not pass its `maxShare`.
//
// - RTS and tower defense (no glow, no additive blending): threshold 8, at most 0.1% of the
//   pixels. They are equal to the last bit here; the margin is for another GPU's rounding.
// - The fx lab (additive glowing particles, a glowing door): threshold 32, at most 1% of the
//   pixels over the whole picture, since PixiJS draws glow as a stretched soft halo sprite and
//   Canvas2D as `shadowBlur`, and the two blend additive overlaps a little differently (up to
//   about 0.6% of the pixels, channels up to ~95 apart, all around the glowing things). Its top
//   half (sky, parallax mountains, HUD, title text, the pause menu) holds the strict bound.
// - The iris transition is left out: PixiJS centres it on the camera's focus (as in the shell),
//   the screenshot page's Canvas2D tile on the picture's centre.
//
// Skipped where Chromium is not installed (never in CI).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function browserMissing(): Promise<string | null> {
  try {
    await (await launchChromium()).close();
    return null;
  } catch (error) {
    if (process.env.CI || !(error instanceof NoBrowserError)) return null;
    return error.message;
  }
}
const missing = await browserMissing();
if (missing) console.warn(`skipping the PixiJS/Canvas2D parity test: ${missing}`);

/** A per-channel threshold and the largest share of pixels allowed past it. */
interface Bound {
  threshold: number;
  maxShare: number;
}

/** The strict bound: pictures with no glow or additive blending. */
const STRICT: Bound = { threshold: 8, maxShare: 0.001 };
/** The looser bound for pictures with glow and additive particles (the fx lab). */
const GLOW: Bound = { threshold: 32, maxShare: 0.01 };

interface Case {
  name: string;
  run: string;
  /** Tiles as `sheet` writes them: `<tick>[+<overlay>]`. */
  tiles: string[];
  /** The bound over the whole picture. */
  bound: Bound;
  /** A region that must hold the strict bound as well (where nothing glows). */
  strictRegion?: PixelRect;
}

const CASES: Case[] = [
  {
    name: 'the fx lab',
    run: 'games/fx-lab/runs/level-1.run.json',
    // Dust, a stomp's particles, coins and the door's glow, the end of the level; a fade, a wipe
    // and the pause menu over it.
    tiles: ['60', '100', '154', '200', '300', '345', '100+fade*12', '100+wipe*12', '300+pause'],
    bound: GLOW,
    strictRegion: { x: 0, y: 0, w: 256, h: 120 },
  },
  {
    name: 'the RTS skirmish (the 0.15 battle, kept as games/rts-classic)',
    run: 'games/rts-classic/runs/battle.run.json',
    // A building done (flash), units going down (particles), hits, the battle won (tint, banner).
    tiles: ['19', '124', '127', '141', '148', '160', '127+fade*10', '141+wipe*8'],
    bound: STRICT,
  },
  {
    name: 'the RTS skirmish on its CC0 pack at 16:9 (The River Ford, Engine 0.16 part D, D7)',
    run: 'games/samples/rts-skirmish/runs/battle.run.json',
    // The pack's sprites with team colours and outlines, the made ground sheet, zoom-stable bars,
    // the minimap; a building done (flash), units going down (particles), the battle won (banner).
    tiles: ['19', '124', '141', '160', '141+fade*10'],
    bound: STRICT,
  },
  {
    name: 'the tower defense',
    run: 'games/samples/tower-defense/runs/won.run.json',
    // A wave starting (flash), kills (particles), cannon shots (shake), the round won (tint).
    tiles: ['26', '63', '180', '455', '482', '674', '455+fade*10', '300+wipe*8'],
    bound: STRICT,
  },
];

/** One play of a case's run through `backend`, with every tile of the case. */
async function shots(c: Case, backend: ShotBackend): Promise<Shot> {
  const tiles = c.tiles.map((t) => {
    const [tick, overlay] = t.split('+');
    return { tick: Number(tick), overlay: overlay === undefined ? null : parseOverlay(overlay) };
  });
  const setup = await shotSetup({ cwd: ROOT, outDir: '.ww-out' }, c.run, {
    tick: Math.max(...tiles.map((t) => t.tick)),
    backend,
    allowSoftwareGl: false,
    tiles,
  });
  if (!setup.ok) throw new Error(JSON.stringify(setup.outcome.result));
  const [shot] = await takeScreenshots([setup.value.request], { backend });
  if (shot === undefined || 'refused' in shot) throw new Error(`${backend}: ${JSON.stringify(shot)}`);
  return shot;
}

describe.skipIf(missing !== null)('PixiJS and Canvas2D draw the same pictures (T13b-5)', () => {
  it.each(CASES)(
    '$name',
    async (c) => {
      const canvas = await shots(c, 'canvas2d');
      const pixi = await shots(c, 'pixi');
      expect(pixi.renderer, 'the WebGL renderer string').toEqual(expect.any(String));
      // Both played the run as the headless game does.
      expect(pixi.hashes).toEqual(canvas.hashes);
      const pictures: RgbaPicture[] = [];
      const report = c.tiles.map((tile, i) => {
        const a = decodePng(canvas.tiles[i]!);
        const b = decodePng(pixi.tiles[i]!);
        pictures.push(a);
        const whole = pixelDiff(a, b, { threshold: c.bound.threshold });
        const strict =
          c.strictRegion === undefined
            ? null
            : pixelDiff(a, b, { threshold: STRICT.threshold, region: c.strictRegion });
        return {
          tile,
          share: whole.share,
          maxChannel: whole.maxChannel,
          box: whole.box,
          strict: strict?.share ?? 0,
        };
      });
      for (const r of report) {
        const why = JSON.stringify(r);
        expect(r.share, why).toBeLessThanOrEqual(c.bound.maxShare);
        expect(r.strict, why).toBeLessThanOrEqual(STRICT.maxShare);
      }
      // The ticks show different pictures (nothing came back blank or stuck).
      for (let i = 1; i < pictures.length; i++)
        expect(pixelDiff(pictures[0]!, pictures[i]!, { threshold: 0 }).differing).toBeGreaterThan(0);
    },
    300_000,
  );
});
