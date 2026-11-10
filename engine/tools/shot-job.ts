import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
import { SKIN_KIND } from '@engine/core/content/engine-kinds';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import { skinSet } from '@engine/core/present';
import { EXIT, UsageError } from './exit-codes';
import { loadGame } from './game-loader';
import { headlessRules, playRun, type PlayedRun } from './headless-run';
import type { CommandContext, Outcome } from './registry';
import { readRunFile } from './run-file';
import type { ShotRequest } from './screenshot';
import type { ShotBackend, ShotTile } from './screenshot/job';

/**
 * The screenshot page's job for a run file (`screenshot`, and from Engine 0.16 T14 `sheet`): the
 * run played headless to `tick` (for the hashes the page must match), the game loaded, its view
 * module found and, for `three`, its `three` skin checked, all before Chromium starts. Bad command
 * lines throw `UsageError`; bad content gives the command's exit-3 outcome.
 */
export interface ShotSetup {
  request: ShotRequest;
  played: PlayedRun;
  /** The game's content (checked), for a tile's overlay checks. */
  content: ContentBundle;
  /** The game folder as a repo path with a trailing `/` (`games/fx-lab/`). */
  root: string;
}

export interface ShotSetupOptions {
  tick: number;
  backend: ShotBackend;
  allowSoftwareGl: boolean;
  tiles?: ShotTile[];
}

/** An exit-3 outcome naming the run file and its errors. */
export function invalidShot(run: string, errors: ContentError[]): Outcome {
  return { exit: EXIT.invalidContent, result: { run, errors } };
}

export async function shotSetup(
  ctx: CommandContext,
  runFilePath: string,
  opts: ShotSetupOptions,
): Promise<{ ok: true; value: ShotSetup } | { ok: false; outcome: Outcome }> {
  const runFile = readRunFile(ctx.cwd, runFilePath);
  if (runFile.ok && runFile.value.worldFile !== null)
    throw new UsageError(`${runFile.value.file} plays a world, which has no view to draw (Engine 0.8)`);
  if (runFile.ok && opts.tick > runFile.value.run.ticks)
    throw new UsageError(
      `tick ${opts.tick} of ${runFile.value.file} is after the run's last tick (${runFile.value.run.ticks})`,
    );
  const played = await playRun(ctx.cwd, runFilePath, { untilTick: opts.tick });
  if (!played.ok) return { ok: false, outcome: invalidShot(runFilePath, played.errors) };
  const { loaded, seed, lastTick, kit, disabledRulesByKit, startSave, start } = played.value;

  const game = loadGame(ctx.cwd, loaded.gameDir ?? '.');
  if (!game.content.ok) return { ok: false, outcome: invalidShot(loaded.file, game.content.errors) };
  const root = game.dir === '.' ? '' : `${game.dir}/`;
  const { view, screen } = game.content.value.manifest;
  const where = `${root}${MANIFEST_FILE}`;
  if (view === undefined)
    return {
      ok: false,
      outcome: invalidShot(loaded.file, [
        contentError(where, ['view'], 'no_view', `${where} names no view module, which screenshot needs`),
      ]),
    };
  const gameAbs = resolve(ctx.cwd, game.dir);
  const viewAbs = resolve(gameAbs, view);
  if (!existsSync(viewAbs))
    return {
      ok: false,
      outcome: invalidShot(loaded.file, [
        contentError(where, ['view'], 'missing_file', `no file at ${root}${view}`),
      ]),
    };

  if (opts.backend === 'three' && skinSet(game.content.value, 'three').main === null) {
    const skins = contentOf(game.content.value, SKIN_KIND);
    const have =
      skins.length === 0
        ? 'it has no skins'
        : `its skins are ${skins.map((e) => `${root}${e.file} (${e.value.backend})`).join(', ')}`;
    return {
      ok: false,
      outcome: invalidShot(loaded.file, [
        contentError(
          where,
          ['content', 'skin'],
          'no_three_skin',
          `--backend three needs a skin with "backend": "three" (not only mini games' three-<id> skins) in ${where} content.skin; ${have}`,
        ),
      ]),
    };
  }

  return {
    ok: true,
    value: {
      played: played.value,
      content: game.content.value,
      root,
      request: {
        gameAbs,
        viewAbs,
        job: {
          files: { ...game.texts },
          root,
          seed,
          ticks: lastTick,
          hashEvery: loaded.run.hashEvery,
          input: loaded.run.input,
          orders: loaded.run.orders,
          missions: loaded.run.missions,
          ...headlessRules(kit ?? '', disabledRulesByKit),
          campaign: startSave,
          start,
          screen,
          backend: opts.backend,
          allowSoftwareGl: opts.allowSoftwareGl,
          ...(opts.tiles !== undefined && { tiles: opts.tiles }),
        },
      },
    },
  };
}
