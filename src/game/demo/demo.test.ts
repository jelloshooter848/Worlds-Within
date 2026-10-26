import { describe, expect, it } from 'vitest';
import { compileSong } from '@engine/audio/mml';
import { NullRenderer } from '@engine/gfx/renderer';
import { ScriptedInput } from '@engine/input/scripted-input';
import { DEFAULT_SHEETS, renderWorld, TopDownWorld } from '@kits/topdown';
import { DEMO_SONG } from './music';
import { demoDungeon } from './rooms';

describe('engine demo', () => {
  it('builds its rooms, starting in the courtyard', () => {
    const d = demoDungeon();
    expect(d.startRoom).toBe('courtyard');
    expect([...d.rooms.keys()].sort()).toEqual(['courtyard', 'guard-room', 'store-room']);
  });

  it('runs headless: the hero walks east into the guard room', () => {
    const world = new TopDownWorld(demoDungeon(), { seed: 1 });
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const r = new NullRenderer();
    const view = { frame: 0, reduceFlashing: false, sheets: DEFAULT_SHEETS, sheet: () => null };
    for (let i = 0; i < 400 && world.room.id === 'courtyard'; i++) {
      input.next();
      world.update(input);
      renderWorld(r, view, world);
    }
    expect(world.room.id).toBe('guard-room');
  });

  it('has a song that compiles', () => {
    expect(compileSong(DEMO_SONG).length).toBeGreaterThan(0);
  });
});
