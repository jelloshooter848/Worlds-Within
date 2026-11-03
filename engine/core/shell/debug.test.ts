import { describe, expect, it } from 'vitest';
import type { HeadlessGame, JsonObject } from '../headless';
import { frameTaps, type InputFrame } from '../input/input-manager';
import { NO_INPUT } from '../input/input-manager';
import { FixedLoop } from '../loop';
import { stateHash } from '../state-hash';
import { PageDebugHook } from './debug';

/** A game that keeps what it was given: the held actions per step, and the orders and missions. */
class FakeGame implements HeadlessGame {
  tick = 0;
  log: string[] = [];
  step(input: InputFrame): void {
    this.tick++;
    const taps = frameTaps(input).map((t) => ` tap ${t.x},${t.y} ${t.button}`);
    this.log.push(
      `step ${this.tick}: ${input.held('right') ? 'right' : '-'}${input.pressed('jump') ? '+jump' : ''}${taps.join('')}`,
    );
  }
  snapshot(): JsonObject {
    return { tick: this.tick, log: this.log };
  }
  order(order: JsonObject): string | null {
    this.log.push(`order ${String(order['id'])} at ${this.tick}`);
    return order['id'] === 2 ? 'no such unit' : null;
  }
  mission(step: JsonObject) {
    this.log.push(`mission ${String(step['action'])} at ${this.tick}`);
    return null;
  }
}

/** A page's loop in manual mode over a game, with the hook in its step, as `bootBrowserGame` does. */
function page(game: HeadlessGame | null, live: InputFrame = NO_INPUT) {
  let hook: PageDebugHook | null = null;
  let renders = 0;
  const loop: FixedLoop = new FixedLoop(
    {
      step: () => game?.step(hook!.frame(live)),
      render: () => void renders++,
    },
    60,
    4,
    { manual: true },
  );
  hook = new PageDebugHook({ advance: (n) => loop.advance(n), steps: () => loop.steps, game: () => game });
  return { ww: hook.api, loop, renders: () => renders };
}

const RUN = {
  ticks: 4,
  input: {
    steps: [
      { frame: 0, hold: ['right'] },
      { frame: 2, hold: ['right', 'jump'] },
    ],
  },
};

describe('FixedLoop in manual mode', () => {
  it('never starts on requestAnimationFrame; advance(n) takes exactly n steps and one render', () => {
    let steps = 0;
    let renders = 0;
    const loop = new FixedLoop({ step: () => void steps++, render: () => void renders++ }, 60, 4, {
      manual: true,
    });
    loop.start(); // no requestAnimationFrame in Node: this would throw if it ran
    loop.stepDivider = 2; // the assist's time scale does not thin out manual steps
    expect(loop.advance(5)).toBe(5);
    expect([steps, renders]).toEqual([5, 1]);
    expect(loop.advance(0)).toBe(5);
    expect([steps, renders]).toEqual([5, 2]);
  });
});

