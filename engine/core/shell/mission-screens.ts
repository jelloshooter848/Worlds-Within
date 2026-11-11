import { Actions, type Action } from '../input/actions';
import { frameTaps, type FrameTap, type InputFrame } from '../input/input-manager';
import type { PointerGesture } from '../input/pointer-logic';
import type { Renderer } from '../gfx/renderer';
import type { MissionDef, MissionRecord } from '../missions';
import type { Scene } from '../scene';
import {
  DEFAULT_UI_KEYS,
  inBox,
  layoutText,
  Menu,
  menuHint,
  menusUiStyle,
  paintUi,
  uiLook,
  UI_COMMANDS,
  UiNav,
  UiScreen,
  type Box,
  type FontLookup,
  type UiCommand,
  type MenusSpec,
  type UiDraw,
  type UiEvent,
  type UiFrameSize,
  type UiKeys,
  type UiMenuItemSpec,
  type UiPainter,
  type UiPoint,
  type UiScreenFile,
  type UiWidgetSpec,
} from '../ui';
import {
  changeSections,
  missionChips,
  NO_CARD_FACTS,
  noChanges,
  windowText,
  type MissionCardFacts,
  type WorldChanges,
} from '../world-changes';
import type { LaunchGame, MissionLaunch } from './mission-launch';
import type { HeadlessGame } from '../headless';

/**
 * The mission flow in the picture (Engine 0.16 F5): the shell's `MissionLaunch` shown with the UI
 * kit, styled by `game.json`'s `menus` (its `style`, `font` and `titleFont`), instead of (or beside)
 * the DOM bar of `mission-bar.ts`. Pure (on `PURE_CORE`): screens are `ui` files built here and run
 * as `UiScreen`s; input is the frame's actions (keyboard and gamepad through the player's
 * bindings, `UiNav`), its taps (mouse clicks and touch taps, in picture pixels) and the hovering
 * mouse. Every button presses through `launch.press`, so the flow, the sim and every hash are the
 * launch's own: showing a screen holds nothing the launch does not already hold. What it shows:
 *
 * - **the briefing** (`briefing`) while the campaign entry is held at tick 0: the entry's title and
 *   text, **Begin** (and **Carry on** when the browser kept a save);
 * - **the mission card** (`card`, bottom right, over the running world: it never pauses it) while
 *   a mission is offered or open: `MISSION AVAILABLE` (or `MISSION OPEN` once the choice waits),
 *   the title, the mission's `text`, chips for the world time it costs (in hours on the clock,
 *   `durationText`), the hero and the foes (`facts`, from the mission's params and the world), a
 *   badge with the window's ticks left, and **Play** / **Delegate** (Play disabled for a mission
 *   without a round). Several offers at once (the dawn's captive choices) list each mission to
 *   choose; choosing opens it and the card then offers Play or Delegate for it;
 * - **the mission result** (`outcome`, where the card stands) once a mission commits: its outcome
 *   title and how it was resolved, and the world's changes since it opened; **Continue** closes it;
 * - **the results** (`results`) once the entry has ended: the entry's title and verdict, the
 *   world's changes since the entry began (missions, losses by faction, captives and fates,
 *   buildings), the save code and **Continue**.
 *
 * The changes and the card's facts are the sim's (`engine/sim`'s `worldChanges` and
 * `missionCardFacts`), handed in as options by the page, which only passes them through.
 */

/** Which screen shows. */
export type MissionScreenKind = 'briefing' | 'card' | 'outcome' | 'results';

/** Every word the screens show besides the game's own text. */
export interface MissionScreenWords {
  begin: string;
  stored: string;
  play: string;
  delegate: string;
  continue: string;
  available: string;
  open: string;
  choose: string;
  chooseTitle: string;
  result: string;
  code: string;
}

export const MISSION_SCREEN_WORDS: Readonly<MissionScreenWords> = Object.freeze({
  begin: 'Begin',
  stored: 'Carry on',
  play: 'Play',
  delegate: 'Delegate',
  continue: 'Continue',
  available: 'MISSION AVAILABLE',
  open: 'MISSION OPEN',
  choose: 'MISSIONS AVAILABLE',
  chooseTitle: 'Choose one',
  result: 'MISSION RESULT',
  code: 'Save code',
});

/** Px between the card and the picture's edge. */
export const CARD_MARGIN = 4;
/** The card's widest (it is narrower on a small picture). */
export const CARD_WIDTH = 176;
/** The id of the card's (or a screen's) box: the panel `covers` tests. */
export const CARD_PANEL = 'card';

