import { describe, expect, it } from 'vitest';
import { BeamBurst, SwordBeam } from './beam';
import { presentWorld } from './present';
import { buildDungeon } from './room';
import { TopDownWorld } from './world';

const ROOM = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#......@.......#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

/** The beam and its burst as presented on frames 0..31 (the skin picks the tint from t and tags). */
function looks(reduceFlashing: boolean): { t: number; tags: readonly string[] }[] {
  const w = new TopDownWorld(buildDungeon([{ id: 'r', at: [0, 0], map: ROOM }]), { seed: 1 });
  w.add(new SwordBeam(32, 32, 'up'));
  w.add(new BeamBurst(80, 80));
  const out: { t: number; tags: readonly string[] }[] = [];
  for (let f = 0; f < 32; f++) {
    w.frame = f;
    for (const e of presentWorld(w, [], { reduceFlashing }).entities) {
      if (e.kind === 'sword-beam') out.push({ t: e.anim?.t ?? -1, tags: e.tags ?? [] });
    }
  }
  return out;
}

describe('the sword beam: its flicker', () => {
  it('with reduce flashing the beam is calm and holds t at 0 on every frame', () => {
    const all = looks(true);
    expect(all).toHaveLength(32);
    for (const l of all) expect(l).toEqual({ t: 0, tags: ['calm'] });
  });

  it('without it, the beam flickers: t follows the frame so a skin can cycle its tints', () => {
    const all = looks(false);
    expect(all.map((l) => l.t)).toEqual([...Array(32).keys()]);
    for (const l of all) expect(l.tags).toEqual(['flashing']);
  });
});
