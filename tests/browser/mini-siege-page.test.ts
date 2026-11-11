import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { InputScript } from '@engine/core/input/scripted-input';
import type { DebugWindow, RoundRecording } from '@engine/core/shell';
import { main } from '@engine/tools/main';
import { screenAtCell } from '@kits/towerdefense';
import { browserMissing, launch, ROOT, serveBuilt } from './serve';

// The mini siege played from a link (docs/ROADMAP.md, 0.11 "done when": played from a link in a
// few minutes, by playing the mission and by delegating it, and both paths change the battle the
// way the design says). The repo is built as `pnpm build` builds it and served as `pnpm preview`
// serves it; headless Chromium finds games/samples/mini-siege/ in the launcher and opens it on
// fresh pages. The page runs in manual-loop mode (`?debug=step`; one loop step per
// `window.__ww.step(n)`), so the game is the same every time. Skipped where Chromium is not
// installed (never in CI).
//
// Engine 0.16 F7: the page opens **in 3D** (Chromium's software WebGL, SwiftShader, at render
// scale 1: `?scale=1`) with the mission flow in the picture (Engine 0.16 F5's mission screens):
// every entry's briefing is begun by a click on Begin, and at world tick 40 the sabotage's card
// is answered by a click on Delegate (seed 11 draws `ram-burnt`) or Play (the recorded round of
// `played.run.json` typed on the keyboard, which burns both engines; the page records it with
// `?record`, Engine 0.14 T9, and `pnpm cli record` writes it into a run file that passes with the
// golden hashes). On both paths the battle holds still while the round is played, the result
// commits at world tick 160 (40 + the mission's cost of 120) and its outcome card shows. The
// preparation phase (Engine 0.12 T8): the fortify card at world tick 10, delegated by the keys
// (right, then Enter: `overrun`), by a gamepad (the d-pad and A) and by a touch tap, played by
// the recorded keys of `fortify-played.run.json` (`held-cheap`) and by taps in the walls' round
// then given up (`overrun`), each committing at 40 (10 + 30). The campaign (Engine 0.13 T8):
// the siege to its end at 260 along both captain fates (Delegate: `ram-burnt`, the captain on the
// map; Play then Backspace: `driven-off`, the captain captured), the results screen's save code
// equal to the run files' pinned codes, Continue to the dawn (the captain on the map to its end
// at 200, then every later entry; or held, with the three captive choices listed in the picture,
// the exchange chosen and decided at 5 and committed at 15), and a second page in the same
// browser carrying on from the stored save (the briefing's Carry on). Every entry is held at tick
// 0 with its briefing until Begin (gap M34). The 3D picture is shot at the siege's afternoon and
// at the dawn (`WW_SHOTS_DIR` keeps `mini-siege-page-*.png`).
//
// Engine 0.16 F8: the hosted rounds are drawn in 2D on a layer over the 3D picture (the `three`
// skin's `rounds2d`): each round played here (the sabotage by keys, the walls by keys and by taps,
// the rescue in the campaign) opens with the iris transition, shows the layer while it is played
// (`wwSiege.layer()`), and closes back on the 3D world with the commit applied.
//
// Engine 0.16 F9: the whole campaign in 3D, tested end to end. The delegated path starts on the
// title screen (`&title=show`: Start, then the siege's briefing); each results screen lists what
// changed in the world (`wwSiege.texts()`: the record, losses, people, buildings and the save code,
// none cut); and the captured siege's code from its results, put in a fresh 3D page's link
// (`?code=`, gap M42), resumes the dawn with the captain held (a bad one leaves the siege).
//
// In 2D (`?backend=canvas2d`, and wherever WebGL 2 is missing: the page falls back by itself) the
// shell's DOM bar stays: a save code typed in its box is refused with its reason when bad and
// resumes the dawn from the quit siege's code.

const GAME = 'games/samples/mini-siege/';
/** The campaign's entries after the dawn, from its file (none until Engine 0.14 T12's ridge camp). */
const AFTER_DAWN = (() => {
  const { entries } = JSON.parse(
    readFileSync(join(ROOT, GAME, 'content/campaigns/siege.campaign.json'), 'utf8'),
  ) as { entries: { scenario: string; ticks: number; title: string }[] };
  return entries.slice(entries.findIndex((e) => e.scenario === 'dawn') + 1);
})();
/** Loop steps per world tick (`STEPS_PER_TICK` in play.ts). */
const STEPS_PER_TICK = 6;
/** The keys the shell binds to each action (`engine/core/input/bindings.ts`). */
const KEYS: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  attack: 'KeyX',
  jump: 'KeyZ',
  special: 'KeyC',
  start: 'Enter',
  select: 'Backspace',
};
/** The 3D page in manual-loop mode at render scale 1 (software GL draws it quickly). */
const QUERY_3D = '?debug=step&scale=1';
/** The 2D page with the DOM bar. */
const QUERY_2D = '?debug=step&backend=canvas2d';
const shots = process.env.WW_SHOTS_DIR ?? null;

