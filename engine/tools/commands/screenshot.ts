import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT, UsageError } from '../exit-codes';
import { loadGame } from '../game-loader';
import { playRun, stateHash } from '../headless-run';
import { defineCommand } from '../registry';
import { readRunFile } from '../run-file';
import { pngSize, takeScreenshot } from '../screenshot';

/**
 * `screenshot <run-file> --tick N [--out path]`: plays the run file to tick N in headless Chromium
 * through the game's view module (`view` in `game.json`, `engine/core/view.ts`) and the canvas2d
 * backend, and writes that frame as a PNG of the game's picture size (`screen` in `game.json`,
 * 256x240 by default; devicePixelRatio 1). No real-time loop and no
 * audio: the same run file and tick give a byte-identical PNG on two runs in a row.
 *
 * Result: `{ run, game, seed, tick, path, width, height, bytes, sha256, hash, headlessHash,
 * matchesHeadless }`. `path` is the PNG, relative to the working folder (default
 * `.ww-out/screenshots/<run name>-t<tick>.png`); `sha256` is the whole PNG's SHA-256 in hex;
 * `hash` is the state hash of the snapshot the page drew, `headlessHash` the one `dump` gives at
 * that tick. Exit 0, 4 (`failedCheck`) when the two state hashes differ (the PNG is still written),
 * 3 (`invalidContent`) for a bad run file or content or a game with no view module, 2 for a bad
 * tick or `--out`, 5 when Chromium is not installed (`pnpm exec playwright install chromium`).
 */
export const screenshotCommand = defineCommand({
  name: 'screenshot',
  summary: 'a PNG of one paused, seeded frame of a run file (headless Chromium)',
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/demo/runs/walk-east.run.json'),
  }),
  flags: z.strictObject({
    tick: z.number().int().min(0).describe('the tick to draw (0 is the start, before any step)'),
    out: z
      .string()
      .min(1)
      .optional()
      .describe('where to write the PNG (default .ww-out/screenshots/<run name>-t<tick>.png)'),
  }),
  async run({ args, flags }, ctx) {
    if (flags.out !== undefined && !flags.out.toLowerCase().endsWith('.png'))
      throw new UsageError(`--out must name a .png file, not ${flags.out}`);
    const runFile = readRunFile(ctx.cwd, args.runFile);
    if (runFile.ok && flags.tick > runFile.value.run.ticks)
      throw new UsageError(`--tick ${flags.tick} is after the run's last tick (${runFile.value.run.ticks})`);
    const played = await playRun(ctx.cwd, args.runFile, { untilTick: flags.tick });
    if (!played.ok) return invalid(args.runFile, played.errors);
    const { loaded, seed, lastTick, snapshot, disabledRules } = played.value;

    const game = loadGame(ctx.cwd, loaded.gameDir);
    if (!game.content.ok) return invalid(loaded.file, game.content.errors);
    const root = game.dir === '.' ? '' : `${game.dir}/`;
    const { view, screen } = game.content.value.manifest;
    const where = `${root}${MANIFEST_FILE}`;
    if (view === undefined)
      return invalid(loaded.file, [
        contentError(where, ['view'], 'no_view', `${where} names no view module, which screenshot needs`),
      ]);
    const gameAbs = resolve(ctx.cwd, game.dir);
    const viewAbs = resolve(gameAbs, view);
    if (!existsSync(viewAbs))
      return invalid(loaded.file, [
        contentError(where, ['view'], 'missing_file', `no file at ${root}${view}`),
      ]);

    const shot = await takeScreenshot(
      {
        files: { ...game.texts },
        root,
        seed,
        ticks: lastTick,
        input: loaded.run.input,
        disabledRules,
        screen,
      },
      gameAbs,
      viewAbs,
    );
    const size = pngSize(shot.png);
    const name = basename(loaded.file)
      .replace(/\.run\.json$/, '')
      .replace(/\.json$/, '');
    const out = resolve(ctx.cwd, flags.out ?? `${ctx.outDir}/screenshots/${name}-t${lastTick}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, shot.png);

    const hash = createHash('sha256').update(shot.snapshot).digest('hex').slice(0, 16);
    const headlessHash = stateHash(snapshot);
    const matchesHeadless = hash === headlessHash;
    return {
      exit: matchesHeadless ? EXIT.ok : EXIT.failedCheck,
      result: {
        run: loaded.file,
        game: loaded.gameDir,
        seed,
        tick: lastTick,
        path: relative(ctx.cwd, out).replaceAll('\\', '/'),
        width: size.width,
        height: size.height,
        bytes: shot.png.length,
        sha256: createHash('sha256').update(shot.png).digest('hex'),
        hash,
        headlessHash,
        matchesHeadless,
        ...(matchesHeadless
          ? {}
          : {
              message: `the page's state at tick ${lastTick} (hash ${hash}) is not the headless run's (${headlessHash}): the view module plays differently from the headless one`,
            }),
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    const head = `${String(result.path)} (${String(result.width)}x${String(result.height)}, sha256 ${String(result.sha256)})`;
    const state = `${String(result.run)} @ tick ${String(result.tick)}, state hash ${String(result.hash)}`;
    return result.matchesHeadless ? `${head}\n${state}` : `${head}\n${state}\n${String(result.message)}`;
  },
});

function invalid(run: string, errors: ContentError[]) {
  return { exit: EXIT.invalidContent, result: { run, errors } };
}
