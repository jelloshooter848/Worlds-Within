import { describe, expect, it } from 'vitest';
import { timelineSchema, type Timeline } from '@engine/sim/index';
import { placeWorldTick, timelineLayout, timelineMarkers, timelineText } from './timeline';

// The timeline viewer's layout model in Node (Engine 0.14 T11): the mini siege's played run's
// record (as `pnpm cli timeline` prints it at its last tick) laid out on the game-tick axis, a
// record part-way through (a span still frozen, a mission open, windows past the clock), the run's
// own marks, and the text form.

/** `pnpm -s cli timeline games/samples/mini-siege/runs/played.run.json --json`'s `timeline`. */
const PLAYED: Timeline = timelineSchema.parse({
  format: 'worlds-within/timeline',
  version: 1,
  worldTick: 260,
  logFrom: 0,
  clock: [
    { game: 0, world: 0 },
    { game: 40, world: 40 },
    { game: 446, world: 40 },
    { game: 666, world: 260 },
  ],
  frozen: [{ event: 'siege', by: 'mission:sabotage', from: 40, to: 160 }],
  experience: [{ mission: 'sabotage', from: 40, ticks: 406 }],
  opportunities: [
    {
      id: 'fortify-window',
      mission: 'fortify',
      opens: 5,
      closes: 30,
      status: 'closed',
      history: [
        { status: 'waiting', by: 'scenario', at: 0 },
        { status: 'offered', by: 'time', at: 5 },
        { status: 'closed', by: 'time', at: 30 },
      ],
    },
    {
      id: 'sabotage-window',
      mission: 'sabotage',
      opens: 20,
      closes: 200,
      status: 'taken',
      history: [
        { status: 'waiting', by: 'scenario', at: 0 },
        { status: 'offered', by: 'time', at: 20 },
        { status: 'taken', by: 'mission:sabotage', at: 40 },
      ],
    },
  ],
  missions: [
    {
      mission: 'sabotage',
      status: 'committed',
      openTick: 40,
      commitTick: 160,
      resolution: 'played',
      outcome: 'both-burnt',
      experienceTicks: 0,
    },
  ],
});

