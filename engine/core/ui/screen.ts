import type { FontLookup } from './font';
import type { Box } from './nine-slice';
import type { UiDraw } from './paint';
import { layoutText, type TextAlign } from './text';
import { DialogBox } from './dialog';
import { lookPanel, uiLook, type UiFrameSize, type UiLook } from './look';
import { Button, Menu } from './menu';
import { textDraws } from './paint';
import { inBox, type UiEvent, type UiInput, type UiPoint } from './ui-input';
import { checkUiWidgets, type UiAnchor, type UiScreenFile, type UiWidgetSpec } from './ui-schema';

/**
 * A UI screen from its text (Engine 0.16 T7): the widgets of a `ui` file placed by their anchors
 * on a picture of the game's size, one of them focused. `update(input)` once per display frame
 * routes the frame's commands to the focused widget, the mouse's hover to the menu under it and
 * each tap to the topmost widget it lands on (focusing it), then follows the widgets' links:
 * an item or button that `opens` a widget shows and focuses it (`back` there closes it again and
 * gives the focus back), a dialog's choice `next` or a finished dialog's `next` focuses that
 * widget, and a dialog that ends without one closes. `draws()` gives the picture as `UiDraw`
 * items for a backend's `UiPainter`. Sounds: the style's `sounds` are played through `onSound`
 * for the events. All of it is presentation state, kept by the shell's scene, never in a kit, a
 * frame or a hash. Pure.
 */

export interface UiScreenOptions {
  /** The picture's size (`content.manifest.screen`). */
  screen: { width: number; height: number };
  fonts: FontLookup;
  /** Sprite frame sizes, for a nine-slice panel and portraits (null: draw without). */
  frameSize?: UiFrameSize;
  /** Called with an sfx id for each event the style gives a sound. */
  onSound?: (id: string) => void;
}

/** The default size of widgets that give no `w` / `h`. */
export const UI_PANEL_DEFAULT = { w: 64, h: 32 } as const;
/** A dialog's margin from the picture's sides when it gives no `w`. */
export const UI_DIALOG_MARGIN = 8;

type Live =
  | { kind: 'menu'; spec: UiWidgetSpec; widget: Menu }
  | { kind: 'dialog'; spec: UiWidgetSpec; widget: DialogBox }
  | { kind: 'still'; spec: UiWidgetSpec; box: Box };

/** Each anchor's horizontal and vertical side. */
const ANCHOR_SIDES: Readonly<
  Record<UiAnchor, readonly ['left' | 'center' | 'right', 'top' | 'center' | 'bottom']>
> = {
  'top-left': ['left', 'top'],
  top: ['center', 'top'],
  'top-right': ['right', 'top'],
  left: ['left', 'center'],
  center: ['center', 'center'],
  right: ['right', 'center'],
  'bottom-left': ['left', 'bottom'],
  bottom: ['center', 'bottom'],
  'bottom-right': ['right', 'bottom'],
};

/**
 * A widget's box from its anchor, its offsets and its size: at a side the offset is measured
 * inward from that side; centred, it moves right (or down) from the centre.
 */
export function anchorBox(
  anchor: UiAnchor,
  at: { x: number; y: number },
  size: { w: number; h: number },
  screen: { width: number; height: number },
): Box {
  const [horz, vert] = ANCHOR_SIDES[anchor];
  const x =
    horz === 'left'
      ? at.x
      : horz === 'right'
        ? screen.width - size.w - at.x
        : Math.floor((screen.width - size.w) / 2) + at.x;
  const y =
    vert === 'top'
      ? at.y
      : vert === 'bottom'
        ? screen.height - size.h - at.y
        : Math.floor((screen.height - size.h) / 2) + at.y;
  return { x, y, w: size.w, h: size.h };
}

export class UiScreen {
  readonly look: UiLook;
  private readonly live: Live[] = [];
  private readonly ids = new Map<string, Live>();
  private readonly shown = new Set<Live>();
  /** The widgets focused before each `opens`, to go back to. */
  private readonly stack: Live[] = [];
  private focusLive: Live | null = null;
  private clock = 0;

