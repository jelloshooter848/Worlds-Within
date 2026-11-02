import { CanvasRenderer } from '@engine/backends/canvas2d';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import type { ViewEntry } from '@engine/core/view';
import { checkGameTexts } from '../game-check';
import type { ShotJob, ShotResult } from './job';

/**
 * The screenshot page (browser only, tools only). `pnpm cli screenshot` opens it in headless
 * Chromium and calls `window.wwShoot(job)`: the page checks the game's files, imports the game's
 * view module by its URL, steps it exactly `job.ticks` times with the run's scripted input (no
 * real-time loop, no audio), draws one frame with the canvas2d backend onto a canvas of the game's
 * picture size (`job.screen`, from `game.json`) and returns the canvas as a PNG data URL, plus the snapshot at that tick.
 */

async function shoot(job: ShotJob): Promise<ShotResult> {
  const content = checkGameTexts(job.files, job.root);
  if (!content.ok) throw new Error(`the game's content has errors: ${JSON.stringify(content.errors)}`);
  const entry = (await import(/* @vite-ignore */ job.viewUrl)) as Partial<ViewEntry>;
  if (typeof entry.createView !== 'function')
    throw new Error(`${job.viewUrl} does not export createView(content, seed) (engine/core/view.ts)`);
  const game = entry.createView(content.value, job.seed, { disabledRules: job.disabledRules });
  const { width, height } = job.screen;
  if (game.screen?.width !== width || game.screen.height !== height)
    throw new Error(
      `${job.viewUrl} draws a ${String(game.screen?.width)}x${String(game.screen?.height)} picture, but game.json says ${width}x${height}`,
    );
  const input = new ScriptedInput(job.input);
  for (let tick = 0; tick < job.ticks; tick++) {
    input.next();
    game.step(input);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  game.render(new CanvasRenderer(ctx));
  return {
    png: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    snapshot: canonicalJson(game.snapshot()),
  };
}

declare global {
  interface Window {
    wwShoot?: (job: ShotJob) => Promise<ShotResult>;
  }
}

window.wwShoot = shoot;
