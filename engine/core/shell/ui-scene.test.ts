import { describe, expect, it } from 'vitest';
import type { Action } from '../input/actions';
import { ActionState } from '../input/input-manager';
import { buildFont, UiScreen, type UiDraw, type UiPainter } from '../ui';
import { UiScene } from './ui-scene';
import type { Renderer } from '../gfx/renderer';

const FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries(
    [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'].map((c) => [
      c,
      { rows: ['###', '###', '###', '###', '...'] },
    ]),
  ),
});

function scene(
  onEvent?: ConstructorParameters<typeof UiScene>[0]['onEvent'],
  cursor: { x: number; y: number } | null = null,
) {
  const ui = new UiScreen(
    {
      style: { font: 't' },
      widgets: [
        {
          id: 'main',
          type: 'menu',
          anchor: 'center',
          items: [
            { id: 'start', label: 'Start' },
            { id: 'quit', label: 'Quit' },
          ],
        },
      ],
    },
    { screen: { width: 256, height: 240 }, fonts: (id) => (id === 't' ? FONT : null) },
  );
  const drawn: UiDraw[] = [];
  const painter: UiPainter = {
    fill: (d) => drawn.push(d),
    image: (d) => drawn.push(d),
    glyph: (d) => drawn.push(d),
  };
  let painters = 0;
  const s = new UiScene({
    ui,
    painter: () => {
      painters++;
      return painter;
    },
    pointer: { cursor: () => cursor },
    ...(onEvent && { onEvent }),
  });
  return { s, ui, drawn, painters: () => painters };
}

function frame(state: ActionState, held: Action[], taps: { x: number; y: number }[] = []) {
  state.beginFrame(
    new Set(held),
    taps.map((t) => ({ ...t, button: 'primary' as const })),
  );
  return state;
}

describe('UiScene: a UI screen in the shell (Engine 0.16 T7)', () => {
  it('drives the screen by actions and taps from the frame, reporting events', () => {
    const events: string[] = [];
    const { s, ui } = scene((e) => events.push(`${e.type}:${'item' in e ? e.item : ''}`));
    const input = new ActionState();
    s.update(frame(input, ['down']));
    s.update(frame(input, ['down'])); // held: no repeat yet
    expect(ui.menu('main')!.focused).toBe('quit');
    s.update(frame(input, ['jump']));
    const start = ui.itemBox('main', 'start')!;
    s.update(frame(input, [], [{ x: start.x + 2, y: start.y + 2 }]));
    expect(events).toEqual(['focus:quit', 'activate:quit', 'focus:start', 'activate:start']);
    expect(s.translucent).toBe(true);
  });

  it('follows the hovering mouse and paints through one painter per renderer', () => {
    const probe = scene();
    const quit = probe.ui.itemBox('main', 'quit')!;
    const { s, ui, drawn, painters } = scene(undefined, { x: quit.x + 2, y: quit.y + 2 });
    s.update(frame(new ActionState(), []));
    expect(ui.menu('main')!.focused).toBe('quit');
    const r = {} as Renderer;
    s.render(r);
    s.render(r);
    expect(painters()).toBe(1);
    expect(drawn.some((d) => d.kind === 'glyph')).toBe(true);
  });
});
