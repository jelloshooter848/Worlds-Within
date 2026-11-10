import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT, UsageError } from '../exit-codes';
import { stateHash } from '../headless-run';
import { defineCommand } from '../registry';
import { readRunFile } from '../run-file';
import { pngSize, takeScreenshot } from '../screenshot';
import { invalidShot, shotSetup } from '../shot-job';
import { checkOverlay, overlayLabel, parseOverlay } from '../sheet-overlay';
import { SHOT_BACKENDS, type ShotBackend, type ShotRefusal } from '../screenshot/job';

/**
 * `screenshot <run-file> --tick N [--out path] [--backend canvas2d|three|pixi] [--allow-software-gl]`: plays the run file to tick N in headless Chromium
 * through the game's view module (`view` in `game.json`, `engine/core/view.ts`) and the canvas2d
 * backend, drawing every tick on the way (as a player's screen would), and writes the last frame as a PNG of the game's picture size (`screen` in `game.json`,
 * 256x240 by default; devicePixelRatio 1). No real-time loop and no
 * audio: the same run file and tick give a byte-identical PNG on two runs in a row.
 *
 * Result: `{ run, game, seed, start, tick, path, width, height, bytes, sha256, hash, headlessHash,
 * hashes, matchesHeadless }`. `path` is the PNG, relative to the working folder (default
 * `.ww-out/screenshots/<run name>-t<tick>.png`); `sha256` is the whole PNG's SHA-256 in hex;
 * `hash` is the state hash of the snapshot the page drew, `headlessHash` the one `dump` gives at
 * that tick; `hashes` the state hashes the page saw while drawing (tick 0, every `hashEvery` ticks
 * and the last, as `run` lists them). `matchesHeadless` is true when every one of them is the
 * headless run's. Exit 0, 4 (`failedCheck`) when they differ (the PNG is still written),
 * 3 (`invalidContent`) for a bad run file or content or a game with no view module, 2 for a bad
 * tick or `--out`, 5 when Chromium is not installed (`pnpm exec playwright install chromium`).
 *
 * A game run's `missions` (Engine 0.11 T9) are handed to the view's `mission` after each tick's
 * orders, as `run` hands them to the headless game, so a screenshot can show a mission's round.
 * A run's `from` (Engine 0.13 T8, gap M33) is played as `run` plays it: the view is created at the
 * campaign save `run` starts from (`HeadlessOptions.campaign`), so a follow-up's screenshot draws
 * the follow-up. A run's `start` (Engine 0.14, gap G9) goes to `createView` as
 * `HeadlessOptions.start`, so the picture is of the level or entry the run starts at.
 *
 * `--backend three` shows the view's `frame()` through the Three.js backend and the game's `three`
 * skin instead (Chromium with the GPU on), syncing every tick and rendering once at tick N. A view
 * without `frame()` is exit 3 (`no_frame_hook` at `view`), a game without a `three` skin exit 3
 * (`no_three_skin` at `content.skin`). WebGL on a software renderer (SwiftShader, llvmpipe...) is
 * refused with exit 4 (`failedCheck`, no PNG written, `renderer` and `message` name it and the
 * flag) unless `--allow-software-gl`, which also makes Chromium use SwiftShader on purpose so the
 * PNG is the same every run; no WebGL context at all is exit 4 too. The result adds `backend` and
 * `renderer` (the WebGL renderer string; null for canvas2d).
 *
 * `--backend pixi` (Engine 0.16 T13b-5) shows the view's `frame()` through the PixiJS backend
 * (`pixiDisplay`) and the game's `canvas2d` skins, presenting every tick as the shell does, on
 * WebGL in Chromium on SwiftShader (always, so the PNG is the same every run). Software WebGL is
 * not refused for PixiJS (the 2D picture needs no GPU to be right): `renderer` names the WebGL
 * renderer string. A view without `frame()` is exit 3 (`no_frame_hook`), a game without a
 * `canvas2d` skin exit 3 (`no_canvas2d_skin`), no WebGL context exit 4. How close the picture is
 * to Canvas2D's is `tests/browser/pixi-parity.test.ts`'s check.
 *
 * Engine 0.16 part B: `--scale N` (whole, 1-16) returns the picture N times as large, each pixel
 * an exact N x N block (nearest neighbour), so a 320x180 game at 6 is exactly 1920x1080; and
 * `--overlay <o>` draws one of `sheet`'s overlays over the tick's picture (`title`, `pause`,
 * `settings`, `controls`, `levels`, `clear`, `end`, `ui=<file>[.<widget>]` or a transition, with
 * `*<n>`; `sheet-overlay.ts`), through the same job (`shotSetup`, a one-tile `ShotJob.tiles`). An
 * overlay the game cannot show is a usage error before Chromium starts. The result adds `scale`
 * and `overlay` (its label, or null).
 */
