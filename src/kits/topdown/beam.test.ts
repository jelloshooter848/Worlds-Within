import { describe, expect, it } from 'vitest';
import { NullRenderer } from '@engine/gfx/renderer';
import { BEAM_PALETTES, BEAM_PALETTE_CALM, BeamBurst, SwordBeam } from './beam';
import { DEFAULT_SHEETS, type TdView } from './view';

/** A view on frame `frame` that records the palettes asked for. */
function viewAt(frame: number, reduceFlashing: boolean, asked: (string | undefined)[]): TdView {
  return {
    frame,
    reduceFlashing,
    sheets: DEFAULT_SHEETS,
    sheet: (_id, palette) => {
      asked.push(palette);
      return null;
    },
  };
}

describe('the sword beam: its flicker', () => {
  it('with reduce flashing the beam and its burst hold the steady tint on every frame', () => {
    const asked: (string | undefined)[] = [];
    const r = new NullRenderer();
    for (let f = 0; f < 32; f++) {
      new SwordBeam(0, 0, 'up').render(r, viewAt(f, true, asked), 0, 0);
      new BeamBurst(8, 8).render(r, viewAt(f, true, asked), 0, 0);
    }
    const tints = asked.filter((p) => p !== undefined);
    expect(tints.length).toBeGreaterThanOrEqual(64);
    expect(new Set(tints)).toEqual(new Set([BEAM_PALETTE_CALM]));
  });

  it('without it, the beam cycles through all four tints', () => {
    const asked: (string | undefined)[] = [];
    for (let f = 0; f < 32; f++)
      new SwordBeam(0, 0, 'up').render(new NullRenderer(), viewAt(f, false, asked), 0, 0);
    expect(new Set(asked.filter((p) => p !== undefined))).toEqual(new Set(BEAM_PALETTES));
  });
});
