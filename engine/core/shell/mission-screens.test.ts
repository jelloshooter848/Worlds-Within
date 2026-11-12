import type { UiWidgetSpec } from '../ui';
import { describe, expect, it } from 'vitest';
import type { JsonObject, MissionStepRefusal } from '../headless';
import { ActionState, frameTaps, type InputFrame } from '../input/input-manager';
import type { MiniGame } from '../minigame';
import type { MissionDef, MissionRecord } from '../missions';
import { buildFont, layoutText, menusSchema, type UiScreenFile } from '../ui';
import { noChanges } from '../world-changes';
import { MissionLaunch, type LaunchGame } from './mission-launch';
import {
  briefingScreen,
  MissionScreens,
  missionCardScreen,
  missionScreensScene,
  resultsScreen,
  windowBadgeScreen,
  type MissionScreenContext,
} from './mission-screens';

// The in-picture mission screens (Engine 0.16 F5) over a `MissionLaunch` of a tiny fake game: the
// screens built from `menus`, the card's Play disabled for a choice, the results cut to the
// picture, and each button pressed by keys, taps and the mouse mapped to `launch.press`. The mini
// siege's own missions and runs: `games/samples/mini-siege/mission-screens.test.ts`.

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:'()-↑↓";
const FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries(
    [...CHARS].filter((c) => c !== ' ').map((c) => [c, { rows: ['###', '###', '###', '###', '...'] }]),
  ),
});
const fonts = (id: string) => (id === 't' ? FONT : null);
const MENUS = menusSchema.parse({
  font: 't',
  style: { heading: '#fc9838', padding: 4 },
  title: { name: 'Test', items: ['start'] },
  pause: { items: ['resume'] },
});
const CTX: MissionScreenContext = { menus: MENUS, screen: { width: 256, height: 240 }, fonts };

const RAID: MissionDef = {
  id: 'raid',
  title: 'Burn the engines',
  text: 'Out under the walls.',
  worldTimeCost: 90,
  play: 'count',
  onQuit: 'lost',
  outcomes: [
    { id: 'won', title: 'Both burnt', weight: 1, effects: [] },
    { id: 'lost', title: 'Driven off', weight: 1, effects: [] },
  ],
};
const PAY: MissionDef = {
  id: 'pay',
  title: 'Pay the toll',
  worldTimeCost: 10,
  onQuit: 'paid',
  outcomes: [{ id: 'paid', title: 'Paid', weight: 1, effects: [] }],
};

const texts = (file: UiScreenFile | null | undefined) =>
  (file?.widgets ?? []).flatMap((w) => (w.type === 'text' ? [w.text] : []));

/** A world that ticks, opens one mission at a time and commits it `worldTimeCost` later. */
class Game implements LaunchGame {
  tick = 0;
  events: unknown[] = [];
  open: { id: string; at: number; until: number; outcome: string | null; how: string } | null = null;
  committed: MissionRecord[] = [];
  steps: JsonObject[] = [];
  round: MiniGame | null = null;
  step(): void {
    this.tick++;
    const open = this.open;
    if (open !== null && open.outcome !== null && this.tick >= open.until) {
      this.committed.push({
        mission: open.id,
        outcome: open.outcome,
        effects: [],
        resolution: open.how as MissionRecord['resolution'],
        openTick: open.at,
        commitTick: this.tick,
        experienceTicks: 0,
        skipped: [],
      });
      this.open = null;
    }
  }
  snapshot(): JsonObject {
    return { tick: this.tick };
  }
  miniGame(): MiniGame | null {
    return this.round;
  }
  mission(step: JsonObject): MissionStepRefusal | null {
    this.steps.push(step);
    const def = [RAID, PAY].find((d) => d.id === step['mission'])!;
    if (step['action'] === 'open') {
      if (this.open !== null) return { code: 'mission_open', error: 'one at a time' };
      this.open = { id: def.id, at: this.tick, until: this.tick + def.worldTimeCost, outcome: null, how: '' };
      return null;
    }
    if (this.open === null) return { code: 'mission_not_open', error: 'not open' };
    if (step['action'] === 'delegate')
      this.open = { ...this.open, outcome: def.outcomes[0]!.id, how: 'delegated' };
    if (step['action'] === 'play') {
      this.open = { ...this.open, outcome: 'won', how: 'played' };
      this.round = { step: () => undefined, snapshot: () => ({}), result: () => null, report: () => ({}) };
    }
    return null;
  }
  records(): readonly MissionRecord[] {
    return this.committed;
  }
}

