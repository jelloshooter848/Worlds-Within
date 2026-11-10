import type { Box } from './nine-slice';
import type { UiDraw } from './paint';
import { layoutText, measureLine, type TextLayout } from './text';
import { inBox, type UiEvent, type UiInput } from './ui-input';
import type { UiChoiceSpec, UiSpriteRef } from './ui-schema';
import { lookPanel, lookText, panelContent, panelExtra, type UiLook } from './look';
import { Menu } from './menu';

/**
 * Dialog boxes (Engine 0.16 T7): a speaker's name on a tab, a portrait in a frame at the left,
 * and text typed a character at a time at a set rate (display frames per character), page by
 * page. A page too long for the box breaks into more pages at whole lines. Confirm (or a tap on
 * the box) while a page types shows it whole (skip); on a whole page it turns to the next; after
 * the last page a choice list (a `Menu` over the box's right edge) takes the input, or the dialog
 * is done. The typewriter counts the frames it is stepped, so the same input gives the same
 * picture; it is presentation state only, never in a kit, a frame or a hash. Pure.
 */

export interface DialogOptions {
  id: string;
  speaker?: string;
  portrait?: UiSpriteRef;
  /** The text, page by page (each wrapped to the box and broken at whole lines when too long). */
  pages: readonly string[];
  /** Display frames per character (default the style's `rate`); 0 shows each page at once. */
  rate?: number;
  choices?: readonly UiChoiceSpec[];
}

/** Px between the portrait's frame and the text. */
const PORTRAIT_GAP = 4;

export class DialogBox {
  readonly id: string;
  box: Box = { x: 0, y: 0, w: 0, h: 0 };
  private pages: TextLayout[] = [];
  private pageIndex = 0;
  /** Frames this page has typed. */
  private t = 0;
  private finished = false;
  private readonly choices: Menu | null;

  constructor(
    private readonly opts: DialogOptions,
    private readonly look: UiLook,
  ) {
    this.id = opts.id;
    this.choices =
      opts.choices === undefined || opts.choices.length === 0
        ? null
        : new Menu(
            { id: opts.id, items: opts.choices.map((c) => ({ id: c.id, label: c.label })), wrap: true },
            look,
          );
  }

  private get rate(): number {
    return this.opts.rate ?? this.look.rate;
  }

  /** Puts the dialog at `box` and breaks its text into pages for it; starts it again. */
  place(box: Box): void {
    this.box = { ...box };
    const text = this.textBox();
    const font = this.look.font;
    const perPage = Math.max(1, Math.floor((text.h - font.cell.h) / font.line) + 1);
    this.pages = [];
    for (const page of this.opts.pages) {
      const lines = layoutText(font, page, { width: text.w }).lines.map((l) => l.text);
      for (let i = 0; i < Math.max(1, lines.length); i += perPage)
        this.pages.push(layoutText(font, lines.slice(i, i + perPage).join('\n')));
    }
    if (this.choices !== null) {
      const size = this.choices.size();
      this.choices.place({ x: box.x + box.w - size.w, y: box.y - size.h - 1, ...size });
    }
    this.restart();
  }

  /** Back to the first page, nothing typed. */
  restart(): void {
    this.pageIndex = 0;
    this.t = 0;
    this.finished = false;
    if (this.choices !== null) this.choices.focus(this.choices.items[0]!.id);
  }

  /** The portrait's frame box (a square the inner box's height), or null without a portrait. */
  portraitBox(): Box | null {
    if (this.opts.portrait === undefined) return null;
    const inner = panelContent(this.look, this.box);
    return { x: inner.x, y: inner.y, w: inner.h, h: inner.h };
  }

  /** Where the text is typed. */
  textBox(): Box {
    const inner = panelContent(this.look, this.box);
    const p = this.portraitBox();
    if (p === null) return inner;
    const left = p.w + PORTRAIT_GAP;
    return { x: inner.x + left, y: inner.y, w: Math.max(0, inner.w - left), h: inner.h };
  }

  /** How many pages the text broke into (for this box). */
  get pageCount(): number {
    return this.pages.length;
  }

  get page(): number {
    return this.pageIndex;
  }

  /** Characters of this page shown now (glyphs; spaces are not counted). */
  get shown(): number {
    const all = this.pageLength();
    if (this.rate <= 0) return all;
    return Math.min(all, Math.floor(this.t / this.rate));
  }

  private pageLength(): number {
    return this.pages[this.pageIndex]?.glyphs.length ?? 0;
  }

  /** Whether this page is shown whole. */
  get typed(): boolean {
    return this.shown >= this.pageLength();
  }

  /** Whether the choice list shows (the last page typed, and choices given). */
  get choosing(): boolean {
    return this.choices !== null && !this.finished && this.pageIndex === this.pages.length - 1 && this.typed;
  }

