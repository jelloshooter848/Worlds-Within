import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HeadlessGame } from '@engine/core/headless';
import { missionHostEvents } from '@engine/core/mission-host';
import { playRun } from '../../engine/tools/headless-run';

// Engine 0.15 T6 (gap M21): the mini siege's mission events come from the engine's MissionHost,
// one step's at a time, and are never in the snapshot. Played through the tools' own run loop
// (`playRun`, the loop `pnpm cli run` uses), each run file's host events land on the game ticks
// its assertions name, and the run still passes with its golden hashes (events move no hash).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Plays a mini siege run file, keeping the host's events with the game tick of the step. */
async function eventsOf(name: string) {
  const file = `games/samples/mini-siege/runs/${name}.run.json`;
  let game: HeadlessGame | null = null;
  const seen: { tick: number; event: unknown }[] = [];
  const played = await playRun(ROOT, file, {
    prepare: (g) => void (game = g),
    onTick: (tick) => {
      const events = (game as { events?: readonly unknown[] } | null)?.events ?? [];
      if (tick > 0) for (const event of missionHostEvents(events)) seen.push({ tick, event });
    },
  });
  if (!played.ok) throw new Error(JSON.stringify(played.errors));
  const golden = JSON.parse(
    readFileSync(new URL(`../../games/samples/mini-siege/runs/${name}.hashes.json`, import.meta.url), 'utf8'),
  ) as { hashes: unknown };
  return { played: played.value, seen, golden };
}

describe("the mini siege's mission events (gap M21)", () => {
  it('played: open with the step after tick 40, the round end at 446 and the commit at 566', async () => {
    const { played, seen, golden } = await eventsOf('played');
    expect(played.failures).toEqual([]);
    expect(played.hashes).toEqual(golden.hashes);
    expect(seen).toEqual([
      { tick: 41, event: { type: 'mission-open', mission: 'sabotage', play: 'mission-room' } },
      {
        tick: 446,
        event: { type: 'mini-game-end', mission: 'sabotage', game: 'mission-room', result: 'pass' },
      },
      {
        tick: 566,
        event: { type: 'mission-commit', mission: 'sabotage', outcome: 'both-burnt', resolution: 'played' },
      },
    ]);
  });

  it('delegated: open and the commit at world tick 160, with no round', async () => {
    const { played, seen, golden } = await eventsOf('delegated');
    expect(played.failures).toEqual([]);
    expect(played.hashes).toEqual(golden.hashes);
    expect(seen).toEqual([
      { tick: 41, event: { type: 'mission-open', mission: 'sabotage', play: 'mission-room' } },
      {
        tick: 160,
        event: { type: 'mission-commit', mission: 'sabotage', outcome: 'ram-burnt', resolution: 'delegated' },
      },
    ]);
  });
});