type Box = { x: number; y: number; w: number; h: number };
interface Hook {
  tick(): number;
  held(): boolean;
  scenario(): string;
  ended(): {
    code: string | null;
    next: string | null;
    done: boolean;
    people: string[];
    verdict: string;
  } | null;
  named(): Record<string, { alive: boolean; hp: number | null; fate?: string }>;
  captive(): string;
  choice(): string | null;
  playing(): boolean;
  outcomes(): string[];
  miniGame(): string;
  round(): Record<string, unknown> | null;
  ui(): 'picture' | 'bar';
  screen(): string | null;
  itemBox(item: string): Box | null;
  layer(): 'world' | 'round';
  transitioning(): boolean;
  texts(): string[];
}

/**
 * The centre of the walls' round's cell on the page, in client px (gap D13): the kit's
 * `screenAtCell` on the 320x180 picture (Engine 0.16 F6) over the 16x7 `walls` map (centred, as
 * the round's camera frames it), then the page's `window.__ww.toClient` (the display's).
 */
async function wallsCellClient(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  const at = screenAtCell({ col, row }, { size: { width: 320, height: 180 } }, { cols: 16, rows: 7 });
  return toClient(page, at.x, at.y);
}

/** A picture point (picture px) on the page, in client px. */
async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const client = await page.evaluate(([x, y]) => (window as DebugWindow).__ww!.toClient(x, y), [
    x,
    y,
  ] as const);
  return client!;
}

/** The save code a run file pins at its last tick. */
const pinnedCode = (run: string): string =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, `runs/${run}.run.json`), 'utf8')) as {
      codes: { code: string }[];
    }
  ).codes.at(-1)!.code;