  /** The choice list (null without choices), for its boxes and focus. */
  get choiceMenu(): Menu | null {
    return this.choices;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The text of the page shown (lines joined by `\n`). */
  pageText(): string {
    return this.pages[this.pageIndex]?.lines.map((l) => l.text).join('\n') ?? '';
  }

  /**
   * One display frame: types on (a `type` event every `typeEvery` characters), then handles the
   * input: confirm or a tap on the box skips or turns the page (`skip`, `page`, `done`); while
   * choosing, the choice list takes the commands and taps (`choice` when one is taken).
   */
  update(input: UiInput, frame: number): UiEvent[] {
    const out: UiEvent[] = [];
    if (this.finished) return out;
    const before = this.shown;
    if (!this.typed) this.t++;
    const every = this.look.typeEvery;
    if (Math.floor(this.shown / every) > Math.floor(before / every))
      out.push({ type: 'type', widget: this.id });

    if (this.choosing) {
      for (const e of this.choices!.update(input, frame)) {
        if (e.type === 'activate' && e.item !== undefined) {
          out.push({ type: 'choice', widget: this.id, item: e.item });
          this.finished = true;
        } else if (e.type === 'focus') out.push(e);
      }
      return out;
    }
    const taps = (input.taps ?? []).filter((p) => inBox(this.box, p)).length;
    const confirms = (input.commands ?? []).filter((c) => c === 'confirm').length + taps;
    for (let k = 0; k < confirms && !this.finished; k++) this.advance(out);
    return out;
  }

  /** Confirm: show the page whole, else the next page, else done (unless choices wait). */
  advance(out: UiEvent[] = []): UiEvent[] {
    if (this.finished || this.choosing) return out;
    if (!this.typed) {
      this.t = this.rate * this.pageLength();
      out.push({ type: 'skip', widget: this.id });
      return out;
    }
    if (this.pageIndex < this.pages.length - 1) {
      this.pageIndex++;
      this.t = 0;
      out.push({ type: 'page', widget: this.id, page: this.pageIndex });
      return out;
    }
    this.finished = true;
    out.push({ type: 'done', widget: this.id });
    return out;
  }

  /** The height a dialog wants without `h`: `lines` lines of text (3) inside its panel. */
  static defaultHeight(look: UiLook, lines = 3): number {
    return lines * look.font.line - (look.font.line - look.font.cell.h) + panelExtra(look).h;
  }

  draws(frame: number): UiDraw[] {
    const look = this.look;
    const out: UiDraw[] = [];
    if (this.opts.speaker !== undefined) {
      const w = measureLine(look.font, this.opts.speaker);
      const extra = panelExtra(look);
      const tab = {
        x: this.box.x + 4,
        y: this.box.y - (look.font.cell.h + extra.h) + 1,
        w: w + extra.w,
        h: look.font.cell.h + extra.h,
      };
      out.push(...lookPanel(look, tab));
      const inner = panelContent(look, tab);
      out.push(...lookText(look, this.opts.speaker, inner.x, inner.y, look.focusText));
    }
    out.push(...lookPanel(look, this.box));
    const pbox = this.portraitBox();
    if (pbox !== null && this.opts.portrait !== undefined)
      out.push(...this.portraitDraws(pbox, this.opts.portrait));
    const text = this.textBox();
    const page = this.pages[this.pageIndex];
    if (page !== undefined)
      for (const g of page.glyphs.slice(0, this.shown)) {
        const at = { x: text.x + g.x, y: text.y + g.y };
        if (look.style.shadow !== undefined)
          out.push({
            kind: 'glyph',
            font: look.font.id,
            ch: g.ch,
            x: at.x + 1,
            y: at.y + 1,
            color: look.style.shadow,
          });
        out.push({ kind: 'glyph', font: look.font.id, ch: g.ch, ...at, color: look.text });
      }
    // The "more" mark: a small blinking triangle while a whole page waits for confirm.
    if (!this.finished && this.typed && !this.choosing && Math.floor(frame / 20) % 2 === 0) {
      const x = text.x + text.w - 5;
      const y = text.y + text.h - 3;
      out.push(
        { kind: 'fill', x, y, w: 5, h: 1, color: look.focusText },
        { kind: 'fill', x: x + 1, y: y + 1, w: 3, h: 1, color: look.focusText },
        { kind: 'fill', x: x + 2, y: y + 2, w: 1, h: 1, color: look.focusText },
      );
    }
    if (this.choosing) out.push(...this.choices!.draws(frame));
    return out;
  }

  /** The portrait's frame (a border and the back) and the sprite, scaled by whole steps and centred. */
  private portraitDraws(box: Box, ref: UiSpriteRef): UiDraw[] {
    const look = this.look;
    const out: UiDraw[] = [
      { kind: 'fill', ...box, color: look.border },
      { kind: 'fill', x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2, color: look.focusBack },
    ];
    const size = look.frameSize(ref.sheet, ref.palette, ref.frame);
    if (size === null) return out;
    const room = box.w - 4;
    const scale = Math.max(1, Math.floor(Math.min(room / size.w, room / size.h)));
    const w = size.w * scale;
    const h = size.h * scale;
    out.push({
      kind: 'image',
      sheet: ref.sheet,
      ...(ref.palette !== undefined && { palette: ref.palette }),
      frame: ref.frame,
      sx: 0,
      sy: 0,
      sw: size.w,
      sh: size.h,
      x: box.x + Math.floor((box.w - w) / 2),
      y: box.y + Math.floor((box.h - h) / 2),
      w,
      h,
    });
    return out;
  }
}