function flow(
  offers: (game: Game) => string[] = (g) =>
    g.tick >= 2 && g.open === null && g.committed.length === 0 ? ['raid'] : [],
) {
  const launch = new MissionLaunch<Game>({
    create: () => new Game(),
    missions: [RAID, PAY],
    offers,
    tick: (game) => game.tick,
  });
  let cursor: { x: number; y: number } | null = null;
  const screens = new MissionScreens<Game>({
    launch,
    menus: MENUS,
    screen: CTX.screen,
    fonts,
    pointer: { cursor: () => cursor },
    facts: (game, def) => ({
      hero: 'Hale',
      foes: '2 raiders',
      ticksLeft: def.id === 'raid' ? 20 - game.tick : null,
    }),
    changes: (game, since) => ({ ...noChanges(since, game.tick), records: game.records() }),
  });
  const keys = new ActionState();
  const step = (held: string[] = [], taps: { x: number; y: number }[] = []) => {
    keys.beginFrame(
      new Set(held as never[]),
      taps.map((t) => ({ ...t, button: 'primary' as const })),
    );
    const frame: InputFrame = keys;
    screens.update(frame);
    launch.update(frame);
    screens.sync();
  };
  const point = (item: string) => {
    const box = screens.ui!.itemBox('main', item)!;
    return { x: box.x + 1, y: box.y + 1 };
  };
  return { launch, screens, step, point, hover: (p: { x: number; y: number } | null) => (cursor = p) };
}