describe('the page step hook (window.__ww)', () => {
  it('steps, snapshots and hashes the game with the state hash', () => {
    const game = new FakeGame();
    const { ww, renders } = page(game);
    expect(ww.tick).toBe(0);
    expect(ww.hash()).toBe(stateHash({ tick: 0, log: [] }));
    expect(ww.step(3)).toBe(3);
    expect(ww.step()).toBe(4);
    expect(renders()).toBe(2);
    expect(ww.snapshot()).toMatchObject({ tick: 4 });
    expect(ww.hash()).toBe(stateHash(game.snapshot()));
    expect(ww.replaying).toBe(false);
    expect(() => ww.step(-1)).toThrow(/whole number/);
  });

  it("replays a run file's taps (gap D1) and maps picture points to the page (gap D13)", () => {
    const game = new FakeGame();
    const { ww } = page(game);
    expect(ww.toClient(1, 2)).toBeNull();
    ww.replay({
      ticks: 2,
      input: {
        steps: [],
        taps: [
          { frame: 1, x: 3, y: 4, button: 'secondary' },
          { frame: 1, x: 5, y: 6 },
        ],
      },
    });
    ww.step(2);
    expect(game.log).toEqual(['step 1: -', 'step 2: - tap 3,4 secondary tap 5,6 primary']);
    expect(() =>
      page(new FakeGame()).ww.replay({ ticks: 1, input: { steps: [], taps: [{ frame: 0 }] } }),
    ).toThrow(/input\.taps\.0/);
    const mapped = new PageDebugHook({
      advance: () => {},
      steps: () => 0,
      game: () => null,
      toClient: (x, y) => ({ x: x * 2, y: y * 2 + 10 }),
    });
    expect(mapped.api.toClient(3, 4)).toEqual({ x: 6, y: 18 });
  });

  it('has no hash or snapshot without a game', () => {
    const { ww } = page(null);
    ww.step(2);
    expect([ww.hash(), ww.snapshot()]).toEqual([null, null]);
  });

  it("replays a run file's input in place of the live frame, frame 0 on the first step", () => {
    const game = new FakeGame();
    const live = { ...NO_INPUT, held: () => true }; // the keyboard holding everything: ignored
    const { ww } = page(game, live);
    expect(ww.replay(RUN)).toEqual({ ticks: 4 });
    expect(ww.replaying).toBe(true);
    ww.step(4);
    expect(game.log).toEqual(['step 1: right', 'step 2: right', 'step 3: right+jump', 'step 4: right']);
  });

  it('hands a tick its orders, then its mission steps, before the step from it; refusals are kept', () => {
    const game = new FakeGame();
    const { ww } = page(game);
    ww.replay({
      ticks: 3,
      orders: [
        { tick: 0, id: 1, type: 'stop' },
        { tick: 1, id: 2, type: 'stop' },
      ],
      missions: [{ tick: 1, mission: 'raid', action: 'open' }],
    });
    ww.step(3);
    expect(game.log).toEqual([
      'order 1 at 0',
      'step 1: -',
      'order 2 at 1',
      'mission open at 1',
      'step 2: -',
      'step 3: -',
    ]);
    expect(ww.refused).toEqual([{ tick: 1, kind: 'order', error: 'no such unit' }]);
  });

  it('refuses what the page cannot replay', () => {
    const fresh = () => page(new FakeGame()).ww;
    const stepped = fresh();
    stepped.step(1);
    expect(() => stepped.replay(RUN)).toThrow(/at tick 1/);
    expect(() => fresh().replay([])).toThrow(/JSON object/);
    expect(() => fresh().replay({ ...RUN, start: { stage: 1 } })).toThrow(/"start"/);
    expect(() => fresh().replay({ ...RUN, from: 'a.run.json' })).toThrow(/"from"/);
    expect(() => fresh().replay({ ...RUN, world: 'w.json' })).toThrow(/"world"/);
    expect(() => fresh().replay({ ...RUN, disableRules: ['stomp'] })).toThrow(/disableRules/);
    expect(() => fresh().replay({ input: RUN.input })).toThrow(/"ticks"/);
    expect(() => fresh().replay({ ticks: 1, input: { steps: [{ frame: 0 }] } })).toThrow(/input.steps.0/);
    expect(() => page(null).ww.replay({ ticks: 1, orders: [{ tick: 0, id: 1 }] })).toThrow(/"orders"/);
    expect(() => page(null).ww.replay({ ticks: 1, missions: [{ tick: 0 }] })).toThrow(/"missions"/);
    // Nothing above started a replay.
    const ww = fresh();
    expect(() => ww.replay({ ...RUN, start: { stage: 1 } })).toThrow();
    expect(ww.replaying).toBe(false);
  });
});

describe('recording through the hook (Engine 0.14 T9, gap M19)', () => {
  /** A game that keeps whether recording was asked, and gives one recording. */
  class RecordingGame extends FakeGame {
    asked: boolean[] = [];
    recordRounds(on: boolean): void {
      this.asked.push(on);
    }
    roundRecordings() {
      return [
        {
          mission: 'raid',
          tick: 2,
          ticks: 3,
          done: true,
          input: { steps: [{ frame: 0, hold: ['attack' as const] }] },
        },
      ];
    }
  }

  it('turns recording on in the game now and before every step, and copies its recordings', () => {
    const game = new RecordingGame();
    const { ww } = page(game);
    expect(ww.recording).toBe(false);
    expect(ww.record()).toBe(true);
    expect(ww.recording).toBe(true);
    ww.step(2);
    expect(game.asked).toEqual([true, true, true]);
    const got = ww.recordings();
    expect(got).toEqual(game.roundRecordings());
    got[0]!.input.steps.length = 0; // a copy: the game's is untouched
    expect(game.roundRecordings()[0]!.input.steps).toHaveLength(1);
    expect(ww.record(false)).toBe(true);
    ww.step(1);
    expect(game.asked).toEqual([true, true, true, false]);
  });

  it('says false for a game that cannot record, and gives no recordings', () => {
    const { ww } = page(new FakeGame());
    expect(ww.record()).toBe(false);
    expect(ww.recording).toBe(true);
    expect(ww.recordings()).toEqual([]);
    expect(page(null).ww.recordings()).toEqual([]);
  });
});