/** What building the screens needs besides the words. */
export interface MissionScreenContext {
  menus: MenusSpec;
  screen: { width: number; height: number };
  fonts: FontLookup;
  /** The player's key names by action, for the hint lines (none: no hint). */
  keys?: Partial<Record<Action, string>>;
  words?: Partial<MissionScreenWords>;
  /**
   * The corner cards' look (Engine 0.16 F7): their widest (default `CARD_WIDTH`) and the font of
   * their text, chips, buttons and window badge (default the menus' `font`), so a page with a
   * small HUD font keeps the card small.
   */
  card?: MissionCardLook;
}

/** How the corner cards (the mission card, the choice list, the mission result) look. */
export interface MissionCardLook {
  width?: number;
  font?: string;
}

/** The context a corner card is built in: the menus' font swapped for the card's own. */
function cardContext(ctx: MissionScreenContext): MissionScreenContext {
  const font = ctx.card?.font;
  return font === undefined ? ctx : { ...ctx, menus: { ...ctx.menus, font } };
}

/** The card for one mission. */
export interface MissionCardView {
  def: MissionDef;
  /** True once the mission is open (the choice waits). */
  open: boolean;
  canPlay: boolean;
  facts: MissionCardFacts;
  ticksPerHour: number;
}

/** The colours and fonts a screen uses, from `menus`. */
function paletteOf(menus: MenusSpec) {
  const s = menus.style ?? {};
  return {
    text: s.text ?? '#fcfcfc',
    heading: s.heading ?? s.focusText ?? '#f8b800',
    outline: s.outline ?? '#000000',
    dim: s.disabledText ?? '#a4a4a4',
    chip: s.track ?? '#3c3c3c',
    badge: s.fill ?? '#d82800',
    dimColor: s.dimColor ?? '#000000',
    dimAlpha: s.dim ?? 0.55,
    padding: s.padding ?? 6,
  };
}

const wordsOf = (ctx: MissionScreenContext): MissionScreenWords => ({
  ...MISSION_SCREEN_WORDS,
  ...ctx.words,
});

/** A text's height in a font wrapped to `width` (0 for an unknown font or empty text). */
function heightOf(fonts: FontLookup, font: string, text: string, width: number): number {
  const f = fonts(font);
  if (f === null || text === '') return 0;
  return layoutText(f, text, { width }).height;
}

/** The title font when the text fits it on one line in `width`, else the menu font. */
function headingFont(ctx: MissionScreenContext, text: string, width: number): string {
  const title = ctx.menus.titleFont;
  if (title === undefined) return ctx.menus.font;
  const f = ctx.fonts(title);
  return f !== null && layoutText(f, text).width <= width ? title : ctx.menus.font;
}

/** A menu's size as the screen will place it (no panel). */
function menuSize(ctx: MissionScreenContext, items: UiMenuItemSpec[], direction: 'vertical' | 'horizontal') {
  const look = uiLook(menusUiStyle(ctx.menus), ctx.fonts, () => null);
  return new Menu({ id: 'main', items, direction, panel: false }, look).size();
}

/** Stacks text and chips down a box from `y`, `x` to `x + w`. */
class Column {
  readonly widgets: UiWidgetSpec[] = [];
  constructor(
    private readonly ctx: MissionScreenContext,
    readonly x: number,
    public y: number,
    readonly w: number,
  ) {}

  text(
    text: string,
    opts: { color?: string; font?: string; outline?: boolean; align?: 'center' } = {},
  ): void {
    if (text === '') return;
    const font = opts.font ?? this.ctx.menus.font;
    const p = paletteOf(this.ctx.menus);
    this.widgets.push({
      type: 'text',
      x: this.x,
      y: this.y,
      w: this.w,
      text,
      ...(opts.font !== undefined && { font: opts.font }),
      ...(opts.color !== undefined && { color: opts.color }),
      ...(opts.outline === true && { outline: p.outline, shadow: p.outline }),
      ...(opts.align !== undefined && { align: opts.align }),
    });
    this.y += heightOf(this.ctx.fonts, font, text, this.w);
  }

  chip(text: string): void {
    const p = paletteOf(this.ctx.menus);
    const h = heightOf(this.ctx.fonts, this.ctx.menus.font, text, this.w - 6) + 3;
    this.widgets.push({ type: 'panel', x: this.x, y: this.y, w: this.w, h, color: p.chip, alpha: 0.9 });
    this.widgets.push({ type: 'text', x: this.x + 3, y: this.y + 2, w: this.w - 6, text });
    this.y += h + 2;
  }

  gap(px: number): void {
    this.y += px;
  }
}