describe('timelineLayout', () => {
  const layout = timelineLayout(PLAYED, { gameTick: 666, ticks: 666 });
  const row = (id: string) => layout.rows.find((r) => r.id === id)!;

  it('lays the rows out in order: run, clock, frozen, experience, opportunities, missions', () => {
    expect(layout.rows.map((r) => r.id)).toEqual([
      'run',
      'clock',
      'frozen:siege:40',
      'experience:sabotage',
      'opportunity:fortify-window',
      'opportunity:sabotage-window',
      'mission:sabotage',
    ]);
    expect(layout).toMatchObject({ ticks: 666, gameTick: 666, worldTick: 260, logFrom: 0 });
  });

  it('shows where the world moves and where it stands still', () => {
    expect(row('clock').spans.map((s) => [s.from, s.to, s.kind, s.worldFrom, s.worldTo])).toEqual([
      [0, 40, 'moving', 0, 40],
      [40, 446, 'still', 40, 40],
      [446, 666, 'moving', 40, 260],
    ]);
  });

  it('places world ticks at the game tick the world reached them', () => {
    // The siege is frozen from world tick 40 (game 40) to 160 (game 566, after the round's 406).
    expect(row('frozen:siege:40').spans).toEqual([
      expect.objectContaining({ from: 40, to: 566, kind: 'frozen', ongoing: false, projected: false }),
    ]);
    expect(row('frozen:siege:40').markers.map((m) => [m.kind, m.game, m.world])).toEqual([
      ['freeze', 40, 40],
      ['unfreeze', 566, 160],
    ]);
    expect(row('experience:sabotage').spans).toEqual([
      expect.objectContaining({ from: 40, to: 446, kind: 'experience' }),
    ]);
  });

  it('shows each opportunity window with its status changes and causes', () => {
    const sabotage = row('opportunity:sabotage-window');
    expect(sabotage.spans).toEqual([
      expect.objectContaining({
        from: 20,
        to: 606,
        kind: 'taken',
        ongoing: false,
        worldFrom: 20,
        worldTo: 200,
      }),
    ]);
    expect(sabotage.markers.map((m) => m.label)).toEqual([
      'sabotage-window waiting by scenario',
      'sabotage-window offered by time',
      'sabotage-window taken by mission:sabotage',
    ]);
    expect(row('opportunity:fortify-window').markers.at(-1)).toMatchObject({
      game: 30,
      label: 'fortify-window closed by time',
    });
  });

  it('marks a mission open and its commit with the outcome', () => {
    const mission = row('mission:sabotage');
    expect(mission.spans[0]).toMatchObject({ from: 40, to: 566, kind: 'committed', ongoing: false });
    expect(mission.markers.map((m) => [m.kind, m.game, m.label])).toEqual([
      ['open', 40, 'open sabotage'],
      ['commit', 566, 'commit sabotage: both-burnt (played)'],
    ]);
  });

  it('projects world ticks past the clock and leaves open spans running to now', () => {
    const mid: Timeline = {
      ...PLAYED,
      worldTick: 40,
      clock: [
        { game: 0, world: 0 },
        { game: 40, world: 40 },
        { game: 100, world: 40 },
      ],
      frozen: [{ event: 'siege', by: 'mission:sabotage', from: 40, to: null }],
      missions: [{ ...PLAYED.missions[0]!, status: 'open', resolution: null, outcome: null }],
    };
    const at = timelineLayout(mid, { gameTick: 100, ticks: 666 });
    const frozen = at.rows.find((r) => r.kind === 'frozen')!;
    expect(frozen.spans[0]).toMatchObject({ from: 40, to: 100, ongoing: true });
    const mission = at.rows.find((r) => r.kind === 'mission')!;
    // The commit at world tick 160 is past the clock: 100 + (160 - 40) game ticks if the world moves on.
    expect(mission.spans[0]).toMatchObject({
      from: 40,
      to: 220,
      kind: 'open',
      ongoing: true,
      projected: true,
    });
    expect(mission.markers.map((m) => m.kind)).toEqual(['open']);
    expect(placeWorldTick(mid.clock, 160)).toEqual({ game: 220, projected: true });
    expect(placeWorldTick(null, 7)).toEqual({ game: 7, projected: false });
  });

  it("adds the run's marks: now, a replay's failing tick and the tick before, a hash mismatch", () => {
    const marked = timelineLayout(
      PLAYED,
      { gameTick: 300, ticks: 666 },
      { failure: { tick: 300, label: 'failed assertion x eq 1' }, mismatch: { tick: 280, label: 'hash' } },
    );
    expect(marked.rows[0]!.markers.map((m) => [m.kind, m.game])).toEqual([
      ['mismatch', 280],
      ['before', 299],
      ['now', 300],
      ['failure', 300],
    ]);
    const all = timelineMarkers(marked);
    expect(all.map((m) => m.game)).toEqual([...all.map((m) => m.game)].sort((a, b) => a! - b!));
    expect(all.find((m) => m.kind === 'commit')).toMatchObject({ row: 'mission:sabotage', game: 566 });
  });
});

describe('timelineText', () => {
  it('prints one block per row and one line per marker', () => {
    const text = timelineText(timelineLayout(PLAYED, { gameTick: 666, ticks: 666 }));
    const lines = text.split('\n');
    expect(lines[0]).toBe('timeline at game tick 666 of 666 (world tick 260, log from 0)');
    expect(lines).toContain(
      'world clock: game 0-40 world 0-40 | game 40-446 world stands at 40 | game 446-666 world 40-260',
    );
    expect(lines).toContain('frozen siege: game 40-566 siege frozen by mission:sabotage');
    expect(lines).toContain('  game 40 (world 40) open: open sabotage');
    expect(lines).toContain('  game 566 (world 160) commit: commit sabotage: both-burnt (played)');
    expect(lines).toContain('  game 40 (world 40) opportunity: sabotage-window taken by mission:sabotage');
  });
});
