import { describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFullMap } from '@engine/core/present';
import { presentWorld, readWorld, RTS_DECOR, RtsPresentState, type RtsView } from '@kits/rts';
import { playRun, stateHash, type TickHash } from '../../engine/tools/headless-run';
import { loadRun, playView, viewMaker } from './view-play';

// A map's decoration is presentation only (docs/ROADMAP.md, 0.16 polish Q; Engine 0.16 polish Q,
// Q5): every run file of the RTS test game (games/rts-classic) and the RTS skirmish sample, played
// through the game's view with the kit's frames made each tick with a decoration grid over the
// whole map (a test pattern of every decoration character, not a game's dressing) and fog on,
// gives exactly the golden hashes and the final state of `pnpm cli run`, which presents nothing.

vi.setConfig({ testTimeout: 120_000 });

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLAYER = 'red';
const SIZE = { width: 320, height: 240 };
const CHARS = Object.keys(RTS_DECOR);

const runFiles = ['games/rts-classic', 'games/samples/rts-skirmish'].flatMap((dir) =>
  readdirSync(join(ROOT, dir, 'runs'))
    .filter((f) => f.endsWith('.run.json'))
    .sort()
    .map((f) => `${dir}/runs/${f}`),
);

/** A decoration the size of the view's map: every character in turn, cell by cell. */
function pattern(view: RtsView): string[] {
  const t = view.terrain!;
  return Array.from({ length: t.height }, (_, y) =>
    Array.from({ length: t.width }, (_, x) => CHARS[(x + y * 3) % CHARS.length]).join(''),
  );
}

describe('RTS map decoration never changes the state', () => {
  it('finds the rts-classic and rts-skirmish runs', () => {
    expect(runFiles).toContain('games/rts-classic/runs/battle.run.json');
    expect(runFiles.length).toBe(11);
  });

  it.each(runFiles)('%s: the same hashes with a decorated map', async (file) => {
    const { content, run, golden, cut } = loadRun(ROOT, file);
    const played = await playRun(ROOT, file, cut ? { untilTick: run.ticks } : {});
    if (!played.ok) throw new Error(JSON.stringify(played.errors));
    expect(played.value.hashes).toEqual(golden);
    const finalHash = stateHash(played.value.snapshot);
    const make = await viewMaker(ROOT, file, content, run);
    const state = new RtsPresentState();
    let decor: string[] | null = null;
    let layers = 0;
    let last = '';
    const hashes: TickHash[] = playView(make(), run, (game) => {
      const view = readWorld((game.snapshot() as { world: unknown }).world);
      decor ??= pattern(view);
      const frame = presentWorld(view, { faction: PLAYER, size: SIZE, state, fog: true, decor });
      if (frame.map !== undefined && isFullMap(frame.map) && frame.map.layers?.[0]?.name === 'decor')
        layers++;
      last = stateHash(game.snapshot());
    });
    expect(layers).toBeGreaterThan(0);
    expect(hashes).toEqual(golden);
    expect(last).toBe(finalHash);
  });
});