/** Widgets placed from (0, 0) moved by (dx, dy). */
function moved(widgets: UiWidgetSpec[], dx: number, dy: number): UiWidgetSpec[] {
  return widgets.map((w) => ({ ...w, x: (w.x ?? 0) + dx, y: (w.y ?? 0) + dy }));
}

/** A card in the picture's bottom-right corner: a panel with `fill`'s widgets and a menu under them. */
function cornerCard(
  outer: MissionScreenContext,
  fill: (col: Column) => void,
  items: UiMenuItemSpec[],
  direction: 'vertical' | 'horizontal',
): UiScreenFile {
  const ctx = cardContext(outer);
  const p = paletteOf(ctx.menus);
  const w = Math.min(ctx.screen.width - 2 * CARD_MARGIN, ctx.card?.width ?? CARD_WIDTH);
  const pad = p.padding;
  const col = new Column(ctx, pad, pad, w - 2 * pad);
  fill(col);
  col.gap(3);
  const menu = menuSize(ctx, items, direction);
  const h = Math.min(ctx.screen.height - 2 * CARD_MARGIN, col.y + menu.h + pad);
  const x = ctx.screen.width - w - CARD_MARGIN;
  const y = ctx.screen.height - h - CARD_MARGIN;
  const widgets: UiWidgetSpec[] = [
    { id: CARD_PANEL, type: 'panel', x, y, w, h },
    ...moved(col.widgets, x, y),
    {
      id: 'main',
      type: 'menu',
      x: x + pad,
      y: y + col.y,
      w: direction === 'horizontal' ? w - 2 * pad : Math.max(menu.w, w - 2 * pad),
      direction,
      panel: false,
      items,
    },
  ];
  return { style: menusUiStyle(ctx.menus), focus: 'main', widgets };
}

/** The mission card (or, with several offers, the list to choose one from). */
export function missionCardScreen(ctx: MissionScreenContext, card: MissionCardView): UiScreenFile {
  const words = wordsOf(ctx);
  const p = paletteOf(ctx.menus);
  const items: UiMenuItemSpec[] = [
    { id: 'play', label: words.play, ...(!card.canPlay && { disabled: true }) },
    { id: 'delegate', label: words.delegate },
  ];
  return cornerCard(
    ctx,
    (col) => {
      col.text(card.open ? words.open : words.available, { color: p.heading });
      col.gap(1);
      col.text(card.def.title, { outline: true });
      col.gap(2);
      col.text(card.def.text ?? '', { color: p.dim });
      col.gap(3);
      for (const chip of missionChips(card.def, card.facts, card.ticksPerHour)) col.chip(chip);
    },
    items,
    'horizontal',
  );
}

/** The list of missions offered at once (the dawn's captive choices): choosing one opens it. */
export function missionChoiceScreen(ctx: MissionScreenContext, defs: readonly MissionDef[]): UiScreenFile {
  const words = wordsOf(ctx);
  const p = paletteOf(ctx.menus);
  return cornerCard(
    ctx,
    (col) => {
      col.text(words.choose, { color: p.heading });
      col.gap(1);
      col.text(words.chooseTitle, { outline: true });
    },
    defs.map((d) => ({ id: `launch:${d.id}`, label: d.title })),
    'vertical',
  );
}

/** The window badge over the card's top-right corner (`Window closes in 136 ticks`); null without a window. */
export function windowBadgeScreen(outer: MissionScreenContext, text: string, card: Box): UiScreenFile | null {
  const ctx = cardContext(outer);
  const font = ctx.fonts(ctx.menus.font);
  if (text === '' || font === null) return null;
  const p = paletteOf(ctx.menus);
  const tw = layoutText(font, text).width;
  const w = tw + 6;
  const h = font.cell.h + 3;
  const x = Math.max(0, card.x + card.w - w - 4);
  const y = Math.max(0, card.y - h + 2);
  return {
    style: menusUiStyle(ctx.menus),
    widgets: [
      { id: 'badge', type: 'panel', x, y, w, h, color: p.badge, alpha: 1 },
      { type: 'text', x: x + 3, y: y + 2, text, color: p.text },
    ],
  };
}

/** The outcome of the missions committed since the last result shown, and the changes since the first opened. */
export function outcomeScreen(
  ctx: MissionScreenContext,
  record: MissionRecord,
  title: string,
  changes: WorldChanges,
  lines = 6,
): UiScreenFile {
  const words = wordsOf(ctx);
  const p = paletteOf(ctx.menus);
  const rows = changeSections(changes)
    .filter((s) => s.heading !== 'Missions')
    .flatMap((s) => s.lines);
  const shown =
    rows.length > lines ? [...rows.slice(0, lines - 1), `and ${rows.length - lines + 1} more`] : rows;
  return cornerCard(
    ctx,
    (col) => {
      col.text(words.result, { color: p.heading });
      col.gap(1);
      col.text(title, { outline: true });
      col.text(`(${record.resolution})`, { color: p.dim });
      col.gap(3);
      for (const row of shown) col.text(row);
    },
    [{ id: 'continue', label: words.continue }],
    'horizontal',
  );
}

