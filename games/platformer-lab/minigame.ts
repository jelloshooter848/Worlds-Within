import { z } from 'zod';
import type { JsonObject } from '@engine/core/headless';
import type { MiniGameDef, MiniGameResult } from '@engine/core/minigame';
import type { PresentEntity, PresentFrame } from '@engine/core/present';
import { Rng } from '@engine/core/rng';

/**
 * The lab's one mini game, `stop-bar` ("STOP THE BAR"): an original test game for the platformer
 * kit's mini game hook. A marker sweeps to and fro along a bar of `cells` cells, one cell every
 * `every` ticks; pressing attack while it is on the `zone` cells (where they are comes from the
 * round's seed) passes, pressing it anywhere else fails, select quits, and a round that lasts
 * `ticks` ticks fails. Its numbers come from the trigger's `params` in the level file:
 *
 *   "triggers": [{ "game": "stop-bar", "params": { "cells": 16, "zone": 3, "every": 4, "ticks": 240 },
 *                  "pass": ["coins:5", "open:12:9"], "fail": ["respawn"] }]
 *
 * It is pure: no drawing (its `present()` describes the bar for the skin) and nothing random but
 * the seed the level hands it, so a run file plays it the same every time.
 */

/** The bar's look in a frame, in screen pixels: each cell's width and height, and the bar's top. */
export const BAR_CELL = { w: 8, h: 8 } as const;
export const BAR_TOP = 112;
export const MARKER = { w: 8, h: 16 } as const;

const DEFAULTS = { cells: 16, zone: 3, every: 4, ticks: 240 } as const;
type Params = { -readonly [K in keyof typeof DEFAULTS]: number };

/** The params as whole numbers, each at least 1 and the zone shorter than the bar. */
function readParams(raw: JsonObject): Params {
  const out = { ...DEFAULTS } as Params;
  for (const key of Object.keys(DEFAULTS) as (keyof Params)[]) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1) out[key] = v;
  }
  out.cells = Math.max(out.cells, 2);
  out.zone = Math.min(out.zone, out.cells - 1);
  return out;
}

/**
 * The shape of the round's params (gap G16, Engine 0.10), for `pnpm cli validate`: each a whole
 * number of at least 1, all optional, nothing else. A round still reads them leniently
 * (`readParams`), so what the schema passes plays as before.
 */
export const stopBarParamsSchema = z.strictObject({
  cells: z.int().min(1).exactOptional().describe('cells in the bar (16 when left out; at least 2 are used)'),
  zone: z.int().min(1).exactOptional().describe('cells in the zone (3; kept shorter than the bar)'),
  every: z.int().min(1).exactOptional().describe('ticks per marker move (4)'),
  ticks: z.int().min(1).exactOptional().describe('the time limit in ticks (240)'),
});

export const STOP_BAR: MiniGameDef = {
  id: 'stop-bar',
  title: 'STOP THE BAR',
  paramsSchema: stopBarParamsSchema,
  create(ctx, seed) {
    const p = readParams(ctx.params);
    const rng = new Rng(seed >>> 0 || 1);
    const zoneAt = rng.int(p.cells - p.zone + 1);
    let at = rng.int(p.cells);
    let dir = 1;
    let ticks = 0;
    let result: MiniGameResult | null = null;
    const inZone = () => at >= zoneAt && at < zoneAt + p.zone;
    return {
      step(input) {
        if (result) return;
        ticks++;
        if (input.pressed('select')) result = 'quit';
        else if (input.pressed('attack')) result = inZone() ? 'pass' : 'fail';
        else if (ticks >= p.ticks) result = 'fail';
        else if (ticks % p.every === 0) {
          if (at + dir < 0 || at + dir >= p.cells) dir = -dir;
          at += dir;
        }
      },
      snapshot: () => ({ at, dir, zoneAt, zone: p.zone, cells: p.cells, ticks, attempt: ctx.attempt }),
      result: () => result,
      present(): PresentFrame {
        const left = 128 - (p.cells * BAR_CELL.w) / 2;
        const entity = (
          id: string,
          kind: string,
          x: number,
          y: number,
          w: number,
          h: number,
          state: string,
        ) =>
          ({
            id,
            kind,
            x,
            y,
            w,
            h,
            facing: 'right',
            anim: { state, t: ticks },
            tags: [],
            layer: 0,
          }) as PresentEntity;
        const cells = Array.from({ length: p.cells }, (_, i) =>
          entity(
            `bar#${i}`,
            'bar-cell',
            left + i * BAR_CELL.w,
            BAR_TOP,
            BAR_CELL.w,
            BAR_CELL.h,
            i >= zoneAt && i < zoneAt + p.zone ? 'zone' : 'idle',
          ),
        );
        const marker = entity(
          'bar-marker',
          'bar-marker',
          left + at * BAR_CELL.w,
          BAR_TOP - (MARKER.h - BAR_CELL.h) / 2,
          MARKER.w,
          MARKER.h,
          result ?? 'idle',
        );
        marker.layer = 1;
        return {
          frame: ticks,
          size: { width: 256, height: 240 },
          entities: [...cells, marker],
          events: [],
          status: { attempt: ctx.attempt, timeLeft: Math.max(0, p.ticks - ticks) },
          camera: { x: 128, y: 120 },
        };
      },
    };
  },
};

/** Every mini game the lab's levels may name. */
export const LAB_MINI_GAMES: readonly MiniGameDef[] = [STOP_BAR];
