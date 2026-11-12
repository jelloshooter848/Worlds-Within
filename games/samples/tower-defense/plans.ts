import type { TdBotStep } from '@kits/towerdefense';

/**
 * The bot plans the sample's full-game run files were played from (Engine 0.16 E9), as the kit's
 * `TdBot` steps: what a player does, in order. `tower-defense.test.ts` replays each through the bot
 * and checks it gives its run file's input exactly; `play.test.ts` plays `WIN_PLAN` on the page's
 * scene at 2x and 3x (the `sped-up` run). Data for tests only: the page never plays a plan.
 */

/**
 * The good defence (`runs/win.run.json`, and played sped up `runs/sped-up.run.json`): thirteen
 * towers built and upgraded between the waves, each wave sent once the last is cleared; all ten
 * waves held with 18 lives, three stars (the tuned waves 9 and 10 let two brutes through).
 */
export const WIN_PLAN: readonly TdBotStep[] = [
  { do: 'place', tower: 'arrow', col: 4, row: 4 },
  { do: 'place', tower: 'arrow', col: 6, row: 10 },
  { do: 'place', tower: 'cannon', col: 9, row: 10 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'place', tower: 'frost', col: 11, row: 5 },
  { do: 'upgrade', col: 4, row: 4 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'place', tower: 'arrow', col: 15, row: 5 },
  { do: 'upgrade', col: 6, row: 10 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 9, row: 10 },
  { do: 'place', tower: 'arrow', col: 17, row: 11 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 4, row: 4 },
  { do: 'upgrade', col: 6, row: 10 },
  { do: 'place', tower: 'cannon', col: 20, row: 11 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 15, row: 5 },
  { do: 'upgrade', col: 17, row: 11 },
  { do: 'upgrade', col: 11, row: 5 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 9, row: 10 },
  { do: 'upgrade', col: 20, row: 11 },
  { do: 'place', tower: 'frost', col: 22, row: 7 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 20, row: 11 },
  { do: 'upgrade', col: 15, row: 5 },
  { do: 'upgrade', col: 17, row: 11 },
  { do: 'place', tower: 'cannon', col: 25, row: 7 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 25, row: 7 },
  { do: 'upgrade', col: 11, row: 5 },
  { do: 'place', tower: 'arrow', col: 27, row: 9 },
  { do: 'upgrade', col: 27, row: 9 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 25, row: 7 },
  { do: 'upgrade', col: 22, row: 7 },
  { do: 'upgrade', col: 27, row: 9 },
  { do: 'place', tower: 'arrow', col: 13, row: 8 },
  { do: 'place', tower: 'arrow', col: 7, row: 8 },
  { do: 'place', tower: 'arrow', col: 24, row: 4 },
  { do: 'upgrade', col: 24, row: 4 },
  { do: 'wave' },
  { do: 'clear' },
];

/**
 * A thin defence (`runs/lost.run.json`): two arrows, each upgraded once, and every wave sent as
 * the last clears; the road holds three waves, leaks from the fourth and is lost in wave 6.
 */
export const LOST_PLAN: readonly TdBotStep[] = [
  { do: 'place', tower: 'arrow', col: 4, row: 4 },
  { do: 'place', tower: 'arrow', col: 6, row: 10 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 4, row: 4 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'upgrade', col: 6, row: 10 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
];
