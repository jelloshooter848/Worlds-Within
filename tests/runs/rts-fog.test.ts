import { describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '@engine/core/content/validate';
import { presentFrameSchema } from '@engine/core/present';
import { presentWorld, readWorld, RtsPresentState, type RtsView } from '@kits/rts';
import { playRun, stateHash, type TickHash } from '../../engine/tools/headless-run';
import { loadRun, playView, viewMaker } from './view-play';

// Fog of war is presentation only (docs/ROADMAP.md, 0.16 part D, "Done when"; Engine 0.16 part
// D, D5): every run file of the RTS test game (games/rts-classic) and the RTS skirmish sample,
// played through the game's view with the kit's frames made each tick with fog off and with fog
// on (the player's memory kept in one `RtsPresentState`), gives exactly the golden hashes and the
// final state of `pnpm cli run`, which presents nothing. The fogged frames pass the schema, and
// over the runs the fog hides something (an enemy unit out of sight), so the fog really ran.

vi.setConfig({ testTimeout: 120_000 });

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLAYER = 'red';
const SIZE = { width: 320, height: 240 };

const runFiles = ['games/rts-classic', 'games/samples/rts-skirmish'].flatMap((dir) =>
  readdirSync(join(ROOT, dir, 'runs'))
    .filter((f) => f.endsWith('.run.json'))
    .sort()
    .map((f) => `${dir}/runs/${f}`),
);

/** The kit's view of a game's snapshot (`{ world, kit }`). */
const viewOf = (snapshot: unknown): RtsView => readWorld((snapshot as { world: unknown }).world);

let hidden = 0;

describe('RTS fog of war never changes the state', () => {
  it('finds the rts-classic and rts-skirmish runs', () => {
    expect(runFiles).toContain('games/rts-classic/runs/battle.run.json');
    expect(runFiles).toContain('games/samples/rts-skirmish/runs/fog.run.json');
    expect(runFiles.length).toBe(9);
  });

  it.each(runFiles)('%s: the same hashes with fog off and on', async (file) => {
    const { content, run, golden } = loadRun(ROOT, file);
    const played = await playRun(ROOT, file);
    if (!played.ok) throw new Error(JSON.stringify(played.errors));
    expect(played.value.hashes).toEqual(golden);
    const finalHash = stateHash(played.value.snapshot);
    const make = await viewMaker(ROOT, file, content, run);

    for (const fog of [false, true]) {
      const state = new RtsPresentState();
      let last = '';
      const hashes: TickHash[] = playView(make(), run, (game) => {
        const snapshot = game.snapshot();
        const view = viewOf(snapshot);
        const frame = presentWorld(view, { faction: PLAYER, size: SIZE, state, fog });
        if (fog) {
          expect(frame.fog?.rows).toBe(view.terrain!.height);
          const shown = new Set(frame.entities.map((e) => e.id));
          hidden += view.units.filter((u) => u.faction !== PLAYER && !shown.has(`unit-${u.id}`)).length;
          if (view.tick % 50 === 0)
            expect(
              validate('frame.json', frame, presentFrameSchema).errors,
              `${file} tick ${view.tick}`,
            ).toEqual([]);
        } else expect(frame.fog).toBeUndefined();
        last = stateHash(game.snapshot());
      });
      expect(hashes, `fog ${fog ? 'on' : 'off'}`).toEqual(golden);
      expect(last, `fog ${fog ? 'on' : 'off'}: final state`).toBe(finalHash);
    }
  });

  it('hid enemy units out of sight somewhere in the runs', () => {
    expect(hidden).toBeGreaterThan(0);
  });
});