/** A centred screen's panel width at most. */
const CENTRED_WIDTH = 232;
/** The results panel's width at most on a wide picture (Engine 0.16 F6: a 16:9 picture has room for two columns). */
const WIDE_RESULTS_WIDTH = 304;
/** A picture at least this wide shows the results' changes in two columns. */
const TWO_COLUMNS_FROM = 300;

/** A modal screen: the picture dimmed, a centred panel with a heading, a body and a menu, and a key hint. */
function centredScreen(
  ctx: MissionScreenContext,
  heading: string,
  body: (col: Column, room: number) => void,
  items: UiMenuItemSpec[],
  maxWidth = CENTRED_WIDTH,
): UiScreenFile {
  const p = paletteOf(ctx.menus);
  const { width, height } = ctx.screen;
  const w = Math.min(width - 8, maxWidth);
  const pad = p.padding + 2;
  const hint = ctx.keys === undefined ? '' : menuHint(ctx.keys, false, false);
  const hintH = hint === '' ? 0 : (ctx.fonts(ctx.menus.font)?.cell.h ?? 8) + 10;
  const menu = menuSize(ctx, items, 'vertical');
  const head = new Column(ctx, pad, pad, w - 2 * pad);
  head.text(heading, {
    font: headingFont(ctx, heading, w - 2 * pad),
    color: p.heading,
    outline: true,
    align: 'center',
  });
  head.gap(5);
  const room = height - 8 - hintH - head.y - menu.h - 6 - pad;
  body(head, head.y + room);
  head.gap(6);
  const h = head.y + menu.h + pad;
  const x = Math.floor((width - w) / 2);
  const y = Math.max(4, Math.floor((height - hintH - h) / 2));
  const widgets: UiWidgetSpec[] = [
    ...(p.dimAlpha > 0
      ? [
          {
            type: 'panel',
            anchor: 'center',
            w: width,
            h: height,
            color: p.dimColor,
            alpha: p.dimAlpha,
          } as UiWidgetSpec,
        ]
      : []),
    { id: CARD_PANEL, type: 'panel', x, y, w, h },
    ...moved(head.widgets, x, y),
    { id: 'main', type: 'menu', anchor: 'top', y: y + head.y, w: Math.max(menu.w, 96), panel: false, items },
  ];
  if (hint !== '')
    widgets.push(
      { type: 'panel', anchor: 'bottom', w: width, h: hintH, color: p.dimColor, alpha: 0.6 },
      { type: 'text', anchor: 'bottom', y: 6, text: hint, color: p.dim },
    );
  return { style: menusUiStyle(ctx.menus), focus: 'main', widgets };
}

/** The entry's briefing: its title and text, Begin (and Carry on with a kept save). */
export function briefingScreen(
  ctx: MissionScreenContext,
  briefing: { title: string; text: string },
  opts: { stored?: boolean } = {},
): UiScreenFile {
  const words = wordsOf(ctx);
  const items: UiMenuItemSpec[] = [
    { id: 'begin', label: words.begin },
    ...(opts.stored === true ? [{ id: 'stored', label: words.stored }] : []),
  ];
  return centredScreen(ctx, briefing.title, (col) => col.text(briefing.text), items);
}

/** What the results screen shows: the entry, how it stands, the world's changes and the save code. */
export interface ResultsView {
  title: string;
  verdict: string;
  changes: WorldChanges;
  /** The outcome title of a record. */
  outcomeTitle(mission: string, outcome: string): string;
  code: string;
}

/**
 * The entry's results: its title and verdict, then each section of the changes (missions, losses,
 * people, buildings) as far as the picture has room (the rest counted, `and 3 more`), the save
 * code and Continue. On a picture at least {@link TWO_COLUMNS_FROM} px wide (Engine 0.16 F6, the
 * 16:9 pictures) the panel is wider: the first section spans it, the others flow down a left
 * column, then a right one, a heading never ending a column (Engine 0.16 F9).
 */
