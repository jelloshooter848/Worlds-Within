import type { ContentBundle } from '@engine/core/content/bundle';
import { SKIN_KIND, type SkinFile } from '@engine/core/present';

// The 0.16 part A "effects on" switches (docs/ROADMAP.md, 0.16 part A, Done when): each rewrites
// a game's skins so every kind and event uses one presentation feature, for the invariance tests
// (`presentation-invariance.test.ts`: every presenter fed every frame; `stepped-shell-invariance
// .test.ts`: the browser shell's loop with hit-pause, transitions, menus and the mixer).

/** One 'effects on' switch: rewrites one skin so it uses that effect everywhere it can. */
export type EffectSwitch = (skin: SkinFile) => SkinFile;

/**
 * The effects switches, by name. Each must leave a skin that still validates (checked below) and
 * may only add presentation: no change to the content a game's rules read.
 */
export const EFFECTS: Readonly<Record<string, EffectSwitch>> = {
  /** Tweens (T1): a pop-in on every kind and a squash, slide and hit flash on every event. */
  tweens: (skin) => ({
    ...skin,
    kinds: Object.fromEntries(
      Object.entries(skin.kinds).map(([kind, entry]) => [
        kind,
        {
          ...entry,
          spawnTween: [
            { prop: 'scale', from: 0.5, to: 1, frames: 8, ease: 'backOut' },
            { prop: 'rotate', from: 30, to: 0, frames: 6, ease: 'elasticOut' },
            { prop: 'alpha', from: 0.25, to: 1, frames: 5, delay: 1 },
          ],
        },
      ]),
    ),
    events: Object.fromEntries(
      Object.entries(skin.events ?? {}).map(([type, entry]) => [
        type,
        {
          ...entry,
          tween: [
            { prop: 'y', from: -6, to: 0, frames: 8, ease: 'bounceOut' },
            { prop: 'scaleX', from: 1.5, to: 1, frames: 4, yoyo: true, repeat: 1, ease: 'quadInOut' },
            { prop: 'color', from: '#ffffff', to: '#d82800', frames: 6, amount: 0.6, ease: 'sineOut' },
          ],
        },
      ]),
    ),
  }),
  /**
   * Sprite animation (T2): every 2D cycle timed per frame with a frame event on its first and
   * last frame, every 3D kind a two-pose `idle` cycle (every state falls back to it) with a frame
   * event, and the frame event's particles in the skin's `events`.
   */
  animation: (skin) => {
    const timed = (c: Record<string, unknown>) => {
      const n = (c['frames'] as unknown[]).length;
      return {
        ...c,
        ticks: Array.from({ length: n }, (_, i) => 2 + (i % 3)),
        events: { 0: 'fx-frame', [n - 1]: 'fx-frame' },
      };
    };
    const table = (frames: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(frames).map(([state, spec]) => {
          if (typeof spec !== 'object' || spec === null) return [state, spec];
          const s = spec as Record<string, unknown>;
          if (s['frames'] !== undefined) return [state, timed(s)];
          return [
            state,
            Object.fromEntries(
              Object.entries(s).map(([f, v]) => [
                f,
                typeof v === 'object' && v !== null ? timed(v as Record<string, unknown>) : v,
              ]),
            ),
          ];
        }),
      );
    const mesh3d = skin.backend === 'three';
    return {
      ...skin,
      kinds: Object.fromEntries(
        Object.entries(skin.kinds).map(([kind, entry]) => {
          if (mesh3d && entry.mesh !== undefined) {
            const idle = { frames: [entry.mesh, entry.mesh], ticks: [3, 5], events: { 1: 'fx-frame' } };
            return [kind, { ...entry, poses: { idle } }];
          }
          if (entry.frames === undefined) return [kind, entry];
          return [kind, { ...entry, frames: table(entry.frames) }];
        }),
      ),
      events: { ...skin.events, 'fx-frame': { effect: { kind: 'particles', count: 2, ticks: 4 } } },
    } as SkinFile;
  },
  /**
   * Particles (T3): two emitters in every skin, a burst (additive, glowing) on every event and a
   * trail on every kind, plus `blend: add` and `glow` on every 2D kind, and an old `particles`
   * effect on every event that has no effect of its own.
   */
  particles: (skin) => {
    const mesh3d = skin.backend === 'three';
    return {
      ...skin,
      emitters: {
        ...skin.emitters,
        'fx-burst': {
          burst: 6,
          life: [4, 9],
          speed: [0.5, 2],
          angle: [180, 360],
          gravity: 0.1,
          drag: 0.05,
          shape: { circle: 2 },
          size: [2, 1],
          color: ['#fcfcfc', '#f8b800'],
          alpha: [1, 0],
          blend: 'add',
          ...(!mesh3d && { glow: 3 }),
          max: 12,
        },
        'fx-trail': { rate: 0.5, life: 6, speed: 0.3, angle: 270, anchor: 'feet', alpha: [0.6, 0], max: 4 },
      },
      kinds: Object.fromEntries(
        Object.entries(skin.kinds).map(([kind, entry]) => [
          kind,
          {
            ...entry,
            emit: 'fx-trail',
            ...(!mesh3d && { blend: 'add', glow: { color: '#f8b800', radius: 2 } }),
          },
        ]),
      ),
      events: Object.fromEntries(
        Object.entries(skin.events ?? {}).map(([type, entry]) => [
          type,
          {
            ...entry,
            emit: 'fx-burst',
            ...(entry.effect === undefined && { effect: { kind: 'particles', count: 3, ticks: 5 } }),
          },
        ]),
      ),
    } as SkinFile;
  },
  /**
   * Camera effects and parallax (T4): a shake, a zoom punch, a flash and a hit-pause on every
   * event, look-ahead on the camera, and a parallax sky (a gradient, and on a 2D skin a tile
   * frame repeated) behind the map.
   */
  camera: (skin) => {
    const tile = Object.values(skin.tiles ?? {}).find((t) => t.frame !== undefined && t.sheet === undefined);
    const frameLayer =
      skin.backend !== 'three' && tile?.frame !== undefined && skin.sheets?.sheet !== undefined
        ? [{ frame: tile.frame, factor: { x: 0.5, y: 0.25 }, y: 40, repeat: 'xy' as const }]
        : [];
    return {
      ...skin,
      camera: { ...skin.camera, lookAhead: { x: 16, y: 8, lerp: 0.2 } },
      parallax: [
        ...(skin.parallax ?? []),
        { gradient: ['#203060', '#a4e4fc'], bands: 4, factor: 0, height: 60 },
        ...frameLayer,
      ],
      events: Object.fromEntries(
        Object.entries(skin.events ?? {}).map(([type, entry]) => [
          type,
          {
            ...entry,
            shake: { amount: 4, ticks: 10 },
            zoom: { to: 1.5, ticks: 3, ease: 'backOut', hold: 2, back: 4 },
            flash: { color: '#fcfcfc', alpha: 0.5, ticks: 3 },
            hitPause: { ticks: 3 },
          },
        ]),
      ),
    } as SkinFile;
  },
  /**
   * The audio mixer (T8): every event sound varies in pitch and volume, rests and ducks the music,
   * and the skin has a layered song mixed from a status value.
   */
  /**
   * The 3D scene look (T12): on a 3D skin, a sun with soft shadows, ambient and hemisphere
   * light, linear fog and ACES tone mapping; every kind and tile casting and receiving shadows,
   * every kind carrying a flickering point light and two world-anchored health bars (from the
   * status and from an `hp:` tag). A 2D skin is left as it is (these are 3D fields).
   */
  lighting: (skin) => {
    if (skin.backend !== 'three') return skin;
    return {
      ...skin,
      scene3d: {
        sun: { intensity: 1.4, direction: { x: -1, y: 2, z: 1 }, shadow: { mapSize: 256, radius: 2 } },
        ambient: { color: '#b8c8ff', intensity: 0.3 },
        hemisphere: { sky: '#a4e4fc', ground: '#503000', intensity: 0.5 },
        fog: { kind: 'linear', color: '#a4e4fc', near: 0, far: 600 },
        toneMapping: { kind: 'aces', exposure: 1.2 },
      },
      kinds: Object.fromEntries(
        Object.entries(skin.kinds).map(([kind, entry]) => [
          kind,
          {
            ...entry,
            castShadow: true,
            receiveShadow: true,
            light: { kind: 'point', color: '#ffa040', intensity: 20, distance: 64, flicker: 0.5 },
          },
        ]),
      ),
      tiles: Object.fromEntries(
        Object.entries(skin.tiles ?? {}).map(([key, entry]) => [
          key,
          { ...entry, castShadow: true, receiveShadow: true },
        ]),
      ),
      labels: Object.fromEntries(
        Object.keys(skin.kinds).map((kind) => [
          kind,
          [
            { from: { status: 'hp' }, as: 'bar', max: 'maxHp', back: '#000000' },
            { from: { tag: 'hp:' }, as: 'bar', max: 'maxHp', anchor: 'bottom' },
          ],
        ]),
      ),
    } as SkinFile;
  },
  audio: (skin) => ({
    ...skin,
    music: {
      ...skin.music,
      'fx-mix': {
        layers: { calm: 'calm', danger: 'danger' },
        mix: [
          { when: { status: 'hp', lt: 2 }, layers: { danger: 1, calm: 0.2 }, fade: 6 },
          { layers: { danger: 0, calm: 1 } },
        ],
      },
    },
    events: Object.fromEntries(
      Object.entries(skin.events ?? {}).map(([type, entry]) => [
        type,
        {
          ...entry,
          pitch: [-3, 3],
          volume: [0.5, 1],
          cooldown: 2,
          duck: { amount: 0.5, attack: 2, hold: 3, release: 6 },
        },
      ]),
    ),
  }),
};

/** The switch sets each run is played with: none (the baseline) and all of them at once. */
export const SWITCH_SETS: readonly (readonly string[])[] = [[], Object.keys(EFFECTS)];

/** `content` with every skin rewritten by `switches` (the content's other files untouched). */
export function withEffects(content: ContentBundle, switches: readonly string[]): ContentBundle {
  if (switches.length === 0) return content;
  return {
    ...content,
    entries: content.entries.map((e) => {
      if (e.kind !== SKIN_KIND.name) return e;
      let skin = structuredClone(e.value as SkinFile);
      for (const name of switches) skin = EFFECTS[name]!(skin);
      return { ...e, value: skin };
    }),
  };
}