const recordedRound = (run = 'played'): InputScript =>
  (
    JSON.parse(readFileSync(join(ROOT, GAME, `runs/${run}.run.json`), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

const missing = await browserMissing();
if (missing) console.warn(`skipping the mini siege page test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-mini-siege-page-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Calls `window.wwSiege[name](...args)` on the page. */
function hook<K extends keyof Hook>(
  page: Page,
  name: K,
  ...args: Parameters<Hook[K]>
): Promise<ReturnType<Hook[K]>> {
  return page.evaluate(
    ([name, args]) =>
      (window as unknown as { wwSiege: Record<string, (...a: unknown[]) => unknown> }).wwSiege[name]!(
        ...args,
      ),
    [name, args] as const,
  ) as Promise<ReturnType<Hook[K]>>;
}

/** What to launch, when, and its title. */
interface Launch {
  mission: string;
  tick: number;
  title: string;
}
const SABOTAGE: Launch = { mission: 'sabotage', tick: 40, title: 'Burn the siege engines' };
const FORTIFY: Launch = { mission: 'fortify', tick: 10, title: 'Man the walls' };

/** How a page is driven: the step hook and the input devices aimed at the picture. */
interface Opened {
  page: Page;
  frames(n: number): Promise<void>;
  context: BrowserContext;
}

/** A fake standard gamepad on every page of a context: `window.__pad` holds the pressed buttons. */
const FAKE_PAD = () => {
  const w = window as unknown as { __pad: number[] };
  w.__pad = [];
  Object.defineProperty(navigator, 'getGamepads', {
    value: () => [
      {
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, i) => ({
          pressed: w.__pad.includes(i),
          value: w.__pad.includes(i) ? 1 : 0,
        })),
      },
    ],
  });
};

/** Takes WebGL away from every canvas of the page, as on a browser without it. */
const NO_WEBGL = () => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
    ...rest: unknown[]
  ) {
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
    return (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
  } as typeof get;
};

/** A fresh page of the game in manual-loop mode (a new browser context unless one is given). */
async function opened(
  browser: Browser,
  url: string,
  errors: string[],
  opts: { context?: BrowserContext; query?: string; backend?: string; touch?: boolean } = {},
): Promise<Opened> {
  let context = opts.context;
  if (context === undefined) {
    context = await browser.newContext({
      viewport: { width: 640, height: 520 },
      deviceScaleFactor: 1,
      ...(opts.touch === true && { hasTouch: true, isMobile: true }),
    });
    await context.addInitScript(FAKE_PAD);
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`);
  });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${url}${GAME}${opts.query ?? QUERY_3D}`);
  await page.waitForSelector('body[data-backend]', { timeout: 120_000 });
  expect(await page.evaluate(() => document.body.dataset.backend), errors.join('\n')).toBe(
    opts.backend ?? 'three',
  );
  const frames = (n: number) => page.evaluate((n) => void (window as DebugWindow).__ww!.step(n), n);
  return { page, frames, context };
}

/** Clicks (or taps) a mission screen's item in the picture, then takes a loop step. */
async function press(
  { page, frames }: Opened,
  item: string,
  how: 'mouse' | 'touch' = 'mouse',
  step = true,
): Promise<void> {
  const box = await hook(page, 'itemBox', item);
  expect(box, `no ${item} on the ${await hook(page, 'screen')} screen`).not.toBeNull();
  const at = await toClient(page, box!.x + box!.w / 2, box!.y + box!.h / 2);
  if (how === 'touch') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  if (step) await frames(1);
}

/** A key pressed and released between loop steps. */
async function key({ page, frames }: Opened, code: string): Promise<void> {
  await page.keyboard.down(code);
  await frames(1);
  await page.keyboard.up(code);
  await frames(1);
}

/** A gamepad button pressed for one loop step and released for one. */
async function pad({ page, frames }: Opened, button: number): Promise<void> {
  await page.evaluate((b) => ((window as unknown as { __pad: number[] }).__pad = [b]), button);
  await frames(1);
  await page.evaluate(() => ((window as unknown as { __pad: number[] }).__pad = []));
  await frames(1);
}

/** Shoots the page to `WW_SHOTS_DIR` when it is set. */
async function shoot(page: Page, name: string): Promise<void> {
  if (shots === null) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `mini-siege-page-${name}.png`) });
}

/**
 * The entry is held at tick 0 with its briefing (Engine 0.15 T10, gap M34): nothing steps and
 * nothing is offered until Begin is clicked in the picture; then the briefing goes and the clock
 * runs.
 */
async function begin(o: Opened): Promise<void> {
  const { page, frames } = o;
  expect(await hook(page, 'held')).toBe(true);
  expect(await hook(page, 'screen')).toBe('briefing');
  await frames(STEPS_PER_TICK * 5);
  expect(await hook(page, 'tick')).toBe(0);
  await press(o, 'begin');
  await frames(STEPS_PER_TICK);
  expect(await hook(page, 'held')).toBe(false);
  expect(await hook(page, 'screen')).not.toBe('briefing');
  expect(await hook(page, 'tick')).toBe(1);
}

/** Steps to world tick `tick` (one tick is `STEPS_PER_TICK` loop steps while the battle runs). */
async function toTick({ page, frames }: Opened, tick: number): Promise<void> {
  const now = await hook(page, 'tick');
  if (tick - now > 1) await frames((tick - now - 1) * STEPS_PER_TICK);
  for (let i = 0; i < 60 && (await hook(page, 'tick')) < tick; i++) await frames(1);
  expect(await hook(page, 'tick')).toBe(tick);
}

/** A fresh page of the game, begun and stepped to the launch tick, its mission card showing. */
async function carded(
  browser: Browser,
  url: string,
  errors: string[],
  at: Launch = SABOTAGE,
  query?: string,
) {
  const o = await opened(browser, url, errors, query === undefined ? {} : { query });
  await begin(o);
  await toTick(o, at.tick);
  // One mission offered (the RTS kit's missionButtons): at 10 and at 40 its card, Play or Delegate.
  expect(await hook(o.page, 'screen')).toBe('card');
  expect(await hook(o.page, 'itemBox', 'play')).not.toBeNull();
  expect(await hook(o.page, 'itemBox', 'delegate')).not.toBeNull();
  return o;
}

/**
 * A fresh 3D page opened on its title screen (`&title=show`; Engine 0.16 F9): the title holds the
 * game, Start (Enter) closes it on the siege's briefing, Begin starts the clock and the page is
 * stepped to the sabotage's card.
 */
async function titled(browser: Browser, url: string, errors: string[]): Promise<Opened> {
  const o = await opened(browser, url, errors, { query: `${QUERY_3D}&title=show` });
  const { page, frames } = o;
  const menus = () => page.evaluate(() => (window as DebugWindow).__ww!.menus()!);
  await frames(5);
  expect(await menus()).toMatchObject({ state: 'title', screen: 'title', focused: 'start' });
  expect(await page.evaluate(() => document.body.dataset.menu)).toBe('title');
  expect(await hook(page, 'tick')).toBe(0);
  await shoot(page, 'title');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60 && (await menus()).state !== 'play'; i++) await frames(1);
  expect((await menus()).state).toBe('play');
  expect(await hook(page, 'scenario')).toBe('village');
  await shoot(page, 'briefing');
  await begin(o);
  await toTick(o, SABOTAGE.tick);
  expect(await hook(page, 'screen')).toBe('card');
  return o;
}

/** After Delegate or the round: the battle runs on; steps tick by tick until the mission commits. */
async function toCommit({ page, frames }: Opened): Promise<number> {
  for (let i = 0; i < 300 && (await hook(page, 'outcomes')).length === 0; i++) await frames(STEPS_PER_TICK);
  expect(await hook(page, 'screen')).toBe('outcome');
  return hook(page, 'tick');
}

/**
 * Types a recorded round on the keyboard, one loop step (one round tick) per frame, until the
 * round ends; returns the round's ticks. The round is `game` from its first tick.
 */
async function typeRound(
  page: Page,
  frames: (n: number) => Promise<void>,
  round: InputScript,
  game: string,
): Promise<number> {
  const steps = round.steps;
  let held: string[] = [];
  let next = 0;
  let ticks = 0;
  for (; ticks < 2000; ticks++) {
    while (next < steps.length && steps[next]!.frame <= ticks) {
      const hold = steps[next]!.hold.map((a) => KEYS[a]!);
      for (const k of held) if (!hold.includes(k)) await page.keyboard.up(k);
      for (const k of hold) if (!held.includes(k)) await page.keyboard.down(k);
      held = hold;
      next++;
    }
    await frames(1);
    if (ticks === 0) {
      expect(await hook(page, 'playing')).toBe(true);
      expect(await hook(page, 'miniGame')).toBe(game);
      // The iris closes over the 3D world on the round's first step (Engine 0.16 F8).
      expect(await hook(page, 'transitioning')).toBe(true);
    } else if (ticks === ROUND_SHOWN) {
      // Once the cover opened, the round shows on its 2D layer over the 3D picture.
      expect(await hook(page, 'layer')).toBe('round');
      expect(
        await page.locator('canvas.ww-round-layer').evaluate((c) => getComputedStyle(c).visibility),
      ).toBe('visible');
      // The page's controls stand clear of the round's picture (Engine 0.16 polish P7).
      await controlsClear(page);
    } else if (!(await hook(page, 'playing'))) break;
  }
  for (const k of held) await page.keyboard.up(k);
  return ticks + 1;
}

/**
 * The hosted rounds' picture (the sabotage and rescue rooms, the walls' map with its bar and
 * panel): 256 picture px wide, centred in the 320x180 picture (Engine 0.16 F6), its full height.
 */
const ROUND_PICTURE: Box = { x: 32, y: 0, w: 256, h: 180 };
/** The page's controls: the shell's sound control and pause button, and the 2D link. */
const CONTROLS = ['#ww-volume', '#ww-pause', '#backend'];

/**
 * The page's controls are clear of a round's picture while it shows on its 2D layer (Engine 0.16
 * polish P7, F2): each shown control's box (client px) shares no pixel with the round's.
 */
async function controlsClear(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.body.dataset.round)).toBe('layer');
  const a = await toClient(page, ROUND_PICTURE.x, ROUND_PICTURE.y);
  const b = await toClient(page, ROUND_PICTURE.x + ROUND_PICTURE.w, ROUND_PICTURE.y + ROUND_PICTURE.h);
  const shown = await page.evaluate(
    (ids) =>
      ids.flatMap((id) => {
        const r = document.querySelector(id)?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? [{ id, x: r.x, y: r.y, w: r.width, h: r.height }] : [];
      }),
    CONTROLS,
  );
  expect(shown.map((c) => c.id)).toEqual(CONTROLS);
  for (const c of shown) {
    const over = c.x < b.x && c.x + c.w > a.x && c.y < b.y && c.y + c.h > a.y;
    expect(over, `${c.id} at ${JSON.stringify(c)} over the round at ${JSON.stringify({ a, b })}`).toBe(false);
  }
}

/** Loop steps after a round starts by which the iris has opened on it (`game.json`'s 28 + 6 + 28). */
const ROUND_SHOWN = 70;

/** After a round: the iris back, then the 3D world again, its layer hidden (Engine 0.16 F8). */
async function backToWorld({ page, frames }: Opened): Promise<void> {
  await frames(ROUND_SHOWN);
  expect(await hook(page, 'transitioning')).toBe(false);
  expect(await hook(page, 'layer')).toBe('world');
  expect(await page.locator('canvas.ww-round-layer').evaluate((c) => getComputedStyle(c).visibility)).toBe(
    'hidden',
  );
}

/**
 * Writes the page's recordings into a copy of `played.run.json` whose sabotage play step has no
 * input, with `pnpm cli record --json`, and checks the run passes with the golden hashes.
 */
async function recordInto(recordings: RoundRecording[]): Promise<void> {
  const dir = mkdtempSync(join(temp, 'record-'));
  const run = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/played.run.json'), 'utf8')) as {
    game: string;
    missions: { action: string; input?: InputScript }[];
  };
  run.game = relative(dir, join(ROOT, GAME));
  delete run.missions.find((m) => m.action === 'play')!.input;
  const file = join(dir, 'played.run.json');
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  const recording = join(dir, 'recording.json');
  writeFileSync(recording, JSON.stringify(recordings));
  let stdout = '';
  const code = await main(['record', file, '--mission', 'sabotage', '--input', recording, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(dir, 'out'),
  });
  const result = JSON.parse(stdout) as Record<string, unknown>;
  expect(code, stdout.slice(0, 2000)).toBe(0);
  expect(result).toMatchObject({ written: true, verified: true, passed: true, hashMismatch: null });
  const golden = JSON.parse(readFileSync(join(ROOT, GAME, 'runs/played.hashes.json'), 'utf8')) as {
    hashes: { hash: string }[];
  };
  expect(result.finalHash).toBe(golden.hashes.at(-1)!.hash);
}

/** Steps until the campaign entry played now ends (its results screen); returns the world tick. */
async function toEntryEnd(o: Opened): Promise<number> {
  const { page, frames } = o;
  for (let i = 0; i < 100 && (await hook(page, 'ended')) === null; i++) {
    // A mission's outcome card waits for Continue; the battle runs on under it.
    await frames(STEPS_PER_TICK * 5);
  }
  expect(await hook(page, 'ended')).not.toBeNull();
  expect(await hook(page, 'screen')).toBe('results');
  return hook(page, 'tick');
}

/** Clicks Continue on the results screen and checks the next entry starts at tick 0, held. */
async function toNext(o: Opened, scenario: string): Promise<void> {
  await press(o, 'continue');
  await o.frames(2);
  expect(await hook(o.page, 'scenario')).toBe(scenario);
  await begin(o);
}

describe.skipIf(missing !== null)('the mini siege page (headless Chromium)', () => {
  it('is in the launcher, opens in 3D, and plays both missions both ways from its link', async () => {
    const dist = join(temp, 'dist');
    const server = await serveBuilt('/', dist);
    const browser = await launch();
    const errors: string[] = [];
    try {
      const launcher = await browser.newPage();
      await launcher.goto(server.url);
      expect(await launcher.locator(`#games a[href="${GAME}"]`).count()).toBe(1);
      await launcher.close();

      // Delegated by a click in the picture: the world draws seed 11's outcome at the commit tick.
      {
        const o = await carded(browser, server.url, errors);
        expect(await hook(o.page, 'ui')).toBe('picture');
        expect(await o.page.locator('#bar').count()).toBe(0);
        await shoot(o.page, 'card');
        await press(o, 'delegate');
        expect(await hook(o.page, 'choice')).toBeNull();
        expect(await hook(o.page, 'playing')).toBe(false);
        expect(await toCommit(o)).toBe(160);
        expect(await hook(o.page, 'outcomes')).toEqual(['ram-burnt']);
        await shoot(o.page, 'outcome');
        await press(o, 'continue');
        expect(await hook(o.page, 'screen')).toBeNull();
      }

      // Played by a click on Play: the recorded round typed on the keyboard burns both engines; the
      // world waits. The page records it (`?record`), and `pnpm cli record` writes that into a run
      // file that passes.
      {
        const o = await carded(browser, server.url, errors, SABOTAGE, `${QUERY_3D}&record`);
        expect(await o.page.evaluate(() => (window as DebugWindow).__ww!.recording)).toBe(true);
        // The click is taken on the round's first step, as the keys are.
        await press(o, 'play', 'mouse', false);
        expect(await typeRound(o.page, o.frames, recordedRound(), 'mission-room')).toBe(406);
        expect(await hook(o.page, 'tick')).toBe(40);
        await shoot(o.page, 'room');
        await backToWorld(o);
        const recordings = await o.page.evaluate(() => (window as DebugWindow).__ww!.recordings());
        expect(recordings).toEqual([
          { mission: 'sabotage', tick: 40, ticks: 406, done: true, input: recordedRound() },
        ]);
        await recordInto(recordings);
        expect(await toCommit(o)).toBe(160);
        expect(await hook(o.page, 'outcomes')).toEqual(['both-burnt']);
      }

      // The preparation phase, delegated by the keys (right to Delegate, then Enter): overrun at 40.
      {
        const o = await carded(browser, server.url, errors, FORTIFY);
        await key(o, KEYS['right']!);
        await key(o, KEYS['start']!);
        expect(await hook(o.page, 'choice')).toBeNull();
        expect(await hook(o.page, 'playing')).toBe(false);
        expect(await toCommit(o)).toBe(40);
        expect(await hook(o.page, 'outcomes')).toEqual(['overrun']);
      }

      // The same by a gamepad: the d-pad right, then A.
      {
        const o = await carded(browser, server.url, errors, FORTIFY);
        await pad(o, 15);
        await pad(o, 0);
        expect(await hook(o.page, 'playing')).toBe(false);
        expect(await toCommit(o)).toBe(40);
        expect(await hook(o.page, 'outcomes')).toEqual(['overrun']);
      }

      // And by a touch tap on a phone-sized page.
      {
        const o = await opened(browser, server.url, errors, { touch: true });
        await begin(o);
        await toTick(o, FORTIFY.tick);
        await press(o, 'delegate', 'touch');
        expect(await hook(o.page, 'playing')).toBe(false);
        expect(await toCommit(o)).toBe(40);
        expect(await hook(o.page, 'outcomes')).toEqual(['overrun']);
      }

      // The preparation phase, played: the recorded round typed on the keyboard holds the walls.
      {
        const o = await carded(browser, server.url, errors, FORTIFY);
        await press(o, 'play', 'mouse', false);
        expect(await typeRound(o.page, o.frames, recordedRound('fortify-played'), 'td-defence')).toBe(116);
        expect(await hook(o.page, 'tick')).toBe(10);
        await backToWorld(o);
        expect(await toCommit(o)).toBe(40);
        expect(await hook(o.page, 'outcomes')).toEqual(['held-cheap']);
      }

      // The preparation phase by taps: two taps on the north tower's wall place archers, a right
      // click sells them, then Backspace gives up (the mission's onQuit, overrun).
      {
        const o = await carded(browser, server.url, errors, FORTIFY);
        const { page, frames } = o;
        await press(o, 'play');
        expect(await hook(page, 'miniGame')).toBe('td-defence');
        expect(await hook(page, 'round')).toMatchObject({ gold: 100, towers: 0 });
        // The taps go to the round once the iris has opened on its 2D layer.
        await frames(ROUND_SHOWN);
        expect(await hook(page, 'layer')).toBe('round');
        expect(await hook(page, 'round')).toMatchObject({ gold: 100, towers: 0 });
        await shoot(page, 'walls');
        // Clear of it on a 16:9 window too, where the picture fills the window and only its side
        // margins are left (Engine 0.16 polish P7).
        await controlsClear(page);
        await page.setViewportSize({ width: 960, height: 540 });
        await frames(1);
        await controlsClear(page);
        await shoot(page, 'walls-16x9');
        await page.setViewportSize({ width: 640, height: 520 });
        await frames(1);
        const at = await wallsCellClient(page, 11, 1);
        await page.mouse.click(at.x, at.y);
        await frames(1);
        await page.mouse.click(at.x, at.y);
        await frames(1);
        expect(await hook(page, 'round')).toMatchObject({ gold: 80, towers: 1 });
        await page.mouse.click(at.x, at.y, { button: 'right' });
        await frames(1);
        expect(await hook(page, 'round')).toMatchObject({ gold: 90, towers: 0 });
        await page.keyboard.down('Backspace');
        await frames(1);
        await page.keyboard.up('Backspace');
        expect(await hook(page, 'playing')).toBe(false);
        expect(await toCommit(o)).toBe(40);
        expect(await hook(page, 'outcomes')).toEqual(['overrun']);
      }

      // Without WebGL the page runs in 2D by itself, with the DOM bar.
      {
        const context = await browser.newContext({ viewport: { width: 640, height: 520 } });
        await context.addInitScript(NO_WEBGL);
        const o = await opened(browser, server.url, errors, { context, backend: 'canvas2d' });
        expect(await hook(o.page, 'ui')).toBe('bar');
        expect(await o.page.locator('#briefing').isVisible()).toBe(true);
        await context.close();
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 900_000);

  it('plays the campaign in 3D from the title along both captain fates, and resumes from a save code', async () => {
    const dist = join(temp, 'dist-campaign');
    const server = await serveBuilt('/', dist);
    const browser = await launch();
    const errors: string[] = [];
    /** The captured siege's save code, as its results screen showed it. */
    let code: string | undefined;
    try {
      // The captain kept: from the title, the sabotage delegated, the siege ends at 260 with the
      // delegated run's code, and its results list what changed in the world (Engine 0.16 F9).
      {
        const o = await titled(browser, server.url, errors);
        await shoot(o.page, 'afternoon');
        await press(o, 'delegate');
        expect(await toEntryEnd(o)).toBe(260);
        expect(await hook(o.page, 'outcomes')).toEqual(['ram-burnt']);
        const ended = await hook(o.page, 'ended');
        expect(ended?.code).toBe(pinnedCode('delegated'));
        expect(ended?.people).toContain('Captain Hale: active, 110/120 hp');
        expect(await hook(o.page, 'texts')).toEqual(
          expect.arrayContaining([
            'The siege',
            ended!.verdict,
            'Missions',
            '  The ram burnt, the catapult saved by its crew (delegated)',
            'Losses',
            '  Village: 2 soldiers',
            'People',
            'Buildings',
            '  Hall: 120 hp lost (280/400)',
            'Save code',
            ended!.code!,
          ]),
        );
        expect((await hook(o.page, 'texts')).some((t) => t.startsWith('and '))).toBe(false);
        await shoot(o.page, 'results');
        await toNext(o, 'dawn');
        expect((await hook(o.page, 'named'))['captain']).toMatchObject({ alive: true, hp: 110 });
        expect(await hook(o.page, 'captive')).toBe('');
        await shoot(o.page, 'dawn');
        expect(await toEntryEnd(o)).toBe(200);
        // The dawn's own results, its title and verdict first.
        const dawn = await hook(o.page, 'ended');
        expect((await hook(o.page, 'texts')).slice(0, 2)).toEqual(['The dawn assault', dawn!.verdict]);
        await shoot(o.page, 'dawn-results');
        // Every entry after the dawn (Engine 0.14 T12: a scenario added with data files only,
        // gap M37) is continued to and played to its end, read from the campaign file.
        for (const entry of AFTER_DAWN) {
          expect(await hook(o.page, 'ended')).toMatchObject({ done: false, next: entry.title });
          await toNext(o, entry.scenario);
          expect(await toEntryEnd(o)).toBe(entry.ticks);
        }
        expect(await hook(o.page, 'ended')).toMatchObject({ done: true, next: null });
      }

      // The captain taken: the sabotage played and given up, the siege ends with the quit run's code.
      {
        const o = await carded(browser, server.url, errors);
        const { page, frames, context } = o;
        await press(o, 'play');
        await page.keyboard.down('Backspace');
        await frames(1);
        await page.keyboard.up('Backspace');
        expect(await hook(page, 'playing')).toBe(false);
        expect(await toEntryEnd(o)).toBe(260);
        expect(await hook(page, 'outcomes')).toEqual(['driven-off']);
        const ended = await hook(page, 'ended');
        expect(ended?.code).toBe(pinnedCode('quit'));
        expect(ended?.people).toContain('Captain Hale: captured, 90/120 hp');
        expect(await hook(page, 'texts')).toEqual(
          expect.arrayContaining([
            '  Driven off, the captain wounded and taken (quit)',
            '  Captain Hale: captured by raiders',
            '  Hall: 288 hp lost (112/400)',
            ended!.code!,
          ]),
        );
        await shoot(page, 'results-captured');
        code = ended!.code!;

        // Another page in the same browser offers the stored campaign on the briefing: Carry on.
        {
          const later = await opened(browser, server.url, errors, { context });
          expect(await hook(later.page, 'screen')).toBe('briefing');
          await press(later, 'stored');
          await later.frames(2);
          expect(await hook(later.page, 'scenario')).toBe('dawn');
          expect(await hook(later.page, 'captive')).toBe('Captain Hale');
          await later.page.close();
        }

        await toNext(o, 'dawn');
        expect((await hook(page, 'named'))['captain']).toMatchObject({ alive: true, fate: 'captured' });
        expect(await hook(page, 'captive')).toBe('Captain Hale');
        // The three captive choices, listed in the picture.
        expect(await hook(page, 'screen')).toBe('card');
        for (const m of ['exchange-captain', 'leave-captain', 'rescue-captain'])
          expect(await hook(page, 'itemBox', `launch:${m}`), m).not.toBeNull();
        await toTick(o, 5);
        await press(o, 'launch:exchange-captain');
        expect(await hook(page, 'choice')).toBe('exchange-captain');
        // A choice is only decided: Play is there but disabled; Delegate decides.
        await press(o, 'delegate');
        expect(await toCommit(o)).toBe(15);
        expect(await hook(page, 'outcomes')).toEqual(['paid']);
        expect((await hook(page, 'named'))['captain']).toMatchObject({ fate: 'freed' });
        expect(await hook(page, 'captive')).toBe('');
        await press(o, 'continue');
        expect(await toEntryEnd(o)).toBe(200);
        expect(await hook(page, 'screen')).toBe('results');
        await shoot(page, 'dawn-results-captured');
      }

      // The captured siege's save code round trip in 3D (gap M42): the code its results showed, in
      // the link of a fresh page in a new browser context (no stored save), resumes the dawn with
      // the captain held, at tick 0 with its briefing; a bad code leaves the siege's.
      {
        const fresh = await browser.newContext({
          viewport: { width: 640, height: 520 },
          deviceScaleFactor: 1,
        });
        const o = await opened(browser, server.url, errors, {
          context: fresh,
          query: `${QUERY_3D}&code=${encodeURIComponent(code!.toLowerCase())}`,
        });
        await o.frames(1);
        expect(await hook(o.page, 'scenario')).toBe('dawn');
        expect(await hook(o.page, 'captive')).toBe('Captain Hale');
        expect(await hook(o.page, 'tick')).toBe(0);
        await begin(o);
        expect(await hook(o.page, 'screen')).toBe('card');
        expect(await hook(o.page, 'itemBox', 'launch:exchange-captain')).not.toBeNull();
        const bad = await opened(browser, server.url, errors, {
          context: fresh,
          query: `${QUERY_3D}&code=NOT-A-USABLE-CODE`,
        });
        await bad.frames(1);
        expect(await hook(bad.page, 'scenario')).toBe('village');
        expect(await hook(bad.page, 'screen')).toBe('briefing');
        await fresh.close();
      }

      // A save code typed on a fresh 2D page (the DOM bar's code box): a bad one refused with its
      // reason, the quit's resumed.
      {
        const { page, frames } = await opened(browser, server.url, errors, {
          query: QUERY_2D,
          backend: 'canvas2d',
        });
        expect(await hook(page, 'ui')).toBe('bar');
        expect(await page.locator('#stored').isVisible()).toBe(false);
        await page.fill('#code', 'NOT-A-USABLE-CODE');
        await page.click('#resume');
        await frames(1);
        expect(await page.locator('#status').textContent()).toContain('code_typo');
        expect(await hook(page, 'scenario')).toBe('village');
        await page.fill('#code', pinnedCode('quit').toLowerCase());
        await page.press('#code', 'Enter');
        await frames(1);
        expect(await page.locator('#status').textContent()).not.toContain('code_');
        expect(await hook(page, 'scenario')).toBe('dawn');
        expect(await hook(page, 'tick')).toBe(0);
        expect(await hook(page, 'captive')).toBe('Captain Hale');
        // The resumed entry is held at tick 0 too (gap M34): the choices wait for Begin.
        expect(await hook(page, 'held')).toBe(true);
        await page.click('#begin');
        await frames(STEPS_PER_TICK);
        expect(await page.locator('#launches button').count()).toBe(3);
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 900_000);
});