export function resultsScreen(ctx: MissionScreenContext, view: ResultsView): UiScreenFile {
  const words = wordsOf(ctx);
  const p = paletteOf(ctx.menus);
  const sections = changeSections(view.changes, { title: view.outcomeTitle });
  return centredScreen(
    ctx,
    view.title,
    (col, bottom) => {
      const two = ctx.screen.width >= TWO_COLUMNS_FROM;
      col.text(view.verdict, { color: p.dim, align: 'center' });
      col.gap(two ? 2 : 4);
      // On a wide picture the save code shares its label's row when it fits (Engine 0.16 F9).
      const face = ctx.fonts(ctx.menus.font);
      const labelW = face === null ? 0 : layoutText(face, words.code).width + (face.cell.w ?? 4);
      const codeRow =
        two && face !== null && view.code !== '' && labelW + layoutText(face, view.code).width <= col.w;
      const codeGap = two ? 2 : 4;
      const codeH =
        view.code === ''
          ? 0
          : codeRow
            ? heightOf(ctx.fonts, ctx.menus.font, view.code, col.w) + codeGap
            : heightOf(ctx.fonts, ctx.menus.font, words.code, col.w) +
              heightOf(ctx.fonts, ctx.menus.font, view.code, col.w) +
              codeGap;
      const limit = bottom - codeH;
      const rows = sections.flatMap((s, section) => [
        { text: s.heading, heading: true, section },
        ...s.lines.map((text) => ({ text: `  ${text}`, heading: false, section })),
      ]);
      const font = ctx.menus.font;
      const lineH = (ctx.fonts(font)?.line ?? 10) + 0;
      const half = Math.floor((col.w - 8) / 2);
      const halves = () => [
        new Column(ctx, col.x, col.y, half),
        new Column(ctx, col.x + half + 8, col.y, half),
      ];
      // On a wide picture the first section (the missions' records, the longest lines) spans the
      // panel and the rest flow down a left column, then a right one (Engine 0.16 F9, gap M39: a
      // record wrapped over three lines of a half column left no room for the people).
      let spanning = two && sections.length > 1;
      let columns = two && !spanning ? halves() : [col];
      let at = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        if (spanning && row.section > 0) {
          spanning = false;
          columns = halves();
          at = 0;
        }
        const c = columns[at]!;
        const h = heightOf(ctx.fonts, font, row.text, c.w);
        // A heading stays with its first line: it never ends a column (gap M39).
        const next = rows[i + 1];
        const keep =
          row.heading && next !== undefined && !next.heading ? heightOf(ctx.fonts, font, next.text, c.w) : 0;
        const left = rows.length - i;
        const last = at === columns.length - 1;
        if (c.y + h + Math.max(keep, left > 1 && last ? lineH : 0) > limit && left > 1) {
          if (!last) {
            // The column is full: this row starts the next one.
            at++;
            i--;
            continue;
          }
          c.text(`and ${rows.slice(i).filter((r) => !r.heading).length} more`, { color: p.dim });
          break;
        }
        c.text(row.text, row.heading ? { color: p.heading } : {});
      }
      if (columns.length > 1) {
        for (const c of columns) col.widgets.push(...c.widgets);
        col.y = Math.max(...columns.map((c) => c.y));
      }
      if (view.code !== '') {
        col.gap(codeGap);
        if (codeRow) {
          const row = new Column(ctx, col.x + labelW, col.y, col.w - labelW);
          col.widgets.push({ type: 'text', x: col.x, y: col.y, text: words.code, color: p.heading });
          row.text(view.code, { color: p.dim });
          col.widgets.push(...row.widgets);
          col.y = row.y;
        } else {
          col.text(words.code, { color: p.heading });
          col.text(view.code, { color: p.dim });
        }
      }
    },
    [{ id: 'continue', label: words.continue }],
    ctx.screen.width >= TWO_COLUMNS_FROM ? WIDE_RESULTS_WIDTH : CENTRED_WIDTH,
  );
}

/** What the screens read of the page's game and world, beside the launch. */
export interface MissionScreensOptions<G extends LaunchGame> {
  launch: MissionLaunch<G>;
  /** `game.json`'s `menus`: the style, `font` and `titleFont` the screens use. */
  menus: MenusSpec;
  screen: { width: number; height: number };
  fonts: FontLookup;
  frameSize?: UiFrameSize;
  /** The player's key names by action (the briefing's and results' hint), or none. */
  keys?(): Partial<Record<Action, string>>;
  /** The card's facts of a mission now (`engine/sim`'s `missionCardFacts`); none: no hero, foes or window. */
  facts?(game: G, def: MissionDef): MissionCardFacts;
  /** The world's changes since a tick (`engine/sim`'s `worldChanges`); none: only the records. */
  changes?(game: G, sinceTick: number): WorldChanges;
  /** World ticks per hour (the campaign's `ticksPerHour`, Engine 0.16 F4; default 60). */
  ticksPerHour?: number;
  /** The actions per command (default `DEFAULT_UI_KEYS`). */
  uiKeys?: UiKeys;
  /** The hovering mouse (the boot's `page.pointer`), or null. */
  pointer?: { cursor(): UiPoint | null } | null;
  onSound?(id: string): void;
  words?: Partial<MissionScreenWords>;
  /** The corner cards' width and font (Engine 0.16 F7; default `CARD_WIDTH` and the menus' font). */
  card?: MissionCardLook;
}

