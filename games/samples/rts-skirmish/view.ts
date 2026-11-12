import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { HeadlessOptions, JsonObject } from '@engine/core/headless';
import { RtsCamera, type CameraHint } from '@engine/core/present';
import type { ViewGame } from '@engine/core/view';
import {
  barkEvent,
  orderMarker,
  RTS_TILE_SIZE,
  type OrderDraft,
  type RtsOrderFeedback,
  type RtsView,
} from '@kits/rts';
import { PLAYER, skirmishDecor, skirmishNames } from './content';
import { createGame } from './headless';
import { skirmishCanvasPicture, skirmishFrames, skirmishLook, type SkirmishPicture } from './picture';

/**
 * The view entry (named by `view` in `game.json`), for `pnpm cli screenshot` and the backend
 * parity test: the headless game plus `render` (the kit's frames through the Canvas2D backend and
 * the skin, `skirmishCanvasPicture`) and `frame()` (the same frames for any presenter). It takes
 * recorded orders like the headless game (`order`), so a screenshot of a battle shows the battle.
 * The picture is the player's, through fog of war (presentation only). No loop: the screenshot page
 * steps it.
 *
 * Engine 0.16 part D, D10 (for the review screenshots): the view shows the run's own interface
 * state, as the page would: the game's selection (`ui.selection`, set by a run's `ui` entries) is
 * drawn selected (rings, path dots, the selected-unit panel), and an interface command the game
 * accepts gives its order marker and bark, as the page's `RtsControls.feedback` does. The camera
 * is a director's (`directorCamera`): it frames the selected units, else all the player's units,
 * zoomed out as far as needed to fit them (down to the kit's 0.5). None of it reads or writes the
 * game, so every hash is the headless one (`matchesHeadless`).
 */
export function createView(
  content: ContentBundle,
  seed: number,
  opts: HeadlessOptions = {},
): ViewGame & { order(order: JsonObject): string | null } {
  const game = createGame(content, seed, opts);
  const look = skirmishLook(content);
  const feedback: RtsOrderFeedback[] = [];
  const frameOpts = {
    ui: () => {
      const view = game.view();
      const selection = game.player.selection.ids();
      const camera = directorCamera(view, look.screen, selection);
      return { selection, ...(camera && { camera }) };
    },
    feedback: () => feedback.splice(0),
    names: skirmishNames(content),
    decor: skirmishDecor(content),
  };
  const frames = skirmishFrames(look.screen, frameOpts);
  let picture: { r: Parameters<ViewGame['render']>[0]; p: SkirmishPicture } | null = null;
  return {
    step: (input) => game.step(input),
    snapshot: () => game.snapshot(),
    order(order) {
      const before = game.rts.recorded().length;
      const error = game.order(order);
      const recorded = game.rts.recorded();
      // An interface command the game took: the page's feedback for it (marker and bark).
      if (Object.hasOwn(order, 'ui') && error === null && recorded.length > before) {
        const draft = recorded[recorded.length - 1] as unknown as OrderDraft;
        const view = game.view();
        const bark = barkEvent(view, draft, PLAYER, RTS_TILE_SIZE);
        feedback.push({ marker: orderMarker(view, draft), events: bark === null ? [] : [bark] });
      }
      return error;
    },
    screen: look.screen,
    render(r) {
      if (picture?.r !== r) picture = { r, p: skirmishCanvasPicture(r, look, frameOpts) };
      picture.p.draw(game, []);
    },
    frame: () => frames.next(game, []),
  };
}

/** World px of margin round what the director's camera frames. */
const FRAME_MARGIN = 48;

/**
 * The view's camera (D10), a director's for screenshots: it frames the fight when there is one
 * (the player's units with a target and what they fight, and enemy units fighting something of
 * the player's and what they fight), else the selected units (a selected building does not count),
 * else every unit of the player's; the box round them with a margin, centred and zoomed out to fit
 * (zoom 1 at most, the kit's `RtsCamera` minimum, 0.5, at least), kept on the map. With nothing to
 * frame, the map's centre at zoom 1. Pure: the same view gives the same hint.
 */
export function directorCamera(
  view: RtsView,
  screen: ScreenSize,
  selection: readonly number[],
): CameraHint | undefined {
  if (view.terrain === null) return undefined;
  const ts = RTS_TILE_SIZE;
  const area = { x: 0, y: 0, w: view.terrain.width * ts, h: view.terrain.height * ts };
  const points = framedPoints(view, selection);
  if (points.length === 0) return new RtsCamera({ view: screen, area, maxZoom: 1 }).hint();
  const xs = points.map((p) => p.x * ts + ts / 2);
  const ys = points.map((p) => p.y * ts + ts / 2);
  const x0 = Math.min(...xs) - FRAME_MARGIN;
  const x1 = Math.max(...xs) + FRAME_MARGIN;
  const y0 = Math.min(...ys) - FRAME_MARGIN;
  const y1 = Math.max(...ys) + FRAME_MARGIN;
  const zoom = Math.min(1, screen.width / (x1 - x0), screen.height / (y1 - y0));
  const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  return new RtsCamera({ view: screen, area, zoom, maxZoom: 1, centre }).hint();
}

/** The cells the director frames (see `directorCamera`). */
function framedPoints(view: RtsView, selection: readonly number[]): { x: number; y: number }[] {
  const at = new Map<number, { x: number; y: number; faction: string | null }>();
  for (const u of view.units) at.set(u.id, u);
  for (const b of view.buildings)
    at.set(b.id, { x: b.x + (b.w - 1) / 2, y: b.y + (b.h - 1) / 2, faction: b.faction });
  const fight: { x: number; y: number }[] = [];
  for (const u of view.units) {
    if (u.target === null) continue;
    const target = at.get(u.target);
    if (target === undefined) continue;
    if (u.faction === PLAYER || target.faction === PLAYER) fight.push(u, target);
  }
  if (fight.length > 0) return fight;
  const own = view.units.filter((u) => u.faction === PLAYER);
  const picked = own.filter((u) => selection.includes(u.id));
  return picked.length > 0 ? picked : own;
}