describe('the mission screens built from menus (Engine 0.16 F5)', () => {
  it('builds the briefing: the title, the text, Begin and Carry on with a kept save', () => {
    const file = briefingScreen(CTX, { title: 'The siege', text: 'Hold the hall.' }, { stored: true });
    expect(texts(file)).toEqual(['The siege', 'Hold the hall.']);
    const menu = file.widgets.find((w) => w.id === 'main');
    expect(menu?.type === 'menu' && menu.items.map((i) => i.label)).toEqual(['Begin', 'Carry on']);
    expect(file.focus).toBe('main');
  });

  it('builds the card in the bottom-right corner: Play disabled for a mission without a round', () => {
    const facts = { hero: 'Hale', foes: 'ram', ticksLeft: 5 };
    const raid = missionCardScreen(CTX, { def: RAID, open: false, canPlay: true, facts, ticksPerHour: 60 });
    expect(texts(raid)).toEqual([
      'MISSION AVAILABLE',
      'Burn the engines',
      'Out under the walls.',
      'Costs 1 hour 30 min of world time',
      'Hero Hale',
      'Foes ram',
    ]);
    const card = raid.widgets.find((w) => w.id === 'card')!;
    expect((card.x ?? 0) + (card.w ?? 0)).toBe(256 - 4);
    expect((card.y ?? 0) + (card.h ?? 0)).toBe(240 - 4);
    const pay = missionCardScreen(CTX, { def: PAY, open: true, canPlay: false, facts, ticksPerHour: 60 });
    expect(texts(pay)[0]).toBe('MISSION OPEN');
    const menu = pay.widgets.find((w) => w.id === 'main');
    expect(menu?.type === 'menu' && menu.items).toEqual([
      { id: 'play', label: 'Play', disabled: true },
      { id: 'delegate', label: 'Delegate' },
    ]);
    expect(windowBadgeScreen(CTX, '', { x: 0, y: 100, w: 50, h: 50 })).toBeNull();
    expect(texts(windowBadgeScreen(CTX, 'Window closes in 5 ticks', { x: 0, y: 100, w: 50, h: 50 }))).toEqual(
      ['Window closes in 5 ticks'],
    );
  });

  it("builds the corner cards in the card look's width and font (Engine 0.16 F7)", () => {
    const tiny = buildFont('tiny', {
      cell: { w: 2, h: 3 },
      baseline: 2,
      glyphs: Object.fromEntries(
        [...CHARS].filter((c) => c !== ' ').map((c) => [c, { rows: ['##', '##', '..'] }]),
      ),
    });
    const ctx: MissionScreenContext = {
      ...CTX,
      fonts: (id) => (id === 'tiny' ? tiny : fonts(id)),
      card: { width: 100, font: 'tiny' },
    };
    const facts = { hero: 'Hale', foes: 'ram', ticksLeft: 5 };
    const raid = missionCardScreen(ctx, { def: RAID, open: false, canPlay: true, facts, ticksPerHour: 60 });
    const card = raid.widgets.find((w) => w.id === 'card')!;
    expect(card.w).toBe(100);
    expect((card.x ?? 0) + (card.w ?? 0)).toBe(256 - 4);
    expect(raid.style.font).toBe('tiny');
    const big = missionCardScreen(CTX, { def: RAID, open: false, canPlay: true, facts, ticksPerHour: 60 });
    expect(card.h!).toBeLessThan(big.widgets.find((w) => w.id === 'card')!.h!);
    expect(
      windowBadgeScreen(ctx, 'Window closes in 5 ticks', { x: 0, y: 100, w: 50, h: 50 })!.style.font,
    ).toBe('tiny');
  });

  it('cuts the results to the picture, counting the lines left out, and keeps the save code', () => {
    const changes = {
      ...noChanges(0, 100),
      people: Array.from({ length: 40 }, (_, i) => ({
        entity: i,
        key: null,
        name: `Person ${i}`,
        faction: 'village',
        was: 'active',
        fate: 'dead',
        by: null,
      })),
    };
    const view = {
      title: 'The siege',
      verdict: 'held',
      changes,
      outcomeTitle: () => '',
      code: 'ABCDE-12345',
    };
    const shown = texts(resultsScreen(CTX, view));
    expect(shown.slice(0, 3)).toEqual(['The siege', 'held', 'People']);
    expect(shown.some((t) => /^and \d+ more$/.test(t))).toBe(true);
    expect(shown.slice(-2)).toEqual(['Save code', 'ABCDE-12345']);
    const small = texts(
      resultsScreen(CTX, { ...view, changes: { ...changes, people: changes.people.slice(0, 2) } }),
    );
    expect(small).toEqual([
      'The siege',
      'held',
      'People',
      '  Person 0: dead',
      '  Person 1: dead',
      'Save code',
      'ABCDE-12345',
    ]);
    // A 16:9 picture (Engine 0.16 F6): a wider panel, the changes down two columns, more of them shown.
    const many = {
      ...view,
      changes: {
        ...changes,
        people: [...changes.people, ...changes.people.map((x) => ({ ...x, entity: x.entity + 40 }))],
      },
    };
    const wide = resultsScreen({ ...CTX, screen: { width: 320, height: 180 } }, many);
    const rows = (wide?.widgets ?? []).filter(
      (w): w is UiWidgetSpec & { text: string } =>
        w.type === 'text' && typeof w.text === 'string' && w.text.startsWith('  Person'),
    );
    const xs = [...new Set(rows.map((w) => w.x))];
    expect(xs).toHaveLength(2);
    const left = rows.filter((w) => w.x === xs[0]).length;
    expect(rows.length).toBeGreaterThan(left);
    expect(texts(wide).slice(-2)).toEqual(['Save code', 'ABCDE-12345']);
    expect(rows.length).toBeGreaterThan(30);
    expect(texts(wide).find((t) => t.startsWith('and '))).toBe(`and ${80 - rows.length} more`);
  });
});