/** One built screen and what it was built from (to rebuild only when that changes). */
interface Built {
  kind: MissionScreenKind;
  key: string;
  ui: UiScreen;
}

export class MissionScreens<G extends LaunchGame> {
  private readonly nav: UiNav;
  private built: Built | null = null;
  private badge: { key: string; ui: UiScreen } | null = null;
  /** The game the records were counted in, and how many of its records were shown. */
  private seenGame: G | null = null;
  private seen = 0;
  /** What the screen covered when the last `update` took its step's taps (null before any). */
  private stepCover: ((p: UiPoint) => boolean) | null = null;
  /** The actions the last `update` took as its screen's commands (hidden from the scene below). */
  private stepKeys: ReadonlySet<Action> = new Set();
  /** The events of the last update (for tests and page hooks). */
  last: UiEvent[] = [];

  constructor(private readonly opts: MissionScreensOptions<G>) {
    this.nav = new UiNav(opts.uiKeys);
  }

  /**
   * Whether the last `update` took action `a` as its screen's command, so the scene below must not
   * see it pressed (Engine 0.16 F review): a key or pad press that takes Play, Begin or Continue
   * starts the round, and its first step must not read that same press as its own (`jump` places a
   * tower, `start` starts a wave). The full screens (briefing, results) take every UI key they
   * read; the cards take only the confirm and back keys, and only on a step they took an item.
   */
  took(a: Action): boolean {
    return this.stepKeys.has(a);
  }

  private get launch(): MissionLaunch<G> {
    return this.opts.launch;
  }

  private context(): MissionScreenContext {
    const keys = this.opts.keys?.();
    return {
      menus: this.opts.menus,
      screen: this.opts.screen,
      fonts: this.opts.fonts,
      ...(keys !== undefined && { keys }),
      ...(this.opts.words !== undefined && { words: this.opts.words }),
      ...(this.opts.card !== undefined && { card: this.opts.card }),
    };
  }

  private records(): readonly MissionRecord[] {
    const game = this.launch.game;
    if (game !== this.seenGame) {
      this.seenGame = game;
      this.seen = game.records().length;
    }
    return game.records();
  }

  /** The world's changes since `tick` (the records alone when the page gives no `changes`). */
  changes(sinceTick: number): WorldChanges {
    const game = this.launch.game;
    if (this.opts.changes !== undefined) return this.opts.changes(game, sinceTick);
    return {
      ...noChanges(sinceTick, this.launch.tick),
      records: game.records().filter((r) => r.commitTick >= sinceTick),
    };
  }

  /** The card's facts of mission `def` now. */
  facts(def: MissionDef): MissionCardFacts {
    return this.opts.facts?.(this.launch.game, def) ?? NO_CARD_FACTS;
  }

  /** The missions offered or open now, as the card shows them (empty while no card shows). */
  cardMissions(): string[] {
    if (this.kind() !== 'card') return [];
    const open = this.launch.choice();
    return open !== null ? [open] : this.launch.launchButtons();
  }

  /** The screen that shows now, or null (a round is played, or nothing to show). */
  kind(): MissionScreenKind | null {
    const launch = this.launch;
    if (launch.playing()) return null;
    if (launch.ended() !== null) return 'results';
    if (launch.held()) return 'briefing';
    if (this.records().length > this.seen) return 'outcome';
    if (launch.choice() !== null || launch.launchButtons().some((m) => launch.missionDef(m) !== null))
      return 'card';
    return null;
  }

