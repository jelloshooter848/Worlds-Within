import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { DebugWindow } from '@engine/core/shell';
import type { UiEvent, UiScreen } from '@engine/core/ui';
import { browserMissing, launch, serveBuilt } from './serve';

// The UI kit in the browser (Engine 0.16 T7): the fx lab's 2D page in manual-loop mode
// (`?debug=step`). The keyboard opens the lab's pause menu (Enter) and moves through it (arrows,
// a slider stepped to the right); the mouse hovers an item and clicks a toggle and "Talk", which
// opens Pip's dialog; Z skips its typing. Then a touch page (`hasTouch`) opens the dialog
// alone (`?ui=dialog`) and plays it to its choice with taps only. Taps and clicks are aimed with
// `window.__ww.toClient` at the item boxes the screen reports, so they go through the boot's
// pointer (client to picture pixels) like a player's. The menu and the dialog are shot to
// `WW_SHOTS_DIR` when set (to look at them), else a temp folder. Skipped where Chromium is not
// installed (never in CI).

const GAME = 'games/fx-lab/';

const missing = await browserMissing();
if (missing) console.warn(`skipping the fx lab UI test: ${missing}`);

const temp = mkdtempSync(join(tmpdir(), 'ww-fx-lab-ui-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const shots = process.env.WW_SHOTS_DIR ?? temp;

let built: Promise<{ url: string; close(): Promise<void> }> | null = null;
const serve = () => (built ??= serveBuilt('/', join(temp, 'dist')));
afterAll(async () => {
  if (built) await (await built).close();
});

interface LabWindow {
  wwFxLab: { ui: { open(which?: string): boolean; screen(): UiScreen | null; events: UiEvent[] } };
}

/** Steps the page n loop steps. */
const step = (page: Page, n = 1) => page.evaluate((n) => (window as DebugWindow).__ww!.step(n), n);

/** A key pressed and released, then two steps: the press, and a frame without it (so the next counts). */
async function key(page: Page, code: string): Promise<void> {
  await page.keyboard.press(code);
  await step(page, 2);
}

/** What the open screen says: focus, the menu's focus and values, the dialog's state. */
const read = (page: Page) =>
  page.evaluate(() => {
    const ui = (window as unknown as LabWindow).wwFxLab.ui.screen();
    if (ui === null) return null;
    const menu = ui.menu('main');
    const talk = ui.dialog('talk')!;
    return {
      focused: ui.focused,
      item: menu?.focused ?? null,
      volume: ui.value('main', 'volume'),
      shake: ui.value('main', 'shake'),
      talk: {
        visible: ui.visible('talk'),
        page: talk.page,
        shown: talk.shown,
        typed: talk.typed,
        choosing: talk.choosing,
      },
    };
  });

/** The client point at the centre of a widget's item (or of the widget), through `__ww.toClient`. */
const aim = (page: Page, widget: string, item?: string) =>
  page.evaluate(
    ({ widget, item }) => {
      const ui = (window as unknown as LabWindow).wwFxLab.ui.screen()!;
      const box = item === undefined ? ui.box(widget)! : ui.itemBox(widget, item)!;
      return (window as DebugWindow).__ww!.toClient(box.x + box.w / 2, box.y + box.h / 2)!;
    },
    { widget, item },
  );

async function openPage(page: Page, url: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(url);
  await page.waitForSelector('body[data-backend]', { timeout: 60_000 });
  return errors;
}

describe.skipIf(missing !== null)('the fx lab UI (headless Chromium)', () => {
  it('operates the menu and the dialog with the keyboard and the mouse', async () => {
    const server = await serve();
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 512, height: 480 }, deviceScaleFactor: 1 });
      const errors = await openPage(page, `${server.url}${GAME}?debug=step`);
      await step(page, 30);
      expect(await read(page)).toBeNull();

      // Enter pauses under the menu; the scene's fade plays over 12 frames.
      await key(page, 'Enter');
      await step(page, 20);
      expect(await read(page)).toMatchObject({ focused: 'main', item: 'resume', volume: 7, shake: true });
      await key(page, 'ArrowDown');
      await key(page, 'ArrowDown');
      expect((await read(page))!.item).toBe('volume');
      await key(page, 'ArrowRight');
      expect((await read(page))!.volume).toBe(8);
      // The game is paused under the menu: its tick does not move.
      const hash = await page.evaluate(() => (window as DebugWindow).__ww!.hash());
      await step(page, 10);
      expect(await page.evaluate(() => (window as DebugWindow).__ww!.hash())).toBe(hash);

      // The mouse: a click flips the toggle, then hovering "Talk" focuses it.
      const shake = await aim(page, 'main', 'shake');
      await page.mouse.click(shake.x, shake.y);
      await step(page);
      expect(await read(page)).toMatchObject({ item: 'shake', shake: false });
      const talk = await aim(page, 'main', 'talk');
      await page.mouse.move(talk.x, talk.y);
      await step(page, 12);
      expect((await read(page))!.item).toBe('talk');
      await page.locator('#screen').screenshot({ path: join(shots, 'fx-lab-ui-menu.png') });

      // A click on "Talk" opens the dialog, typed a character every 2 frames; Z skips the page.
      await page.mouse.click(talk.x, talk.y);
      await step(page, 9);
      const typing = (await read(page))!;
      expect(typing.focused).toBe('talk');
      expect(typing.talk.shown).toBe(4);
      await key(page, 'KeyZ');
      expect((await read(page))!.talk.typed).toBe(true);
      await key(page, 'KeyZ');
      expect((await read(page))!.talk).toMatchObject({ page: 1, typed: false });
      // The whole page (two wrapped lines, about 70 characters) after 160 frames.
      await step(page, 160);
      expect((await read(page))!.talk.typed).toBe(true);
      await page.locator('#screen').screenshot({ path: join(shots, 'fx-lab-ui-dialog.png') });

      const events = await page.evaluate(() =>
        (window as unknown as LabWindow).wwFxLab.ui.events.map((e) => e.type),
      );
      for (const type of ['focus', 'change', 'activate', 'open', 'type', 'skip', 'page'])
        expect(events).toContain(type);
      // The UI's sounds reached the page's sound output.
      const sounds = await page.evaluate(
        () => (window as unknown as { wwFxLab: { sounds: string[] } }).wwFxLab.sounds,
      );
      for (const id of ['ui-move', 'ui-select', 'ui-type']) expect(sounds).toContain(id);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 300_000);

  it('plays the dialog to its choice with touch taps', async () => {
    const server = await serve();
    const browser = await launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 480, height: 640 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const errors = await openPage(page, `${server.url}${GAME}?debug=step&ui=dialog`);
      await step(page, 20);
      expect(await read(page)).toMatchObject({ focused: 'talk', talk: { visible: true, page: 0 } });
      const tap = async (widget: string, item?: string) => {
        const p = await aim(page, widget, item);
        await page.touchscreen.tap(p.x, p.y);
        await step(page);
      };
      // Tap: skip; tap: next page; twice more to the last page, then once more to show it whole.
      await tap('talk');
      expect((await read(page))!.talk.typed).toBe(true);
      await tap('talk');
      expect((await read(page))!.talk.page).toBe(1);
      await tap('talk');
      await tap('talk');
      await tap('talk');
      expect((await read(page))!.talk).toMatchObject({ page: 2, choosing: true });
      await page.locator('#screen').screenshot({ path: join(shots, 'fx-lab-ui-choice.png') });
      // Tapping "Let's go!" takes it and closes the UI: the level plays on.
      await tap('talk', 'yes');
      const events = await page.evaluate(() => (window as unknown as LabWindow).wwFxLab.ui.events);
      expect(events).toContainEqual({ type: 'choice', widget: 'talk', item: 'yes' });
      expect(await read(page)).toBeNull();
      expect(errors).toEqual([]);
      await context.close();
    } finally {
      await browser.close();
    }
  }, 300_000);
});