  constructor(
    readonly file: UiScreenFile,
    private readonly opts: UiScreenOptions,
  ) {
    const problems = checkUiWidgets(file);
    if (problems.length > 0)
      throw new Error(`ui: ${problems.map((p) => `${p.path.join('.')}: ${p.message}`).join('; ')}`);
    this.look = uiLook(file.style, opts.fonts, opts.frameSize ?? (() => null));
    file.widgets.forEach((spec, i) => {
      const id = spec.id ?? `#${i}`;
      const live = this.build(spec, id);
      this.live.push(live);
      this.ids.set(id, live);
      if (spec.hidden !== true) this.shown.add(live);
    });
    const first =
      file.focus !== undefined
        ? this.ids.get(file.focus)
        : this.live.find((l) => l.kind !== 'still' && this.shown.has(l));
    this.focusLive = first ?? null;
  }

  private build(spec: UiWidgetSpec, id: string): Live {
    const look = this.look;
    const screen = this.opts.screen;
    const at = { x: spec.x ?? 0, y: spec.y ?? 0 };
    const anchor = spec.anchor ?? 'top-left';
    const place = (size: { w: number; h: number }) =>
      anchorBox(anchor, at, { w: spec.w ?? size.w, h: spec.h ?? size.h }, screen);
    switch (spec.type) {
      case 'menu': {
        const menu = new Menu(
          {
            id,
            items: spec.items,
            ...(spec.direction !== undefined && { direction: spec.direction }),
            ...(spec.wrap !== undefined && { wrap: spec.wrap }),
            ...(spec.panel !== undefined && { panel: spec.panel }),
          },
          look,
        );
        menu.place(place(menu.size()));
        return { kind: 'menu', spec, widget: menu };
      }
      case 'button': {
        const button = new Button(id, spec.label, look, spec.disabled === true);
        button.place(place(button.size()));
        return { kind: 'menu', spec, widget: button };
      }
      case 'dialog': {
        const dialog = new DialogBox(
          {
            id,
            pages: spec.pages,
            ...(spec.speaker !== undefined && { speaker: spec.speaker }),
            ...(spec.portrait !== undefined && { portrait: spec.portrait }),
            ...(spec.rate !== undefined && { rate: spec.rate }),
            ...(spec.choices !== undefined && { choices: spec.choices }),
          },
          look,
        );
        const dflt = spec.anchor === undefined ? { ...at, y: spec.y ?? UI_DIALOG_MARGIN } : at;
        const size = {
          w: spec.w ?? screen.width - 2 * UI_DIALOG_MARGIN,
          h: spec.h ?? DialogBox.defaultHeight(look),
        };
        dialog.place(anchorBox(spec.anchor ?? 'bottom', dflt, size, screen));
        return { kind: 'dialog', spec, widget: dialog };
      }
      case 'text': {
        const font = (spec.font !== undefined ? this.opts.fonts(spec.font) : null) ?? look.font;
        const layout = layoutText(font, spec.text, spec.w !== undefined ? { width: spec.w } : {});
        return { kind: 'still', spec, box: place({ w: layout.width, h: layout.height }) };
      }
      case 'panel':
        return { kind: 'still', spec, box: place(UI_PANEL_DEFAULT) };
    }
  }

  /** The display frames stepped so far (the clock tweens and typing run on). */
  get frame(): number {
    return this.clock;
  }

  /** The focused widget's id, or null. */
  get focused(): string | null {
    return this.focusLive === null ? null : this.idOf(this.focusLive);
  }

  private idOf(live: Live): string {
    for (const [id, l] of this.ids) if (l === live) return id;
    return '';
  }

  /** Whether a widget shows. */
  visible(id: string): boolean {
    const live = this.ids.get(id);
    return live !== undefined && this.shown.has(live);
  }