  /** The screen's file now, or null. */
  private file(kind: MissionScreenKind): UiScreenFile | null {
    const launch = this.launch;
    const ctx = this.context();
    switch (kind) {
      case 'briefing': {
        const briefing = launch.briefing();
        if (briefing === null) return null;
        return briefingScreen(ctx, briefing, { stored: launch.storedSave() !== null });
      }
      case 'results': {
        const ended = launch.ended()!;
        return resultsScreen(ctx, {
          title: ended.title === '' ? ended.entry : ended.title,
          verdict: ended.verdict,
          changes: this.changes(0),
          outcomeTitle: (m, o) => launch.outcomeTitle(m, o),
          code: ended.code ?? '',
        });
      }
      case 'outcome': {
        const fresh = this.records().slice(this.seen);
        const record = fresh.at(-1)!;
        const since = Math.min(...fresh.map((r) => r.openTick));
        return outcomeScreen(
          ctx,
          record,
          launch.outcomeTitle(record.mission, record.outcome),
          this.changes(since),
        );
      }
      case 'card': {
        const open = launch.choice();
        const offered = open !== null ? [open] : launch.launchButtons();
        const defs = offered.map((m) => launch.missionDef(m)).filter((d): d is MissionDef => d !== null);
        if (defs.length === 0) return null;
        if (defs.length > 1) return missionChoiceScreen(ctx, defs);
        const def = defs[0]!;
        return missionCardScreen(ctx, {
          def,
          open: open !== null,
          canPlay: launch.canPlay(def.id),
          facts: { ...this.facts(def), ticksLeft: null },
          ticksPerHour: this.opts.ticksPerHour ?? 60,
        });
      }
    }
  }

  /** The window badge's text now: the soonest window of the missions offered on the card ('' when none or once one is open). */
  windowLine(): string {
    if (this.kind() !== 'card' || this.launch.choice() !== null) return '';
    const left = this.launch
      .launchButtons()
      .map((m) => this.launch.missionDef(m))
      .filter((d): d is MissionDef => d !== null)
      .map((d) => this.facts(d).ticksLeft)
      .filter((t): t is number => t !== null);
    return left.length === 0 ? '' : windowText({ ...NO_CARD_FACTS, ticksLeft: Math.min(...left) });
  }

  private screenOf(file: UiScreenFile): UiScreen {
    return new UiScreen(file, {
      screen: this.opts.screen,
      fonts: this.opts.fonts,
      ...(this.opts.frameSize !== undefined && { frameSize: this.opts.frameSize }),
      ...(this.opts.onSound !== undefined && { onSound: this.opts.onSound }),
    });
  }

  /** Brings the screens up to date with the launch (cheap when nothing changed); the screen now, or null. */
  sync(): UiScreen | null {
    const kind = this.kind();
    const file = kind === null ? null : this.file(kind);
    if (kind === null || file === null) {
      this.built = null;
      this.badge = null;
      return null;
    }
    const key = JSON.stringify(file);
    if (this.built?.key !== key) {
      const before = this.built;
      const ui = this.screenOf(file);
      const focused = before?.kind === kind ? before.ui.menu('main')?.focused : null;
      if (focused !== null && focused !== undefined) ui.menu('main')?.focus(focused);
      this.built = { kind, key, ui };
    }
    const line = this.windowLine();
    const box = this.built.ui.box(CARD_PANEL);
    const badge = box === undefined ? null : windowBadgeScreen(this.context(), line, box);
    if (badge === null) this.badge = null;
    else {
      const badgeKey = JSON.stringify(badge);
      if (this.badge?.key !== badgeKey) this.badge = { key: badgeKey, ui: this.screenOf(badge) };
    }
    return this.built.ui;
  }

  /** The screen showing now (after the last `sync` or `update`), or null. */
  get ui(): UiScreen | null {
    return this.built?.ui ?? null;
  }

  /** Whether a picture point is on a screen's panel or the badge (a page leaves such taps to the screens). */
  covers(p: UiPoint): boolean {
    return this.cover()(p);
  }

  /** What the screen showing now covers (after a `sync`). */
  private cover(): (p: UiPoint) => boolean {
    const ui = this.sync();
    if (ui === null) return () => false;
    if (this.built?.kind === 'briefing' || this.built?.kind === 'results') return () => true;
    const box = ui.box(CARD_PANEL);
    const badge = this.badge?.ui.box('badge');
    return (p) => (box !== undefined && inBox(box, p)) || (badge !== undefined && inBox(badge, p));
  }

  /**
   * The page's pointer gestures without those on a screen (a tap, or a box dragged from one), so a
   * kit's pointer controls under the card never take the card's taps; every gesture while no
   * screen shows. After an `update` it is the screen that took that step's taps that covers them,
   * not the one its presses left (a tap on Continue, Delegate or Begin closes the screen before
   * the battle reads its gestures, and must not then reach the battle as an order).
   */
  uncovered(gestures: readonly PointerGesture[]): PointerGesture[] {
    const covers = this.stepCover ?? this.cover();
    return gestures.filter((g) => {
      if (g.type === 'tap') return !covers(g);
      if (g.type === 'box') return !covers({ x: g.x0, y: g.y0 });
      return true;
    });
  }

