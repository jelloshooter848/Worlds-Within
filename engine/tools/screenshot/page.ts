import { CanvasRenderer } from '@engine/backends/canvas2d';
import type { ContentBundle } from '@engine/core/content/bundle';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { presenterBySkinSet, skinSet, type Presenter } from '@engine/core/present';
import type { ViewEntry, ViewGame } from '@engine/core/view';
import { checkGameTexts } from '../game-check';
import type { ShotJob, ShotRefusal, ShotResult } from './job';

/**
 * The screenshot page (browser only, tools only). `pnpm cli screenshot` opens it in headless
 * Chromium and calls `window.wwShoot(job)`: the page checks the game's files, imports the game's
 * view module by its URL, and steps it exactly `job.ticks` times with the run's scripted input (no
 * real-time loop, no audio), drawing every tick (tick 0 included) with the canvas2d backend onto
 * a canvas of the game's picture size (`job.screen`, from `game.json`), as a player's screen
 * would. It returns the last picture as a PNG data URL, the snapshot at that tick, and the state
 * hashes it saw on the way (tick 0, every `job.hashEvery` ticks and the last), so the CLI can
 * check that drawing every tick changed nothing.
 *
 * With `job.backend` `three` the page shows the view's `frame()` through a `ThreePresenter` and
 * the game's `three` skins (`skinSet`: `three.json`, and `three-<id>.json` for the frames of mini
 * game `<id>`, Engine 0.7 T8) on a WebGL canvas of the same size instead: it reads the WebGL renderer
 * string first and refuses (a {@link ShotRefusal}) when there is no context, or when it is a
 * software renderer and `job.allowSoftwareGl` is false; it syncs the scene with every tick's
 * frame (so the camera's lerp is the one play shows) and renders once, at the last tick.
 */

/** The state hash as `run` computes it: the first 16 hex digits of the SHA-256 of the JSON. */
async function stateHash(json: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

async function shoot(job: ShotJob): Promise<ShotResult | ShotRefusal> {
  const content = checkGameTexts(job.files, job.root);
  if (!content.ok) throw new Error(`the game's content has errors: ${JSON.stringify(content.errors)}`);
  const entry = (await import(/* @vite-ignore */ job.viewUrl)) as Partial<ViewEntry>;
  if (typeof entry.createView !== 'function')
    throw new Error(`${job.viewUrl} does not export createView(content, seed) (engine/core/view.ts)`);
  const game = entry.createView(content.value, job.seed, {
    disabledRules: job.disabledRules,
    ...(job.campaign === null ? {} : { campaign: job.campaign }),
    ...(job.start === null ? {} : { start: job.start }),
  });
  const { width, height } = job.screen;
  if (game.screen?.width !== width || game.screen.height !== height)
    throw new Error(
      `${job.viewUrl} draws a ${String(game.screen?.width)}x${String(game.screen?.height)} picture, but game.json says ${width}x${height}`,
    );
  return job.backend === 'three' ? shootThree(job, game, content.value) : shootCanvas(job, game);
}

/** Plays the job's input, recorded orders and mission steps on `game`, calling `show(tick)` at every tick (tick 0 included). */
async function play(
  job: ShotJob,
  game: ViewGame,
  show: (tick: number) => void,
): Promise<Pick<ShotResult, 'snapshot' | 'hashes'>> {
  const input = new ScriptedInput(job.input);
  const hashes: ShotResult['hashes'] = [];
  let snapshot = '';
  let next = 0; // the next recorded order to hand over
  let nextMission = 0; // the next mission step to hand over
  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      for (; next < job.orders.length && job.orders[next]!.tick === tick - 1; next++) {
        if (!game.order)
          throw new Error(`${job.viewUrl}: the run has orders, but the view has no order(order) method`);
        const { tick: _tick, ...order } = job.orders[next]!;
        game.order(order as JsonObject);
      }
      // Then that tick's mission steps, in file order (a refusal is the run's to report, not the page's).
      for (
        ;
        nextMission < job.missions.length && job.missions[nextMission]!.tick === tick - 1;
        nextMission++
      ) {
        if (!game.mission)
          throw new Error(`${job.viewUrl}: the run has missions, but the view has no mission(step) method`);
        const { tick: _tick, ...step } = job.missions[nextMission]!;
        game.mission(step as JsonObject);
      }
      input.next();
      game.step(input);
    }
    show(tick);
    if (tick % job.hashEvery === 0 || tick === job.ticks) {
      snapshot = canonicalJson(game.snapshot());
      hashes.push({ tick, hash: await stateHash(snapshot) });
    }
    if (tick === job.ticks) break;
  }
  return { snapshot, hashes };
}

function newCanvas(job: ShotJob): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = job.screen.width;
  canvas.height = job.screen.height;
  return canvas;
}

async function shootCanvas(job: ShotJob, game: ViewGame): Promise<ShotResult> {
  const canvas = newCanvas(job);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const renderer = new CanvasRenderer(ctx);
  const played = await play(job, game, () => game.render(renderer));
  return {
    png: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    ...played,
    renderer: null,
  };
}

async function shootThree(
  job: ShotJob,
  game: ViewGame,
  content: ContentBundle,
): Promise<ShotResult | ShotRefusal> {
  const frame = game.frame?.bind(game);
  if (frame === undefined)
    return {
      refused: 'no_frame_hook',
      renderer: null,
      message: `${job.viewUrl} gives no frame() (engine/core/view.ts), which --backend three needs`,
    };
  const skins = skinSet(content, 'three');
  if (!skins.main) throw new Error(`the game has no skin with backend "three"`);
  const { ThreePresenter, isSoftwareRenderer } = await import('@engine/backends/three');
  const canvas = newCanvas(job);
  let presenter: InstanceType<typeof ThreePresenter>;
  try {
    presenter = new ThreePresenter(canvas, skins.main, {
      size: job.screen,
      ...(game.background !== undefined && { background: game.background }),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { refused: 'no_webgl', renderer: null, message: `no WebGL context: ${why}` };
  }
  const { renderer } = presenter.rendererInfo();
  if (isSoftwareRenderer(renderer) && !job.allowSoftwareGl) {
    presenter.dispose();
    return { refused: 'software_gl', renderer, message: `WebGL runs on a software renderer: ${renderer}` };
  }
  // Each mini game with a skin of its own gets a scene of its own on the same canvas; every tick
  // syncs the scene its frame belongs to, and the last tick also draws it.
  const draws: Record<string, Presenter> = {};
  const syncs: Record<string, Presenter> = {};
  for (const [id, skin] of Object.entries(skins.rounds)) {
    const round = presenter.withSkin(skin);
    draws[id] = round;
    syncs[id] = { present: (f) => round.scene.sync(f) };
  }
  const main = presenter;
  const draw = presenterBySkinSet(main, draws);
  const sync = presenterBySkinSet({ present: (f) => main.scene.sync(f) }, syncs);
  const played = await play(job, game, (tick) => (tick === job.ticks ? draw : sync).present(frame()));
  const png = canvas.toDataURL('image/png');
  presenter.dispose();
  return { png, width: canvas.width, height: canvas.height, ...played, renderer };
}

declare global {
  interface Window {
    wwShoot?: (job: ShotJob) => Promise<ShotResult | ShotRefusal>;
  }
}

window.wwShoot = shoot;