describe('the results in two columns on a wide picture (Engine 0.16 F9, gap M39)', () => {
  const record = (outcome: string): MissionRecord => ({
    mission: 'raid',
    outcome,
    effects: [],
    resolution: 'delegated',
    openTick: 0,
    commitTick: 90,
    experienceTicks: 0,
    skipped: [],
  });
  const person = (i: number) => ({
    entity: i,
    key: null,
    name: `Person ${i}`,
    faction: 'village',
    was: 'active',
    fate: 'dead',
    by: null,
  });
  const view = (people: number) => ({
    title: 'The siege',
    verdict: 'held',
    changes: {
      ...noChanges(0, 100),
      records: [record('won')],
      people: Array.from({ length: people }, (_, i) => person(i)),
      buildings: [
        {
          entity: 99,
          key: 'hall',
          kind: 'hall',
          faction: null,
          lost: 40,
          hp: 360,
          max: 400,
          destroyed: false,
        },
      ],
    },
    outcomeTitle: () => 'The ram and the catapult burnt down to their axles',
    code: 'ABCDE-12345',
  });
  const wide = { ...CTX, screen: { width: 320, height: 180 } };
  const textWidgets = (file: UiScreenFile) =>
    file.widgets.filter((w): w is UiWidgetSpec & { text: string } => w.type === 'text');

  it('spans the missions across the panel, then flows the rest down two columns', () => {
    const shown = textWidgets(resultsScreen(wide, view(3)));
    const at = (text: string) => shown.find((w) => w.text === text)!;
    const record = at('  The ram and the catapult burnt down to their axles (delegated)');
    expect(record.w).toBe(at('Missions').w);
    expect(at('People').w).toBeLessThan(record.w!);
    expect(at('People').y).toBeGreaterThan(record.y!);
    // Everything fits: no line counted out.
    expect(shown.some((w) => w.text.startsWith('and '))).toBe(false);
    // The save code shares its label's row, to its right.
    expect(at('ABCDE-12345').y).toBe(at('Save code').y);
    expect(at('ABCDE-12345').x).toBeGreaterThan(at('Save code').x!);
    // A 4:3 picture keeps one column, the code under its label.
    const narrow = textWidgets(resultsScreen(CTX, view(3)));
    const code = narrow.find((w) => w.text === 'ABCDE-12345')!;
    expect(code.y).toBeGreaterThan(narrow.find((w) => w.text === 'Save code')!.y!);
  });

  it('moves the columns apart for a line a half column would wrap, when both sides then fit (Q8)', () => {
    const long = 'Someone with a name too long for half';
    const base = view(2);
    const file = resultsScreen(wide, {
      ...base,
      changes: { ...base.changes, people: [{ ...person(0), name: long }, person(1)] },
    });
    const shown = textWidgets(file);
    const at = (text: string) => shown.find((w) => w.text === text)!;
    const line = at(`  ${long}: dead`);
    const half = Math.floor((at('Missions').w! - 8) / 2);
    expect(layoutText(FONT, line.text).width).toBeGreaterThan(half);
    // One line in its column, its heading as wide; the rest of the column as wide too.
    expect(layoutText(FONT, line.text, { width: line.w! }).lines).toHaveLength(1);
    expect(at('People').w).toBe(line.w);
    expect(at('  Person 1: dead').w).toBe(line.w);
    // A line no split can fit keeps the half columns, wrapped as before.
    const huge = resultsScreen(wide, {
      ...base,
      changes: { ...base.changes, people: [{ ...person(0), name: long.repeat(3) }] },
    });
    expect(textWidgets(huge).find((w) => w.text === 'People')!.w).toBe(half);
  });

  it('never ends a column with a heading: it moves on with its first line', () => {
    for (let people = 1; people < 24; people++) {
      const shown = textWidgets(resultsScreen(wide, view(people)));
      shown.forEach((w, i) => {
        if (!['Missions', 'People', 'Buildings'].includes(w.text)) return;
        const next = shown[i + 1]!;
        expect([w.text, next.x], `${people} people`).toEqual([w.text, w.x]);
        expect(next.text.startsWith('  ') || next.text.startsWith('and '), `${people}: ${w.text}`).toBe(true);
      });
    }
  });
});

