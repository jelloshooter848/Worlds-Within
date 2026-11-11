import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson } from '@engine/core/headless';
import type { Renderer } from '@engine/core/gfx/renderer';
import { ActionState, InputManager, type InputFrame } from '@engine/core/input/input-manager';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { SceneStack } from '@engine/core/scene';
import { missionScreensScene, type MissionScreens } from '@engine/core/shell/mission-screens';
import { contentFonts, type UiDraw, type UiPainter, type UiScreen } from '@engine/core/ui';
import { loadMiniSiege } from './content';
import type { MiniSiegeGame } from './headless';
import { siegePicture } from './picture';
import { SiegePlay, type GestureFeed } from './play';

// The mission flow in the picture (Engine 0.16 F5): the shell's `MissionScreens` over the mini
// siege's `MissionLaunch`, as a page draws it over the battle: the briefing, the mission card with
// the sim's facts (cost on the clock, hero, foes, window), Play and Delegate pressed by keys, a
// gamepad, the mouse and taps, the dawn's captive choices, the mission result and the entry's
// results with the world's changes (the sim's `worldChanges`) for the delegated, played and quit
// sieges. Nothing here moves the world: the runs' hashes are the same as without the screens.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadMiniSiege(readGameFiles(ROOT)));
const fonts = contentFonts(content);
const NONE: InputFrame = new ScriptedInput({ steps: [] });
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
const lastHash = (name: string) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes.at(-1)!.hash;
const recordedRound = () =>
  (
    JSON.parse(readFileSync(new URL('./runs/played.run.json', import.meta.url), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

/** The page: the battle's scene with the mission screens over it, drawing every step. */
function page(
  hold = true,
  cursor: () => { x: number; y: number } | null = () => null,
  source: GestureFeed | null = null,
) {
  // As on the page: the battle reads the pointer's gestures without those on a screen.
  let screens: MissionScreens<MiniSiegeGame> | null = null;
  const reached: PointerGesture[] = [];
  const play = new SiegePlay({
    content,
    seed: content.manifest.start.seed,
    pointer: source && {
      gestures: () => {
        const kept = screens?.uncovered(source.gestures()) ?? source.gestures();
        reached.push(...kept);
        return kept;
      },
    },
    stepsPerTick: 1,
    hold,
  });
  screens = play.missionScreens({
    fonts,
    pointer: { cursor },
    keys: () => ({ up: '↑', down: '↓', jump: 'Z', attack: 'X' }),
  });
  const stack = new SceneStack();
  const presenter = new NullPresenter({ validate: true, freeze: true });
  const drawn: UiDraw[][] = [];
  let frame: UiDraw[] = [];
  const painter: UiPainter = {
    fill: (d) => frame.push(d),
    image: (d) => frame.push(d),
    glyph: (d) => frame.push(d),
  };
  stack.push(
    missionScreensScene(
      play.scene(stack, () => siegePicture(presenter, content, play.ui)),
      screens,
      () => painter,
    ),
  );
  const step = (input: InputFrame = NONE) => {
    stack.update([input]);
    frame = [];
    stack.render({} as Renderer);
    drawn.push(frame);
  };
  return { play, screens: screens as MissionScreens<MiniSiegeGame>, stack, step, drawn, reached };
}
type Page = ReturnType<typeof page>;

/** Every text widget the screen shows, in file order. */
function texts(ui: UiScreen | null): string[] {
  return (ui?.file.widgets ?? []).flatMap((w) => (w.type === 'text' ? [w.text] : []));
}

/** A frame with `held` actions and taps (one `ActionState` per page, so presses are edges). */
function frameOf(state: ActionState, held: Action[] = [], taps: { x: number; y: number }[] = []): InputFrame {
  state.beginFrame(
    new Set(held),
    taps.map((t) => ({ ...t, button: 'primary' as const })),
  );
  return state;
}

/** The centre of a menu item's box on the screen showing now. */
function itemPoint(screens: MissionScreens<MiniSiegeGame>, item: string): { x: number; y: number } {
  const box = screens.ui!.itemBox('main', item)!;
  return { x: box.x + Math.floor(box.w / 2), y: box.y + Math.floor(box.h / 2) };
}

/** Begins the entry and steps the battle to world tick 40 (the sabotage alone is offered). */
function toCard(p: Page): void {
  p.step();
  if (p.play.launch.held()) {
    p.screens.press('begin');
    p.step();
  }
  while (p.play.tick < 40) p.step();
  expect(p.screens.kind()).toBe('card');
}

function toEnd(p: Page): void {
  while (p.play.launch.ended() === null) p.step();
  p.step();
}

describe('the mission screens in the picture (Engine 0.16 F5)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the briefing while the siege is held, begun by a key press', () => {
    const p = page();
    p.step();
    expect(p.screens.kind()).toBe('briefing');
    const shown = texts(p.screens.ui);
    expect(shown[0]).toBe('The siege');
    expect(shown).toContain(p.play.launch.briefing()!.text);
    expect(p.screens.ui!.menu('main')!.items.map((i) => i.id)).toEqual(['begin']);
    expect(p.drawn.at(-1)!.some((d) => d.kind === 'glyph')).toBe(true);
    // Z (`jump`) confirms: the launch begins the entry on that step; nothing else moved.
    const keys = new ActionState();
    p.step(frameOf(keys, ['jump']));
    expect(p.play.launch.held()).toBe(false);
    p.step(frameOf(keys));
    expect(p.play.tick).toBeGreaterThan(0);
    expect(p.screens.kind()).toBeNull();
  });

  it("shows the sabotage's card: cost in hours, hero, foes, window, Play and Delegate", () => {
    const p = page();
    toCard(p);
    const shown = texts(p.screens.ui);
    expect(shown).toEqual([
      'MISSION AVAILABLE',
      'Burn the siege engines',
      "Slip out under the walls with Captain Hale and burn the raiders' ram and catapult before they breach the hall.",
      'Costs 2 hours of world time',
      'Hero Captain Hale',
      'Foes ram, catapult, Grell, Vosk',
    ]);
    // The window: the sabotage's opportunity closes at world tick 200.
    expect(p.play.tick).toBe(40);
    expect(p.screens.windowLine()).toBe('Window closes in 160 ticks');
    expect(p.drawn.at(-1)!.some((d) => d.kind === 'glyph')).toBe(true);
    expect(p.screens.cardMissions()).toEqual(['sabotage']);
    const menu = p.screens.ui!.menu('main')!;
    expect(menu.items.map((i) => [i.id, i.label, i.disabled ?? false])).toEqual([
      ['play', 'Play', false],
      ['delegate', 'Delegate', false],
    ]);
    // The card pauses nothing: the battle steps on under it.
    p.step();
    expect(p.play.tick).toBe(41);
    expect(p.screens.windowLine()).toBe('Window closes in 159 ticks');
    expect(p.screens.facts(p.play.launch.missionDef('sabotage')!)).toEqual({
      hero: 'Captain Hale',
      foes: 'ram, catapult, Grell, Vosk',
      ticksLeft: 159,
    });
  });

  it("lists the fortify and the sabotage together while both windows are open, and the fortify's card alone", () => {
    const p = page(false);
    while (p.play.tick < 10) p.step();
    p.step();
    expect(texts(p.screens.ui)).toEqual([
      'MISSION AVAILABLE',
      'Man the walls',
      "Man the walls with the hall's gold before the raiders reach the village.",
      'Costs 30 min of world time',
    ]);
    while (p.play.tick < 21) p.step();
    p.step();
    expect(p.screens.cardMissions()).toEqual(['fortify', 'sabotage']);
    expect(texts(p.screens.ui)).toEqual(['MISSIONS AVAILABLE', 'Choose one']);
    expect(p.screens.ui!.menu('main')!.items.map((i) => i.label)).toEqual([
      'Man the walls',
      'Burn the siege engines',
    ]);
  });

  it('delegates by a tap on Delegate: the launch opens and delegates in one step, then the result card', () => {
    const p = page();
    toCard(p);
    const tick = p.play.tick;
    p.step(frameOf(new ActionState(), [], [itemPoint(p.screens, 'delegate')]));
    expect(p.play.launch.choice()).toBeNull();
    while (p.play.launch.records().length === 0) p.step();
    p.step();
    expect(p.screens.kind()).toBe('outcome');
    const shown = texts(p.screens.ui);
    expect(shown.slice(0, 3)).toEqual([
      'MISSION RESULT',
      p.play.launch.outcomeTitle('sabotage', p.play.launch.records()[0]!.outcome),
      '(delegated)',
    ]);
    expect(p.play.launch.records()[0]!.openTick).toBe(tick);
    // Continue closes it (the world never waited).
    p.step(frameOf(new ActionState(), [], [itemPoint(p.screens, 'continue')]));
    expect(p.screens.kind()).toBeNull();
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('delegated'));
  });

  it('delegates by keys and by a gamepad, the same as by a tap', () => {
    for (const device of ['keyboard', 'gamepad'] as const) {
      const p = page();
      toCard(p);
      const input = new InputManager(1);
      let codes = new Set<string>();
      input.addSource(device, { poll: () => codes });
      const press = (code: string) => {
        codes = new Set([code]);
        input.beginFrame();
        p.step(input.players[0]!);
        codes = new Set();
        input.beginFrame();
        p.step(input.players[0]!);
      };
      press(device === 'keyboard' ? 'ArrowRight' : 'pad:15');
      expect(p.screens.ui!.menu('main')!.focused, device).toBe('delegate');
      press(device === 'keyboard' ? 'KeyZ' : 'pad:0');
      expect(p.play.launch.choice(), device).toBeNull();
      expect(p.play.launch.playing(), device).toBe(false);
      while (p.play.launch.records().length === 0) p.step();
      expect(p.play.launch.records()[0]!.resolution, device).toBe('delegated');
    }
  });

  it("keeps the key or pad press that takes Play from the round's first step (F review)", () => {
    // Z, Space or pad A (jump) places a tower in the walls round, Enter or pad Start starts the
    // wave: the press that takes Play on the card must start the round and nothing more.
    for (const key of ['jump', 'start'] as const) {
      const p = page(false);
      while (p.play.tick < 11) p.step();
      expect(p.screens.cardMissions(), key).toEqual(['fortify']);
      expect(p.screens.ui!.menu('main')!.focused, key).toBe('play');
      p.step(frameOf(new ActionState(), [key]));
      expect(p.play.launch.playing(), key).toBe(true);
      const kit = p.play.game.miniGame()!.snapshot()['kit'] as Record<string, unknown>;
      expect(kit, key).toMatchObject({ gold: 100, towers: 0, wave: 0 });
    }
  });

  it('plays by a mouse click on Play (hover then tap): the round starts and the screens step aside', () => {
    let cursor: { x: number; y: number } | null = null;
    const p = page(true, () => cursor);
    toCard(p);
    const play = itemPoint(p.screens, 'play');
    cursor = play;
    p.step();
    expect(p.screens.ui!.menu('main')!.focused).toBe('play');
    expect(p.screens.covers(play)).toBe(true);
    expect(p.screens.covers({ x: 4, y: 4 })).toBe(false);
    p.step(frameOf(new ActionState(), [], [play]));
    expect(p.play.launch.playing()).toBe(true);
    expect(p.screens.kind()).toBeNull();
    expect(p.drawn.at(-1)!.length).toBe(0);
  });

  it("keeps the taps that close a screen from the battle's controls: Begin, Delegate and Continue", () => {
    // The pointer's gestures for the next step: the battle reads them after the screens took the
    // frame's taps, when a press may already have closed the screen under them.
    let pending: PointerGesture[] = [];
    const p = page(true, () => null, {
      gestures: () => {
        const out = pending;
        pending = [];
        return out;
      },
    });
    const keys = new ActionState();
    const tap = (at: { x: number; y: number }, button: 'primary' | 'secondary' = 'primary') => {
      pending = [{ type: 'tap', button, ...at, kind: 'mouse' }];
      p.step(frameOf(keys, [], [at]));
    };
    p.step();
    expect(p.screens.kind()).toBe('briefing');
    tap(itemPoint(p.screens, 'begin'));
    expect(p.play.launch.held()).toBe(false);
    while (p.play.tick < 40) p.step();
    expect(p.screens.kind()).toBe('card');
    const issue = vi.spyOn(p.play.game.rts, 'issue');
    // A long-press (secondary) on Delegate would be an order to the selection if it reached the battle.
    tap(itemPoint(p.screens, 'delegate'), 'secondary');
    expect(p.play.launch.choice()).toBeNull();
    while (p.screens.kind() !== 'outcome') p.step();
    tap(itemPoint(p.screens, 'continue'));
    expect(p.screens.kind()).not.toBe('outcome');
    expect(p.reached).toEqual([]);
    expect(issue).not.toHaveBeenCalled();
    // A tap off the screens is still the battle's.
    tap({ x: 4, y: 4 });
    expect(p.reached).toEqual([{ type: 'tap', button: 'primary', x: 4, y: 4, kind: 'mouse' }]);
  });

  it('keeps Play disabled for a choice without a round: the dawn lists the captive choices', () => {
    const p = page(false);
    toCard(p);
    p.screens.press('play');
    const quit = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
    quit.next();
    p.step(quit);
    // The round quit at once: driven off, the captain captured.
    expect(p.play.launch.playing()).toBe(false);
    toEnd(p);
    p.screens.press('continue');
    p.step();
    p.step();
    expect(p.play.scenario).toBe('dawn');
    expect(p.screens.kind()).toBe('card');
    expect(texts(p.screens.ui)).toEqual(['MISSIONS AVAILABLE', 'Choose one']);
    expect(p.screens.ui!.menu('main')!.items.map((i) => i.id)).toEqual([
      'launch:exchange-captain',
      'launch:leave-captain',
      'launch:rescue-captain',
    ]);
    p.step(frameOf(new ActionState(), [], [itemPoint(p.screens, 'launch:exchange-captain')]));
    expect(p.play.launch.choice()).toBe('exchange-captain');
    p.step();
    expect(texts(p.screens.ui).slice(0, 4)).toEqual([
      'MISSION OPEN',
      'Pay for the captain',
      'Pay the raiders 80 gold to send the captain back.',
      'Costs 10 min of world time',
    ]);
    const items = p.screens.ui!.menu('main')!.items;
    expect(items.map((i) => [i.id, i.disabled ?? false])).toEqual([
      ['play', true],
      ['delegate', false],
    ]);
    expect(p.screens.ui!.menu('main')!.focused).toBe('delegate');
    p.screens.press('delegate');
    p.step();
    expect(p.play.launch.choice()).toBeNull();
  });
});

