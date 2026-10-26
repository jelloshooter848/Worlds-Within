import type { Song } from '@engine/audio/mml';

/** A short original loop for the demo room (MML: src/engine/audio/mml.ts). */
export const DEMO_SONG: Song = {
  id: 'demo',
  bpm: 132,
  loop: true,
  pulse1: 'v10 @2 l8 o4 L [e g a > c < b a g e]2 [f a > c d c < a f d]2 [e g b > e d < b g e]2 a4 g4 e4 r4',
  pulse2: 'v6 @1 l4 o3 L [c e g e]2 [d f a f]2 [e g b g]2 c2 r2',
  triangle: 'l8 o3 L [a a > a < a]4 [d d > d < d]4 [e e > e < e]4 a4 r4 a4 r4',
  noise: 'v6 l8 L [k h s h]15 k k s s',
};