export const screenshotCommand = defineCommand({
  name: 'screenshot',
  summary: 'a PNG of one paused, seeded frame of a run file (headless Chromium)',
  args: z.strictObject({
    runFile: z
      .string()
      .min(1)
      .describe('the run file, such as games/samples/dungeon/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    tick: z.number().int().min(0).describe('the tick to draw (0 is the start, before any step)'),
    out: z
      .string()
      .min(1)
      .optional()
      .describe('where to write the PNG (default .ww-out/screenshots/<run name>-t<tick>.png)'),
    backend: z
      .enum(SHOT_BACKENDS)
      .default('canvas2d')
      .describe(
        "what draws it: canvas2d (the view's render), three (its frame() and the game's three skin) or pixi (its frame() and the 2D skin through PixiJS)",
      ),
    allowSoftwareGl: z
      .boolean()
      .default(false)
      .describe('three only: take the picture on software WebGL (SwiftShader) instead of refusing (exit 4)'),
    scale: z
      .number()
      .int()
      .min(1)
      .max(16)
      .default(1)
      .describe(
        'whole-number upscale, nearest neighbour: each pixel becomes N x N (320x180 at 6 is 1920x1080)',
      ),
    overlay: z
      .string()
      .min(1)
      .optional()
      .describe(
        "draw one of sheet's overlays over the picture: title, pause, settings, controls, levels, clear, end, ui=<file>[.<widget>] or a transition, each with an optional *<n>",
      ),
  }),
  async run({ args, flags }, ctx) {
    if (flags.allowSoftwareGl && flags.backend !== 'three')
      throw new UsageError('--allow-software-gl is for --backend three only');
    if (flags.out !== undefined && !flags.out.toLowerCase().endsWith('.png'))
      throw new UsageError(`--out must name a .png file, not ${flags.out}`);
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (runFile.ok && runFile.value.worldFile !== null)
      throw new UsageError(`${runFile.value.file} plays a world, which has no view to draw (Engine 0.8)`);
    if (runFile.ok && flags.tick > runFile.value.run.ticks)
      throw new UsageError(`--tick ${flags.tick} is after the run's last tick (${runFile.value.run.ticks})`);
    let overlay = null;
    if (flags.overlay !== undefined) {
      try {
        overlay = parseOverlay(flags.overlay);
      } catch (error) {
        throw new UsageError(`--overlay: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const setup = await shotSetup(ctx, args.runFile, {
      tick: flags.tick,
      backend: flags.backend,
      allowSoftwareGl: flags.allowSoftwareGl,
      ...(overlay !== null && { tiles: [{ tick: flags.tick, overlay }] }),
    });
    if (!setup.ok) return setup.outcome;
    if (overlay !== null) {
      const why = checkOverlay(setup.value.content, overlay);
      if (why !== null) throw new UsageError(`--overlay ${flags.overlay}: ${why}`);
    }
    if (flags.scale > 1) setup.value.request.job.scale = flags.scale;
    const { request, played, root } = setup.value;
    const { loaded, seed, start, lastTick, snapshot, hashes: headlessHashes } = played;
    const where = `${root}${MANIFEST_FILE}`;
    const view = setup.value.content.manifest.view ?? '';
    const shot = await takeScreenshot(request.job, request.gameAbs, request.viewAbs);
    if ('refused' in shot) return refused(shot, loaded.file, where, `${root}${view}`, flags.backend);
    const png = overlay !== null ? shot.tiles[0]! : shot.png;
    const size = pngSize(png);
    const name = basename(loaded.file)
      .replace(/\.run\.json$/, '')
      .replace(/\.json$/, '');
    const out = resolve(ctx.cwd, flags.out ?? `${ctx.outDir}/screenshots/${name}-t${lastTick}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);

    const hash = createHash('sha256').update(shot.snapshot).digest('hex').slice(0, 16);
    const headlessHash = stateHash(snapshot);
    const differs = hash === headlessHash ? firstDifference(shot.hashes, headlessHashes) : lastTick;
    const matchesHeadless = differs === null;
    return {
      exit: matchesHeadless ? EXIT.ok : EXIT.failedCheck,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        seed,
        start,
        tick: lastTick,
        backend: flags.backend,
        renderer: shot.renderer,
        path: relative(ctx.cwd, out).replaceAll('\\', '/'),
        width: size.width,
        height: size.height,
        scale: flags.scale,
        overlay: overlay === null ? null : overlayLabel(overlay),
        bytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        hash,
        headlessHash,
        hashes: shot.hashes,
        matchesHeadless,
        ...(differs === null
          ? {}
          : {
              message: `the page's state at tick ${differs} is not the headless run's (page ${shot.hashes.find((h) => h.tick === differs)?.hash ?? 'none'}, headless ${headlessHashes.find((h) => h.tick === differs)?.hash ?? 'none'}): the view module plays or draws differently from the headless one`,
            }),
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    if (result.refused) return String(result.message);
    const head = `${String(result.path)} (${String(result.width)}x${String(result.height)}, sha256 ${String(result.sha256)})`;
    const state = `${String(result.run)} @ tick ${String(result.tick)}, state hash ${String(result.hash)}`;
    return result.matchesHeadless ? `${head}\n${state}` : `${head}\n${state}\n${String(result.message)}`;
  },
});

const invalid = invalidShot;

/** The page's refusal as a result: a view without `frame()` is content (3), WebGL a failed check (4). */
function refused(shot: ShotRefusal, run: string, where: string, viewFile: string, backend: ShotBackend) {
  if (shot.refused === 'no_frame_hook')
    return invalid(run, [
      contentError(
        where,
        ['view'],
        'no_frame_hook',
        `${viewFile} (view in ${where}) gives no frame() (engine/core/view.ts), which --backend ${backend} needs`,
      ),
    ]);
  const message =
    shot.refused === 'software_gl'
      ? `WebGL is not hardware-backed: the renderer is "${String(shot.renderer)}", a software one. Run where a GPU is available, or pass --allow-software-gl to take the picture with SwiftShader anyway`
      : backend === 'pixi'
        ? `no WebGL context, so --backend pixi cannot draw (${shot.message})`
        : `no WebGL context, so --backend three cannot draw (${shot.message}). Pass --allow-software-gl to use SwiftShader`;
  return {
    exit: EXIT.failedCheck,
    result: { run, backend, renderer: shot.renderer, refused: shot.refused, message },
  };
}

type TickHashes = readonly { tick: number; hash: string }[];

/** The first tick where two hash lists differ (a tick one list lacks counts), or null. */
export function firstDifference(page: TickHashes, headless: TickHashes): number | null {
  for (let i = 0; i < Math.max(page.length, headless.length); i++) {
    const a = page[i];
    const b = headless[i];
    if (a?.tick !== b?.tick || a?.hash !== b?.hash) return Math.min(a?.tick ?? Infinity, b?.tick ?? Infinity);
  }
  return null;
}