  /** A widget's box (a dialog's or a menu's whole box), or undefined. */
  box(id: string): Box | undefined {
    const live = this.ids.get(id);
    if (live === undefined) return undefined;
    return live.kind === 'still' ? { ...live.box } : { ...live.widget.box };
  }

  /** A menu's (or a dialog's choice list's) item box, or undefined. */
  itemBox(id: string, item: string): Box | undefined {
    const live = this.ids.get(id);
    if (live?.kind === 'menu') return live.widget.itemBox(item);
    if (live?.kind === 'dialog') return live.widget.choiceMenu?.itemBox(item);
    return undefined;
  }

  /** The menu with that id (also a button), or undefined. */
  menu(id: string): Menu | undefined {
    const live = this.ids.get(id);
    return live?.kind === 'menu' ? live.widget : undefined;
  }

  /** The dialog with that id, or undefined. */
  dialog(id: string): DialogBox | undefined {
    const live = this.ids.get(id);
    return live?.kind === 'dialog' ? live.widget : undefined;
  }

  /** A slider's or toggle's value in a menu. */
  value(id: string, item: string): number | boolean | undefined {
    return this.menu(id)?.value(item);
  }

  /**
   * Shows a widget and focuses it (a dialog starts again from its first page); the widget
   * focused before is kept, to go back to. False for an unknown id.
   */
  open(id: string, out: UiEvent[] = []): boolean {
    const live = this.ids.get(id);
    if (live === undefined) return false;
    if (live.kind === 'dialog') live.widget.restart();
    if (!this.shown.has(live)) {
      this.shown.add(live);
      out.push({ type: 'open', widget: id });
    }
    if (live.kind !== 'still' && this.focusLive !== live) {
      if (this.focusLive !== null) this.stack.push(this.focusLive);
      this.focusLive = live;
    }
    return true;
  }

  /** Hides a widget; if it had the focus, the widget focused before it takes it back. */
  close(id: string, out: UiEvent[] = []): boolean {
    const live = this.ids.get(id);
    if (live === undefined || !this.shown.has(live)) return false;
    this.shown.delete(live);
    out.push({ type: 'close', widget: id });
    if (this.focusLive === live) {
      let back = this.stack.pop() ?? null;
      while (back !== null && !this.shown.has(back)) back = this.stack.pop() ?? null;
      this.focusLive = back;
    }
    return true;
  }

  /** Focuses a shown widget (false when it is hidden, unknown or not interactive). */
  focus(id: string): boolean {
    const live = this.ids.get(id);
    if (live === undefined || live.kind === 'still' || !this.shown.has(live)) return false;
    this.focusLive = live;
    return true;
  }

