import type { Action } from './actions';
import type { BindingMap, Code } from './bindings';
import { describeCode } from './bindings';
import type { TouchLabels } from './touch';
import { BUTTON_PLACES, GAME_FRAME } from './touch-logic';

/** The keyboard key bound to each action, as the hints print it ("Z", "RIGHT SHIFT", "←"). */
export type KeyHints = Partial<Record<Action, string>>;

const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

export function keyName(code: Code | undefined): string {
  if (!code) return '';
  return ARROWS[code] ?? describeCode(code).toUpperCase();
}

/** Each action's first keyboard binding (so a remap shows at once). */
export function keyHintMap(keyboard: BindingMap | undefined): KeyHints {
  const out: KeyHints = {};
  if (!keyboard) return out;
  for (const [a, codes] of Object.entries(keyboard) as [Action, Code[]][]) {
    const k = keyName(codes[0]);
    if (k) out[a] = k;
  }
  return out;
}

/** The ability buttons of the touch layout, in the order they are drawn. */
export const HINT_BUTTONS = ['jump', 'attack', 'special', 'select', 'start'] as const;
export type HintButton = (typeof HINT_BUTTONS)[number];

export interface KeyHintItem {
  /** A face/small button, or 'move' for the d-pad. */
  id: HintButton | 'move';
  /** The ability, as the touch button would say it ("JUMP", "FIRE", "BOOMERANG"). */
  label: string;
  /** The bound key(s) ("Z", "←→↑↓"). */
  key: string;
}

/**
 * What the key-hint reference shows: the d-pad as MOVE, then every ability button that the
 * scene shows (a hidden or blank button is left out), each with its key.
 */
export function keyHintItems(labels: TouchLabels, keys: KeyHints): KeyHintItem[] {
  const dirs = (['left', 'right', 'up', 'down'] as const).map((d) => keys[d] ?? '');
  const arrows = dirs.every((k) => Object.values(ARROWS).includes(k));
  const items: KeyHintItem[] = [{ id: 'move', label: 'MOVE', key: dirs.join(arrows ? '' : ' ') }];
  for (const a of HINT_BUTTONS) {
    const label = labels[a];
    if (!label) continue;
    items.push({ id: a, label: label.toUpperCase(), key: keys[a] ?? '' });
  }
  return items;
}

/** Scale of the reference against the touch layout it copies (it only has to be read, not hit). */
const SCALE = 0.8;

/**
 * Desktop key hints: a small translucent copy of the touch layout (d-pad bottom left, ability
 * buttons bottom right, menu top right) in the screen corners, each button with its current
 * label and the bound key under it ("JUMP / Z"). Never takes pointer input.
 */
export class KeyHintsOverlay {
  private readonly root: HTMLElement;
  private readonly els = new Map<KeyHintItem['id'], HTMLElement>();
  private sig = '';

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'key-hints';
    this.root.setAttribute('aria-hidden', 'true');
    const place = (id: HintButton) =>
      Object.entries(BUTTON_PLACES[id])
        .map(([k, v]) => `${k}: ${Math.round(v * SCALE)}px;`)
        .join(' ');
    this.root.innerHTML = `
      <style>
        .key-hints { position: fixed; ${GAME_FRAME} pointer-events: none; display: none; z-index: 1; font-family: system-ui, sans-serif; color: rgba(255,255,255,0.85); }
        .key-hints.visible { display: block; }
        .key-hints .kh { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; width: ${Math.round(68 * SCALE)}px; height: ${Math.round(68 * SCALE)}px; border-radius: 50%; background: rgba(0,0,0,0.35); border: 2px solid rgba(255,255,255,0.3); text-align: center; line-height: 1.1; overflow: visible; }
        .key-hints .kh b { font-size: 11px; letter-spacing: 0.02em; white-space: nowrap; }
        .key-hints .kh span { font-size: 10px; opacity: 0.75; margin-top: 2px; white-space: nowrap; }
        .key-hints .kh.hidden { display: none; }
        .key-hints .kh.small { height: ${Math.round(34 * SCALE)}px; border-radius: ${Math.round(17 * SCALE)}px; flex-direction: row; gap: 4px; width: auto; min-width: ${Math.round(68 * SCALE)}px; padding: 0 6px; }
        .key-hints .kh.small span { margin-top: 0; }
        .key-hints .kh.move { left: 16px; bottom: 24px; width: ${Math.round(120 * SCALE)}px; height: ${Math.round(120 * SCALE)}px; }
        ${HINT_BUTTONS.map((id) => `.key-hints .kh-${id} { ${place(id)} }`).join('\n        ')}
      </style>
      <div class="kh move" data-hint="move"><b>MOVE</b><span></span></div>
      ${HINT_BUTTONS.map(
        (id) =>
          `<div class="kh kh-${id}${id === 'select' || id === 'start' ? ' small' : ''}" data-hint="${id}"><b></b><span></span></div>`,
      ).join('')}`;
    container.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-hint]').forEach((el) => {
      this.els.set(el.dataset.hint as KeyHintItem['id'], el);
    });
  }

  /** Show `items` (cheap when nothing changed); null hides the reference. */
  update(items: readonly KeyHintItem[] | null): void {
    const sig = items ? items.map((i) => `${i.id}:${i.label}:${i.key}`).join('|') : '';
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.classList.toggle('visible', !!items);
    if (!items) return;
    for (const [id, el] of this.els) {
      const item = items.find((i) => i.id === id);
      el.classList.toggle('hidden', !item);
      if (!item) continue;
      const b = el.querySelector('b') as HTMLElement;
      const span = el.querySelector('span') as HTMLElement;
      b.textContent = item.label;
      // Shrink long words (BOOMERANG, SHURIKEN) to about the round button (they may spill a little:
      // nothing is pressed here); pills have room.
      const round = !el.classList.contains('small') && id !== 'move';
      b.style.fontSize = round
        ? `${Math.max(8, Math.min(11, Math.floor(46 / (item.label.length * 0.66))))}px`
        : '';
      span.textContent = item.key;
    }
  }
}
