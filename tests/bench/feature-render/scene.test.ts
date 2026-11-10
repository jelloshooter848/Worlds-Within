import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkinParticles } from '@engine/core/fx';
import { rasterizeToBuffer } from '@engine/core/gfx/pixelart';
import { readGameFiles } from '@engine/core/node/game-files';
import { presentFrameSchema, resolveSkinFrame, skinSchema } from '@engine/core/present';
import { FEATURE_GAMES, featureGame } from './games';
import {
  BENCH_MAX_PARTICLES,
  FX_PALETTE,
  FeatureScene,
  featureSkin,
  fxSheet,
  SHOT_FRAMES,
  type FeatureMap,
} from './scene';

// The feature benchmark's scene (Engine 0.16 T13). The benchmark itself (`run.ts`) needs a browser
// and is run by hand; this checks in Node that what it draws is valid and carries every feature:
// the skin parses, every frame it adds is on the bench sheet, the units are the game's own kinds
// with a walk look, the frames are the same each run, and the particles alive reach 2000+ with
// both blends and glow.

const MAPS: FeatureMap[] = ['rts', 'td'];

function load(map: FeatureMap) {
  const def = FEATURE_GAMES[map];
  return featureGame(map, readGameFiles(def.dir), readFileSync(join(def.dir, def.run), 'utf8'));
}

describe('the feature benchmark scene', () => {
  for (const map of MAPS) {
    describe(map, () => {
      const game = load(map);
      const skin = featureSkin(game.skin, game.info, game.base.unitKinds);

      it('adds every feature to a skin that still parses', () => {
        const parsed = skinSchema.safeParse(skin);
        expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
        expect(skin.parallax).toHaveLength(3);
        const hud = (skin.hud ?? []).map((item) => (item as { as?: string }).as);
        for (const as of ['panel', 'text', 'bar', 'counter', 'minimap']) expect(hud).toContain(as);
        const events = skin.events ?? {};
        expect(events['bench-blast']?.shake).toBeDefined();
        expect(events['bench-punch']?.zoom).toBeDefined();
        expect(events['bench-hit']?.tween).toBeDefined();
        expect(skin.kinds['bench-wisp']?.blend).toBe('add');
        expect(skin.kinds['bench-brazier']?.glow).toBeDefined();
        // The game's own skin is untouched.
        expect(game.skin.parallax).toBeUndefined();
      });

      it("draws frames from the bench sheet and the game's own unit kinds", () => {
        const sheet = fxSheet();
        expect(rasterizeToBuffer(sheet, FX_PALETTE).width).toBeGreaterThan(0);
        for (const name of ['brazier', 'wisp', 'spark', 'hud-panel', 'clouds', 'hills'])
          expect(sheet.frames[name], name).toBeDefined();
        const frame = new FeatureScene(game.base, { map, units: 20, zoom: 1 }).next();
        for (const e of frame.entities.filter((x) => x.id.startsWith('bench-u') && !x.id.endsWith('/hp'))) {
          expect(game.base.unitKinds).toContain(e.kind);
          expect(resolveSkinFrame(skin, e).frame, e.kind).not.toBeNull();
        }
      });

      it('makes valid frames, the same on every run, with and without features', () => {
        const frames = (features: boolean) => {
          const scene = new FeatureScene(game.base, { map, units: 50, zoom: 0.5, features });
          return Array.from({ length: SHOT_FRAMES }, () => scene.next());
        };
        const on = frames(true);
        expect(JSON.stringify(on)).toBe(JSON.stringify(frames(true)));
        for (const f of [on[0]!, on[SHOT_FRAMES - 1]!])
          expect(presentFrameSchema.safeParse(f).success).toBe(true);
        expect(on.flatMap((f) => f.events.map((e) => e.type))).toEqual(
          expect.arrayContaining(['bench-hit', 'bench-blast', 'bench-punch']),
        );
        const off = frames(false);
        expect(off.every((f) => f.events.length === 0)).toBe(true);
        expect(off.some((f) => f.entities.some((e) => e.kind.startsWith('bench-')))).toBe(false);
      });

      it('keeps 2000+ particles alive, normal and additive, some glowing', () => {
        const scene = new FeatureScene(game.base, {
          map,
          units: FEATURE_GAMES[map].units,
          zoom: 1,
        });
        const particles = new SkinParticles(skin, { max: BENCH_MAX_PARTICLES });
        const events = skin.events ?? {};
        for (let f = 0; f < 120; f++) {
          const frame = scene.next();
          for (const ev of frame.events) particles.event(events[ev.type]!, ev, frame.entities, f);
          particles.update(f, frame.entities);
        }
        const live = particles.particles();
        expect(live.length).toBeGreaterThanOrEqual(2000);
        expect(live.length).toBeLessThan(BENCH_MAX_PARTICLES);
        expect(live.some((p) => p.blend === 'add')).toBe(true);
        expect(live.filter((p) => p.blend !== 'add').length).toBeGreaterThan(1000);
        expect(live.some((p) => p.glow > 0)).toBe(true);
      });
    });
  }
});