  /** The topmost shown interactive widget at `p` (a dialog's choice list counts as the dialog). */
  private widgetAt(p: UiPoint): Live | null {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const live = this.live[i]!;
      if (!this.shown.has(live) || live.kind === 'still') continue;
      if (inBox(live.widget.box, p)) return live;
      if (live.kind === 'dialog' && live.widget.choosing && inBox(live.widget.choiceMenu!.box, p))
        return live;
    }
    return null;
  }

  /** One display frame of input; returns what happened, in order (also played as sounds). */
  update(input: UiInput): UiEvent[] {
    this.clock++;
    const frame = this.clock;
    const out: UiEvent[] = [];
    // Taps go to the widget under them (focusing it); the commands and hover to the focused one.
    const taps = new Map<Live, UiPoint[]>();
    for (const tap of input.taps ?? []) {
      const live = this.widgetAt(tap);
      // A dialog with the focus is modal: taps elsewhere do nothing.
      if (live === null || (this.focusLive?.kind === 'dialog' && live !== this.focusLive)) continue;
      this.focusLive = live;
      taps.set(live, [...(taps.get(live) ?? []), tap]);
    }
    const hover = input.pointer ?? null;
    // The mouse hovers menus only while no dialog holds the focus.
    const hovering = this.focusLive?.kind !== 'dialog';
    for (const live of this.live) {
      if (!this.shown.has(live) || live.kind === 'still') continue;
      const focused = live === this.focusLive;
      if (!focused && live.kind === 'dialog') continue;
      const own: UiInput = {
        ...(focused && input.commands !== undefined && { commands: input.commands }),
        taps: taps.get(live) ?? [],
        pointer: hovering ? hover : null,
      };
      const events = live.widget.update(own, frame);
      // A menu the mouse moved onto takes the focus.
      if (!focused && events.some((e) => e.type === 'focus')) this.focusLive = live;
      out.push(...events);
    }
    // Links: opens, choices' next, a dialog's end, back.
    const follow = [...out];
    for (const e of follow) this.follow(e, out);
    this.sound(out);
    return out;
  }

  private follow(e: UiEvent, out: UiEvent[]): void {
    const live = this.ids.get(e.widget);
    if (live === undefined) return;
    const spec = live.spec;
    if (e.type === 'activate') {
      const opens =
        spec.type === 'button'
          ? spec.opens
          : spec.type === 'menu'
            ? (spec.items.find((i) => i.id === e.item) as { opens?: string } | undefined)?.opens
            : undefined;
      if (opens !== undefined) this.open(opens, out);
    } else if (e.type === 'choice' && spec.type === 'dialog') {
      const next = spec.choices?.find((c) => c.id === e.item)?.next;
      this.close(e.widget, out);
      if (next !== undefined) this.open(next, out);
    } else if (e.type === 'done' && spec.type === 'dialog') {
      this.close(e.widget, out);
      if (spec.next !== undefined) this.open(spec.next, out);
    } else if (e.type === 'back' && this.stack.length > 0 && this.focusLive === live) {
      this.close(e.widget, out);
    }
  }

  private sound(events: readonly UiEvent[]): void {
    const sounds = this.file.style.sounds ?? {};
    const play = this.opts.onSound;
    if (play === undefined) return;
    const ids = new Set<string>();
    for (const e of events) {
      const id =
        e.type === 'focus' || e.type === 'change'
          ? sounds.move
          : e.type === 'activate' || e.type === 'choice'
            ? sounds.select
            : e.type === 'back' || e.type === 'close'
              ? sounds.back
              : e.type === 'type'
                ? sounds.type
                : e.type === 'page' || e.type === 'skip' || e.type === 'done'
                  ? (sounds.page ?? sounds.select)
                  : undefined;
      if (id !== undefined) ids.add(id);
    }
    for (const id of ids) play(id);
  }

  /** The screen's draw items now, widgets in file order (hidden ones left out). */
  draws(): UiDraw[] {
    const out: UiDraw[] = [];
    const frame = this.clock;
    for (const live of this.live) {
      if (!this.shown.has(live)) continue;
      if (live.kind === 'menu') out.push(...live.widget.draws(frame, live === this.focusLive));
      else if (live.kind === 'dialog') out.push(...live.widget.draws(frame));
      else out.push(...this.stillDraws(live.spec, live.box));
    }
    return out;
  }

  private stillDraws(spec: UiWidgetSpec, box: Box): UiDraw[] {
    const look = this.look;
    if (spec.type === 'panel') {
      if (spec.color === undefined) return lookPanel(look, box);
      return [
        {
          kind: 'fill',
          ...box,
          color: spec.color,
          ...(spec.alpha !== undefined && spec.alpha < 1 && { alpha: spec.alpha }),
        },
      ];
    }
    if (spec.type !== 'text') return [];
    const font = (spec.font !== undefined ? this.opts.fonts(spec.font) : null) ?? look.font;
    const style = {
      color: spec.color ?? look.text,
      ...((spec.shadow ?? look.style.shadow) !== undefined && {
        shadow: (spec.shadow ?? look.style.shadow)!,
      }),
      ...(spec.outline !== undefined && { outline: spec.outline }),
    };
    const opts: { width?: number; align?: TextAlign } = {
      ...(spec.w !== undefined && { width: spec.w }),
      ...(spec.align !== undefined && { align: spec.align }),
    };
    return textDraws(font, spec.text, box.x, box.y, style, opts);
  }
}