/** Runs the siege to its end through the screens: `how` the sabotage is resolved at tick 40. */
function siege(how: 'delegate' | 'play' | 'quit'): Page {
  const p = page();
  toCard(p);
  // The press and the round's first frame are one loop step, as on the page.
  p.screens.press(how === 'delegate' ? 'delegate' : 'play');
  if (how === 'delegate') p.step();
  else if (how === 'quit') {
    const quit = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
    quit.next();
    p.step(quit);
  } else if (how === 'play') {
    const keys = new ScriptedInput(recordedRound());
    do {
      keys.next();
      p.step(keys);
    } while (p.play.launch.playing());
  }
  toEnd(p);
  return p;
}

describe('the results screen: what changed in the world (Engine 0.16 F5)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const cases = [
    {
      how: 'delegate',
      run: 'delegated',
      records: ['The ram burnt, the catapult saved by its crew (delegated)'],
      losses: ['Raiders: 4 raiders, ram, Grell, Vosk', 'Village: 2 soldiers'],
      people: ['Grell: dead', 'Vosk: dead'],
      buildings: ['Hall: 120 hp lost (280/400)'],
    },
    {
      how: 'quit',
      run: 'quit',
      records: ['Driven off, the captain wounded and taken (quit)'],
      losses: ['Raiders: 4 raiders, Grell, Vosk', 'Village: 3 soldiers'],
      people: ['Captain Hale: captured by raiders', 'Grell: dead', 'Vosk: dead'],
      buildings: ['Hall: 288 hp lost (112/400)'],
    },
  ] as const;

  for (const c of cases) {
    it(`lists the ${c.run} siege's changes, the save code and Continue, the world as the run's`, () => {
      const p = siege(c.how);
      expect(hash(p.play.game.snapshot())).toBe(lastHash(c.run));
      expect(p.screens.kind()).toBe('results');
      const changes = p.screens.changes(0);
      expect(changes.records.map((r) => r.resolution)).toEqual([c.how === 'delegate' ? 'delegated' : 'quit']);
      const shown = texts(p.screens.ui);
      const ended = p.play.launch.ended()!;
      expect(shown.slice(0, 2)).toEqual(['The siege', ended.verdict]);
      // The 16:9 picture (Engine 0.16 F6) has room for every line (Engine 0.16 F9, gap M39: the
      // missions span the panel, the rest flow down two columns and no heading ends a column), the
      // captain's fate among them.
      const all = [...c.records, ...c.losses, ...c.people, ...c.buildings];
      expect(all.filter((line) => shown.includes(`  ${line}`))).toEqual(all);
      expect(shown.find((t) => t.startsWith('and '))).toBeUndefined();
      expect(shown.filter((t) => ['Missions', 'Losses', 'People', 'Buildings'].includes(t))).toEqual([
        'Missions',
        'Losses',
        'People',
        'Buildings',
      ]);
      const at = (text: string) =>
        p.screens.ui!.file.widgets.find((w) => w.type === 'text' && w.text === text)!;
      // The record spans the panel; each heading sits in the column of its first line.
      expect(at(`  ${c.records[0]}`).w).toBeGreaterThan(at(`  ${c.losses[0]}`).w!);
      for (const [heading, line] of [
        ['Losses', c.losses[0]],
        ['People', c.people[0]],
        ['Buildings', c.buildings[0]],
      ] as const)
        expect(at(heading).x, heading).toBe(at(`  ${line}`).x);
      // The save code shares its label's row.
      expect(at(ended.code!).y).toBe(at('Save code').y);
      expect(shown.slice(-3, -1)).toEqual(['Save code', ended.code]);
      expect(shown.at(-1)).toBe('↑↓ choose   Z select');
      expect(p.screens.ui!.menu('main')!.items.map((i) => i.id)).toEqual(['continue']);
      // Continue presses the launch's: the dawn, held with its briefing.
      p.step(frameOf(new ActionState(), ['jump']));
      p.step();
      expect(p.play.scenario).toBe('dawn');
      expect(p.screens.kind()).toBe('briefing');
      expect(texts(p.screens.ui)[0]).toBe('The dawn assault');
    });
  }

  it("lists the played siege's changes: both engines burnt, the captain hurt but standing", () => {
    const p = siege('play');
    expect(hash(p.play.game.snapshot())).toBe(lastHash('played'));
    const changes = p.screens.changes(0);
    expect(changes.records.map((r) => [r.outcome, r.resolution])).toEqual([['both-burnt', 'played']]);
    expect(changes.losses.find((l) => l.faction === 'raiders')!.units.map((u) => u.type)).toEqual(
      expect.arrayContaining(['ram', 'catapult']),
    );
    expect(changes.people.some((x) => x.name === 'Captain Hale')).toBe(false);
    expect(texts(p.screens.ui)).toContain('  The ram and the catapult burnt (played)');
  });
});
