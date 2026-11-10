import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT, UsageError } from '../exit-codes';
import { stateHash } from '../headless-run';
import { defineCommand } from '../registry';
import { pngSize, takeScreenshots, type Shot } from '../screenshot';
import type { ShotBackend, ShotTile } from '../screenshot/job';
import {
  composeSheet,
  parseTiles,
  SHEET_BACKENDS,
  sheetBackend,
  tileMeta,
  type SheetPicture,
} from '../sheet';
import { checkOverlay } from '../sheet-overlay';
import { shotSetup, type ShotSetup } from '../shot-job';
import { firstDifference } from './screenshot';

/**
 * `sheet <run-file> --ticks <tiles> [--backend 2d|three] [--allow-software-gl] [--out file.png]
 * [--columns N] [--scale N] [--labels a|b|...] [--title text]` (Engine 0.16 T14): screenshots of
 * a run at several ticks, tiled with labels into one PNG, for reviewing effects at a glance (the
 * owner's effects sheet, `docs/reports/0.16a-effects-sheet.png`).
 *
 * Each tile is `[<run>/]<tick>[+<overlay>][@<backend>]`:
 *
 * - `<tick>`: drawn as `screenshot --tick` draws it (every tick on the way drawn, the run's input,
 *   orders, missions, `from` and `start` played as `run` plays them).
 * - `<run>/`: another run file in the same folder as `<run-file>` (`level-3/120` is
 *   `level-3.run.json`'s tick 120), so one sheet can show several levels.
 * - `+<overlay>`: drawn over the picture by the engine's own code: one of the game's menu
 *   screens (`title`, `pause`, `settings`, `controls`: `game.json`'s `menus`, as the browser
 *   shell builds them), a `ui` content file (`ui=lab`, or one widget opened alone,
 *   `ui=lab.talk`), each stepped `*<frames>` display frames first (default 30 for menus, 120 for
 *   ui: a dialog types its page), or a screen transition `*<age>` frames in (a `transitions` slot,
 *   `level`, `scene`, `mission`, `default`, or a kind with 20-frame halves, `fade`, `wipe`, `iris`;
 *   default the frame it first covers all). 2D paints them with `CanvasUiPainter` and
 *   `drawTransition` (an iris on the picture's centre), 3D with the presenter's overlay and
 *   transition passes (an iris on the camera's focus).
 * - `@<backend>`: `2d` (`canvas2d`) or `3d` (`three`) for this tile, else `--backend`.
 *
 * Each run file and backend is played once in headless Chromium (one browser per backend), its
 * state hashes compared with the headless run's as `screenshot` compares them. Result: `{ run,
 * path, width, height, bytes, sha256, columns, scale, tiles: [{ run, tick, overlay, backend,
 * label }], plays: [{ run, backend, renderer, ticks, hash, headlessHash, matchesHeadless,
 * message? }], matchesHeadless }`. Exit 0; 4 when a page's hashes differ from the headless run
 * (the PNG is still written) or a `three` play is refused (software WebGL without
 * `--allow-software-gl`, no WebGL); 3 for a bad run file or content (as `screenshot`); 2 for a bad
 * tile, a tick past its run, an overlay the game cannot show, a bad `--out` or labels that do not
 * match the tiles; 5 when Chromium is not installed.
 */
