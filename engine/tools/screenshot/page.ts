import { CanvasRenderer } from '@engine/backends/canvas2d';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import type { ViewEntry } from '@engine/core/view';
import { checkGameTexts } from '../game-check';
import type { ShotJob, ShotResult } from './job';

/**
 * The screenshot page (browser only, tools only). `pnpm cli screenshot` opens it in headless
 * Chromium and calls `window.wwShoot(job)`: the page checks the game's files, imports the game's
 * view module by its URL, and steps it exactly `job.ticks` times with the run's scripted input (no
 * real-time loop, no audio), drawing every tick (tick 0 included) with the canvas2d backend onto
 * a canvas of the game's picture size (`job.screen`, from `game.json`), as a player's screen
 * would. It returns the last picture as a PNG data URL, the snapshot at that tick, and the state
 * hashes it saw on the way (tick 0, every `job.hashEvery` ticks and the last), so the CLI can
 * check that drawing every tick changed nothing.
 */

/** The state hash as `run` computes it: the first 16 hex digits of the SHA-256 of the JSON. */
async function stateHash(json: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const renderer = new CanvasRenderer(ctx);
  const input = new ScriptedInput(job.input);
  const hashes: ShotResult['hashes'] = [];
  let snapshot = '';
  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      input.next();
      game.step(input);
    }
    game.render(renderer);
    if (tick % job.hashEvery === 0 || tick === job.ticks) {
      snapshot = canonicalJson(game.snapshot());
      hashes.push({ tick, hash: await stateHash(snapshot) });
    }
    if (tick === job.ticks) break;
  }
  return { png: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, snapshot, hashes };
}

declare global {
  interface Window {
    wwShoot?: (job: ShotJob) => Promise<ShotResult>;
  }
}

window.wwShoot = shoot;