  /**
   * One loop step, before the launch's own (`missionScreensScene` calls it): the screen is brought
   * up to date and takes the frame's commands, taps and the hover; what it reports becomes the
   * launch's presses. Returns the screen's events.
   */
  update(input: InputFrame): UiEvent[] {
    const commands = this.nav.commands(input);
    this.stepCover = this.cover();
    this.stepKeys = new Set();
    const ui = this.ui;
    if (ui === null || this.built === null) {
      this.last = [];
      return this.last;
    }
    const taps = frameTaps(input).map((t) => ({ x: t.x, y: t.y }));
    const pointer = this.opts.pointer?.cursor() ?? null;
    const kind = this.built.kind;
    this.last = ui.update({ commands, taps, pointer });
    this.badge?.ui.update({ commands: [], taps: [], pointer: null });
    for (const e of this.last) if (e.type === 'activate' && e.item !== undefined) this.activate(kind, e.item);
    this.stepKeys = this.takenKeys(kind, input);
    return this.last;
  }

  /** The actions pressed this step that the screen `kind` took (see `took`). */
  private takenKeys(kind: MissionScreenKind, input: InputFrame): ReadonlySet<Action> {
    const keys = this.opts.uiKeys ?? DEFAULT_UI_KEYS;
    const full = kind === 'briefing' || kind === 'results';
    const tookItem = this.last.some((e) => e.type === 'activate' || e.type === 'back' || e.type === 'choice');
    const commands: readonly UiCommand[] = full ? UI_COMMANDS : tookItem ? ['confirm', 'back'] : [];
    return new Set(commands.flatMap((c) => keys[c]).filter((a) => input.pressed(a)));
  }

  /** Presses an item: what the launch does with it. */
  press(item: string): void {
    const kind = this.kind();
    if (kind !== null) this.activate(kind, item);
  }

  private activate(kind: MissionScreenKind, item: string): void {
    const launch = this.launch;
    if (item === 'begin' || item === 'stored') launch.press({ kind: item });
    else if (item === 'continue') {
      if (kind === 'results') launch.press({ kind: 'continue' });
      else if (kind === 'outcome') this.seen = this.records().length;
    } else if (item.startsWith('launch:'))
      launch.press({ kind: 'launch', mission: item.slice('launch:'.length) });
    else if (item === 'play' || item === 'delegate') {
      if (launch.choice() === null) {
        const [mission] = launch.launchButtons();
        if (mission === undefined) return;
        launch.press({ kind: 'launch', mission });
      }
      launch.press({ kind: item });
    }
  }

  /** The draw items of the screen and its badge (empty while none shows). */
  draws(): UiDraw[] {
    this.sync();
    return [...(this.built?.ui.draws() ?? []), ...(this.badge?.ui.draws() ?? [])];
  }
}

/**
 * The page's scene with the mission screens over it: each loop step the screens take the frame
 * first (their presses reach the launch in the same step), then the scene below steps; each draw
 * paints the screens over the scene's picture through the backend's `UiPainter`.
 */
export function missionScreensScene<G extends LaunchGame>(
  scene: Scene,
  screens: MissionScreens<G>,
  painter: (r: Renderer) => UiPainter,
): Scene & { headless(): HeadlessGame | null } {
  let painted: { r: Renderer; painter: UiPainter } | null = null;
  return {
    update(input, inputs) {
      // A tap on a screen is the screen's (Engine 0.16 F7): the scene under it never sees it, so a
      // round started by a tap on Play does not take (or record) that tap as its own input.
      const taps = frameTaps(input);
      const kept = taps.filter((t) => !screens.covers(t));
      screens.update(input);
      // So is a key or pad press the screen took (Engine 0.16 F review): Z or Enter on Play must
      // not also place a tower or start a wave on the round's first step.
      const took = (a: Action) => screens.took(a);
      const masked = kept.length !== taps.length || Actions.some(took);
      scene.update(masked ? withoutTaken(input, kept, took) : input, inputs);
    },
    render(r) {
      scene.render(r);
      if (painted?.r !== r) painted = { r, painter: painter(r) };
      paintUi(screens.draws(), painted.painter);
    },
    headless: () => scene.headless?.() ?? null,
  };
}

/**
 * An input frame the same as `input` but for its taps, and without the presses the screens took
 * (Engine 0.16 F7 and F review).
 */
function withoutTaken(
  input: InputFrame,
  taps: readonly FrameTap[],
  took: (a: Action) => boolean,
): InputFrame {
  return {
    held: (a) => input.held(a),
    pressed: (a) => !took(a) && input.pressed(a),
    released: (a) => input.released(a),
    bufferedJump: (n) => !took('jump') && input.bufferedJump(n),
    consumeJumpBuffer: () => input.consumeJumpBuffer(),
    get dirX() {
      return input.dirX;
    },
    taps: () => taps,
  };
}