export const sheetCommand = defineCommand({
  name: 'sheet',
  summary: 'labelled screenshots of a run at several ticks, tiled into one PNG (headless Chromium)',
  args: z.strictObject({
    runFile: z.string().min(1).describe('the run file, such as games/fx-lab/runs/level-1.run.json'),
  }),
  flags: z.strictObject({
    ticks: z
      .string()
      .min(1)
      .describe(
        'the tiles, comma-separated: [<run>/]<tick>[+<overlay>][@<backend>], such as 216,level-3/120,300+pause,40+ui=lab.talk,352+level*22,200@3d',
      ),
    out: z
      .string()
      .min(1)
      .optional()
      .describe('where to write the PNG (default .ww-out/sheets/<run name>.png)'),
    backend: z
      .enum(SHEET_BACKENDS)
      .default('canvas2d')
      .describe('what draws the tiles without an @<backend> of their own: 2d (canvas2d) or 3d (three)'),
    allowSoftwareGl: z
      .boolean()
      .default(false)
      .describe('3D tiles: draw on software WebGL (SwiftShader) instead of refusing (exit 4)'),
    columns: z.number().int().min(1).max(16).default(4).describe('tiles per row'),
    scale: z.number().int().min(1).max(8).default(1).describe('whole-number scale of each picture'),
    labels: z
      .string()
      .optional()
      .describe("a caption per tile, separated by '|', shown over each tile's run, tick and overlay"),
    title: z.string().optional().describe('a heading over the sheet'),
  }),
  async run({ args, flags }, ctx) {
    if (flags.out !== undefined && !flags.out.toLowerCase().endsWith('.png'))
      throw new UsageError(`--out must name a .png file, not ${flags.out}`);
    const tiles = parseTiles(flags.ticks);
    const captions = flags.labels === undefined ? null : flags.labels.split('|').map((c) => c.trim());
    if (captions !== null && captions.length !== tiles.length)
      throw new UsageError(`--labels gives ${captions.length} captions for ${tiles.length} tiles`);
    const backend = sheetBackend(flags.backend);
    const runOf = (name: string | null) =>
      name === null
        ? args.runFile
        : join(dirname(args.runFile), name.endsWith('.json') ? name : `${name}.run.json`).replaceAll(
            '\\',
            '/',
          );

    // One play per run file and backend, in the order the tiles first name them.
    interface Play {
      run: string;
      backend: ShotBackend;
      tiles: ShotTile[];
      /** Each tile's index in `tiles` (the command's), by its place in this play. */
      index: number[];
      setup?: ShotSetup;
      shot?: Shot;
    }
    const plays: Play[] = [];
    tiles.forEach((t, i) => {
      const run = runOf(t.run);
      const b = t.backend ?? backend;
      let play = plays.find((p) => p.run === run && p.backend === b);
      if (play === undefined) plays.push((play = { run, backend: b, tiles: [], index: [] }));
      play.tiles.push({ tick: t.tick, overlay: t.overlay });
      play.index.push(i);
    });

    for (const play of plays) {
      const tick = Math.max(...play.tiles.map((t) => t.tick));
      const setup = await shotSetup(ctx, play.run, {
        tick,
        backend: play.backend,
        allowSoftwareGl: play.backend === 'three' && flags.allowSoftwareGl,
        tiles: play.tiles,
      });
      if (!setup.ok) return setup.outcome;
      for (const [n, t] of play.tiles.entries()) {
        const why = t.overlay === null ? null : checkOverlay(setup.value.content, t.overlay);
        if (why !== null) throw new UsageError(`--ticks: "${tiles[play.index[n]!]!.text}": ${why}`);
      }
      play.setup = setup.value;
    }

    for (const b of ['canvas2d', 'three'] as const) {
      const mine = plays.filter((p) => p.backend === b);
      if (mine.length === 0) continue;
      const shots = await takeScreenshots(
        mine.map((p) => p.setup!.request),
        { backend: b, allowSoftwareGl: b === 'three' && flags.allowSoftwareGl },
      );
      for (const [i, shot] of shots.entries()) {
        if ('refused' in shot) {
          const message =
            shot.refused === 'software_gl'
              ? `WebGL is not hardware-backed: the renderer is "${String(shot.renderer)}", a software one. Run where a GPU is available, or pass --allow-software-gl`
              : shot.message;
          return {
            exit: shot.refused === 'no_frame_hook' ? EXIT.invalidContent : EXIT.failedCheck,
            result: {
              run: mine[i]!.run,
              backend: b,
              renderer: shot.renderer,
              refused: shot.refused,
              message,
            },
          };
        }
        mine[i]!.shot = shot;
      }
    }

    const pictures: SheetPicture[] = new Array<SheetPicture>(tiles.length);
    const tileRows: Record<string, unknown>[] = new Array<Record<string, unknown>>(tiles.length);
    const playRows = plays.map((p) => {
      const { played } = p.setup!;
      const shot = p.shot!;
      p.index.forEach((i, n) => {
        const meta = tileMeta(played.loaded.file, p.tiles[n]!, p.backend);
        const caption = captions?.[i];
        pictures[i] = {
          png: shot.tiles[n]!,
          lines: caption === undefined || caption === '' ? [meta] : [caption, meta],
        };
        tileRows[i] = {
          run: played.loaded.file,
          tick: p.tiles[n]!.tick,
          overlay: tiles[i]!.overlay,
          backend: p.backend,
          label: pictures[i].lines.join(' - '),
        };
      });
      const hash = createHash('sha256').update(shot.snapshot).digest('hex').slice(0, 16);
      const headlessHash = stateHash(played.snapshot);
      const differs = hash === headlessHash ? firstDifference(shot.hashes, played.hashes) : played.lastTick;
      return {
        run: played.loaded.file,
        backend: p.backend,
        renderer: shot.renderer,
        ticks: played.lastTick,
        hash,
        headlessHash,
        matchesHeadless: differs === null,
        ...(differs !== null && {
          message: `the page's state at tick ${differs} is not the headless run's: the view module plays or draws differently from the headless one`,
        }),
      };
    });

    const png = await composeSheet(pictures, {
      columns: flags.columns,
      scale: flags.scale,
      ...(flags.title !== undefined && { title: flags.title }),
    });
    const name = basename(args.runFile)
      .replace(/\.run\.json$/, '')
      .replace(/\.json$/, '');
    const out = resolve(ctx.cwd, flags.out ?? `${ctx.outDir}/sheets/${name}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    const size = pngSize(png);
    const matchesHeadless = playRows.every((p) => p.matchesHeadless);
    return {
      exit: matchesHeadless ? EXIT.ok : EXIT.failedCheck,
      result: {
        run: plays[0]!.setup!.played.loaded.file,
        path: relative(ctx.cwd, out).replaceAll('\\', '/'),
        width: size.width,
        height: size.height,
        bytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        columns: flags.columns,
        scale: flags.scale,
        matchesHeadless,
        tiles: tileRows,
        plays: playRows,
      },
    };
  },
  text(result) {
    if (result.errors) return formatErrors(result.errors as ContentError[]);
    if (result.refused) return String(result.message);
    const head = `${String(result.path)} (${String(result.width)}x${String(result.height)}, ${(result.tiles as unknown[]).length} tiles, sha256 ${String(result.sha256)})`;
    const plays = (
      result.plays as { run: string; backend: string; matchesHeadless: boolean; message?: string }[]
    ).map(
      (p) =>
        `${p.run} [${p.backend}]: ${p.matchesHeadless ? 'state hashes match the headless run' : p.message}`,
    );
    return [head, ...plays].join('\n');
  },
});