describe('MissionScreens over a MissionLaunch (Engine 0.16 F5)', () => {
  it('shows nothing until a mission is offered, then the card with its window', () => {
    const { screens, step } = flow();
    expect(screens.kind()).toBeNull();
    step();
    step();
    expect(screens.kind()).toBe('card');
    expect(screens.windowLine()).toBe('Window closes in 18 ticks');
    expect(screens.draws().some((d) => d.kind === 'glyph')).toBe(true);
    step();
    expect(screens.windowLine()).toBe('Window closes in 17 ticks');
  });

  it('maps Delegate (keys: right, then confirm) to launch then delegate, and Continue on the result', () => {
    const { launch, screens, step } = flow();
    step();
    step();
    step(['right']);
    expect(screens.ui!.menu('main')!.focused).toBe('delegate');
    step([]);
    step(['jump']);
    expect(launch.game.steps.map((s) => s['action'])).toEqual(['open', 'delegate']);
    expect(launch.choice()).toBeNull();
    while (launch.records().length === 0) step();
    expect(screens.kind()).toBe('outcome');
    expect(texts(screens.ui?.file).slice(0, 3)).toEqual(['MISSION RESULT', 'Both burnt', '(delegated)']);
    step(['jump']);
    expect(screens.kind()).toBeNull();
  });

  it('maps a tap on Play to launch then play, and steps aside while the round is played', () => {
    const { launch, screens, step, point } = flow();
    step();
    step();
    step([], [point('play')]);
    expect(launch.game.steps.map((s) => s['action'])).toEqual(['open', 'play']);
    expect(launch.playing()).toBe(true);
    expect(screens.kind()).toBeNull();
    expect(screens.draws()).toEqual([]);
  });

  it('keeps a tap on a screen from the scene under it, and passes the others (Engine 0.16 F7)', () => {
    const { screens, step, point } = flow();
    step();
    step();
    const seen: { x: number; y: number }[][] = [];
    const scene = missionScreensScene(
      { update: (frame) => void seen.push(frameTaps(frame).map((t) => ({ x: t.x, y: t.y }))), render() {} },
      screens,
      () => ({ fill() {}, image() {}, glyph() {} }),
    );
    const keys = new ActionState();
    const tap = (p: { x: number; y: number }) => {
      keys.beginFrame(new Set(), [{ ...p, button: 'primary' as const }]);
      scene.update(keys, [keys]);
    };
    tap({ x: 2, y: 2 });
    tap(point('delegate'));
    expect(seen).toEqual([[{ x: 2, y: 2 }], []]);
  });

  it('keeps the keys a screen took from the scene under it, and passes the others (F review)', () => {
    const { launch, screens, step } = flow();
    step();
    step();
    const seen: string[][] = [];
    const scene = missionScreensScene(
      {
        update: (frame) => {
          seen.push((['right', 'jump', 'start'] as const).filter((a) => frame.pressed(a)));
          launch.update(frame);
        },
        render() {},
      },
      screens,
      () => ({ fill() {}, image() {}, glyph() {} }),
    );
    const keys = new ActionState();
    const press = (held: string[]) => {
      keys.beginFrame(new Set(held as never[]), []);
      scene.update(keys, [keys]);
      keys.beginFrame(new Set(), []);
      scene.update(keys, [keys]);
    };
    // A move on the card is still the scene's; the press that takes Delegate is not.
    press(['right']);
    expect(screens.ui!.menu('main')!.focused).toBe('delegate');
    press(['jump', 'start']);
    expect(launch.game.steps.map((s) => s['action'])).toEqual(['open', 'delegate']);
    expect(seen.filter((s) => s.length > 0)).toEqual([['right']]);
  });

  it("covers a step's gestures by the screen that took its taps, not the one its press left (F5 review)", () => {
    const { launch, screens, step, point } = flow();
    step();
    step();
    const at = point('delegate');
    step([], [at]);
    expect(launch.choice()).toBeNull();
    expect(screens.covers(at)).toBe(false);
    expect(screens.uncovered([{ type: 'tap', button: 'secondary', ...at, kind: 'touch' }])).toEqual([]);
    step();
    expect(screens.uncovered([{ type: 'tap', button: 'secondary', ...at, kind: 'touch' }])).toHaveLength(1);
  });

  it('focuses by the hovering mouse; taps off the card are left to the page', () => {
    const { screens, step, point, hover } = flow();
    step();
    step();
    hover(point('delegate'));
    step();
    expect(screens.ui!.menu('main')!.focused).toBe('delegate');
    expect(screens.covers(point('delegate'))).toBe(true);
    expect(screens.covers({ x: 2, y: 2 })).toBe(false);
    step([], [{ x: 2, y: 2 }]);
    expect(screens.kind()).toBe('card');
  });

  it('lists several offers to choose from; choosing opens one and the card offers Delegate only for a choice', () => {
    const { launch, screens, step, point } = flow((g) =>
      g.tick >= 2 && g.open === null ? ['raid', 'pay'] : [],
    );
    step();
    step();
    expect(texts(screens.ui?.file)).toEqual(['MISSIONS AVAILABLE', 'Choose one']);
    step([], [point('launch:pay')]);
    expect(launch.choice()).toBe('pay');
    expect(texts(screens.ui?.file)[0]).toBe('MISSION OPEN');
    expect(screens.ui!.menu('main')!.focused).toBe('delegate');
    expect(screens.windowLine()).toBe('');
    step(['jump']);
    expect(launch.game.steps.map((s) => `${String(s['action'])}:${String(s['mission'])}`)).toEqual([
      'open:pay',
      'delegate:pay',
    ]);
  });
});
