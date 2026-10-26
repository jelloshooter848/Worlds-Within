import type { Action } from './actions';

/** A raw input code: KeyboardEvent.code, `pad:<button>`, `pad:axis<n><+|->`, or `touch:<name>`. */
export type Code = string;
export type BindingMap = Record<Action, Code[]>;

export interface PlayerBindings {
  keyboard: BindingMap;
  gamepad: BindingMap;
  /** Which connected gamepad index this player uses; null = first available. */
  gamepadIndex: number | null;
}

export const DEFAULT_KEYBOARD_P1: BindingMap = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['KeyZ', 'Space', 'KeyK'],
  attack: ['KeyX', 'ShiftLeft', 'KeyJ'],
  special: ['KeyC', 'KeyL'],
  start: ['Enter', 'Escape'],
  select: ['ShiftRight', 'Backspace'],
  run: [],
};

export const DEFAULT_KEYBOARD_P2: BindingMap = {
  left: ['Numpad4'],
  right: ['Numpad6'],
  up: ['Numpad8'],
  down: ['Numpad5', 'Numpad2'],
  jump: ['Numpad0'],
  attack: ['NumpadDecimal'],
  special: ['NumpadEnter'],
  start: ['NumpadAdd'],
  select: ['NumpadSubtract'],
  run: [],
};

/** Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping). */
export const DEFAULT_GAMEPAD: BindingMap = {
  left: ['pad:14', 'pad:axis0-'],
  right: ['pad:15', 'pad:axis0+'],
  up: ['pad:12', 'pad:axis1-'],
  down: ['pad:13', 'pad:axis1+'],
  jump: ['pad:0', 'pad:1'],
  attack: ['pad:2', 'pad:3'],
  special: ['pad:5', 'pad:4'],
  start: ['pad:9'],
  select: ['pad:8'],
  run: [],
};

export function defaultBindings(player: number): PlayerBindings {
  return {
    keyboard: structuredClone(player === 0 ? DEFAULT_KEYBOARD_P1 : DEFAULT_KEYBOARD_P2),
    gamepad: structuredClone(DEFAULT_GAMEPAD),
    gamepadIndex: null,
  };
}

/** Human readable name for a code, for the remap UI. */
export function describeCode(code: Code): string {
  if (code.startsWith('pad:axis')) return `Stick ${code.slice(8)}`;
  if (code.startsWith('pad:')) return `Button ${code.slice(4)}`;
  if (code.startsWith('touch:')) return `Touch ${code.slice(6)}`;
  return code
    .replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, '$2 $1')
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace(/^Numpad/, 'Num ');
}

/** Names for the standard gamepad mapping (the real button names, e.g. "A", "START"). */
export function describePad(code: Code): string {
  const names: Record<string, string> = {
    'pad:0': 'A',
    'pad:1': 'B',
    'pad:2': 'X',
    'pad:3': 'Y',
    'pad:4': 'LB',
    'pad:5': 'RB',
    'pad:6': 'LT',
    'pad:7': 'RT',
    'pad:8': 'BACK',
    'pad:9': 'START',
    'pad:12': 'D-UP',
    'pad:13': 'D-DOWN',
    'pad:14': 'D-LEFT',
    'pad:15': 'D-RIGHT',
  };
  return names[code] ?? describeCode(code).toUpperCase();
}

/** Where another binding already holds a code: the player, the action, and whether it is that action's only one. */
export interface BindingClash {
  player: number;
  action: Action;
  only: boolean;
}

/**
 * Every other binding that already holds `code` (G-091: remapping never leaves two actions on
 * one key, as the original's ButtonManager refuses a bound key). The action being remapped never
 * clashes with itself. A keyboard is shared by every player, so keyboard codes are checked across
 * all of them; a pad button only against the same player.
 */
export function bindingClashes(
  all: readonly PlayerBindings[],
  player: number,
  kind: 'keyboard' | 'gamepad',
  action: Action,
  code: Code,
): BindingClash[] {
  const out: BindingClash[] = [];
  for (let p = 0; p < all.length; p++) {
    if (kind === 'gamepad' && p !== player) continue;
    const map = all[p]?.[kind];
    if (!map) continue;
    for (const a of Object.keys(map) as Action[]) {
      if (p === player && a === action) continue;
      if (map[a].includes(code)) out.push({ player: p, action: a, only: map[a].length === 1 });
    }
  }
  return out;
}
