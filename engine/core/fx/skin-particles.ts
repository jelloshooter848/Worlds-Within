import { particlesEffectEmitter, skinEmitNames, type SkinFile } from '../present/skin';
import type { DeepReadonly, PresentEntity, PresentEvent, PresentMap } from '../present/types';
import { mapParts } from './lighting';
import { anchorPoint, ParticleSystem, type ParticleAnchorBox, type ParticleView } from './particles';
import type { EmitterDef } from './schema';

type Skin = DeepReadonly<SkinFile>;
type Entity = DeepReadonly<PresentEntity>;
type EventEntry = NonNullable<SkinFile['events']>[string];

/** Frames a room's ambient particles run ahead when its map shows, when the skin gives no `prewarm`. */
export const AMBIENT_PREWARM = 120;

/** Emitters that stand still (a decor campfire's smoke): an id no entity has, a world box and emitter names. */
export interface FixedEmitters {
  id: string;
  box: ParticleAnchorBox;
  emit: readonly string[];
}

/** How strongly bright (additive) particles show with the reduced-flashing setting on. */
export const REDUCED_FLASH_ALPHA = 0.5;

/**
 * A skin's particles for one presenter (Engine 0.16 T3), the part both backends share: a
 * {@link ParticleSystem} fed by the skin's event entries (`emit`, and an old `particles` effect as
 * an implicit emitter) and its kinds' `emit` (attached to every entity of the kind on screen,
 * following it). Presenter state only: it reads frames and the skin and never writes to either.
 */
export class SkinParticles {
  readonly system: ParticleSystem;
  /**
   * Room-wide particles (the skin's `lighting.particles`, Engine 0.16 part C T4): their own
   * system, started afresh (and run ahead by `prewarm`) whenever another map shows.
   */
  readonly ambient: ParticleSystem;
  /** The map the ambient particles were started for (`<id>|<tags>`), or null. */
  private ambientFor: string | null = null;
  /** The placed lights' emitter boxes on the map shown (`light:<map>:<i>`), in world px. */
  private readonly lightBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();

  constructor(
    private readonly skin: Skin,
    opts: { seed?: number; max?: number } = {},
  ) {
    this.system = new ParticleSystem(opts);
    this.ambient = new ParticleSystem({ ...(opts.seed !== undefined && { seed: opts.seed }) });
  }

  /**
   * Starts what event entry `entry` emits for event `ev` on `frame`: each named emitter at the
   * event's `x`/`y` (or on its entity: at the emitter's `anchor` when it gives one, else the box
   * centre), following the entity when the emitter says `follow`; and an old `particles` effect.
   */
  event(
    entry: DeepReadonly<EventEntry>,
    ev: DeepReadonly<PresentEvent>,
    entities: readonly Entity[],
    frame: number,
  ): void {
    const at = ev.entity === undefined ? undefined : entities.find((e) => e.id === ev.entity);
    const point = (def: EmitterDef | undefined) => {
      if (at && def?.anchor !== undefined) return anchorPoint(at, def.anchor);
      return {
        x: ev.x ?? (at ? at.x + at.w / 2 : 0),
        y: ev.y ?? (at ? at.y + at.h / 2 : 0),
      };
    };
    for (const name of skinEmitNames(entry.emit)) {
      const def = this.skin.emitters?.[name] as EmitterDef | undefined;
      if (def === undefined) continue;
      this.system.emit(name, def, point(def), frame, at?.id);
    }
    if (entry.effect?.kind === 'particles') {
      this.system.emit('particles', particlesEffectEmitter(entry.effect), point(undefined), frame);
    }
  }

  /**
   * Attaches the kinds' emitters to this frame's entities, and `fixed` emitters (a 3D skin's decor
   * `emit`, Engine 0.16 F6: an id, a box and emitter names) where they stand, and steps the
   * system to `frame`; with `map` (the full map shown), also runs the skin's room-wide
   * `lighting.particles` over it (Engine 0.16 part C T4).
   */
  update(
    frame: number,
    entities: readonly Entity[],
    map?: DeepReadonly<PresentMap> | null,
    fixed: readonly FixedEmitters[] = [],
  ): void {
    if (map !== undefined) this.updateAmbient(frame, map);
    const kinds = this.skin.kinds;
    const boxes = new Map<string, ParticleAnchorBox>();
    for (const f of fixed) {
      boxes.set(f.id, f.box);
      for (const name of f.emit) {
        const def = this.skin.emitters?.[name] as EmitterDef | undefined;
        if (def !== undefined) this.system.attach(f.id, name, def, f.box, frame);
      }
    }
    for (const e of entities) {
      boxes.set(e.id, e);
      const entry = Object.hasOwn(kinds, e.kind) ? kinds[e.kind] : undefined;
      for (const name of skinEmitNames(entry?.emit)) {
        const def = this.skin.emitters?.[name] as EmitterDef | undefined;
        if (def !== undefined) this.system.attach(e.id, name, def, e, frame);
      }
    }
    this.system.update(frame, (id) => boxes.get(id));
  }

  /**
   * The live particles to draw. With `reduceFlashing`, additive particles draw with normal
   * blending at {@link REDUCED_FLASH_ALPHA} of their opacity and without glow, so bright bursts do
   * not flash.
   */
  particles(opts: { reduceFlashing?: boolean } = {}): ParticleView[] {
    // Room-wide particles first: they hang in the air behind the effects.
    const all = [...this.ambient.particles(), ...this.system.particles()];
    if (!opts.reduceFlashing) return all;
    return all.map((p) =>
      p.blend === 'add' ? { ...p, blend: 'normal', alpha: p.alpha * REDUCED_FLASH_ALPHA, glow: 0 } : p,
    );
  }

  /**
   * The room-wide emitters for `map`: each `lighting.particles` entry whose `tags` (one of the
   * map's) and `maps` (its id or a part's) fit spawns over the whole map's box. A map other than
   * the last (a new id, or a frame number that went back) starts them afresh, `prewarm` frames
   * ahead, so the air is already full.
   */
  private updateAmbient(frame: number, map: DeepReadonly<PresentMap> | null): void {
    const entries = this.skin.lighting?.particles ?? [];
    if (entries.length === 0 && this.skin.lighting?.maps === undefined) return;
    // Keyed by id and tags: a blast that moves the version keeps the air as it is.
    const key = map === null ? null : `${map.id}|${(map.tags ?? []).join(',')}`;
    const behind = this.ambient.frame !== null && frame < this.ambient.frame;
    if (key !== this.ambientFor || behind) {
      this.ambient.clear();
      this.ambientFor = key;
      this.lightBoxes.clear();
      if (map === null) return;
      const ids = [map.id, ...(map.parts ?? []).map((p) => p.id)];
      const tags = map.tags ?? [];
      const box = mapBox(map);
      entries.forEach((entry, i) => {
        if (entry.tags !== undefined && !entry.tags.some((t) => tags.includes(t))) return;
        if (entry.maps !== undefined && !entry.maps.some((m) => ids.includes(m))) return;
        const start = frame - (entry.prewarm ?? AMBIENT_PREWARM);
        for (const name of skinEmitNames(entry.emit)) {
          const def = this.skin.emitters?.[name] as EmitterDef | undefined;
          if (def === undefined) continue;
          const over: EmitterDef = { ...def, anchor: 'centre', shape: { box: { w: box.w, h: box.h } } };
          this.ambient.attach(`ambient:${i}`, name, over, box, start);
        }
      });
      this.attachLightEmitters(frame, map);
    }
    if (map !== null)
      this.ambient.update(frame, (id) => (id.startsWith('ambient:') ? mapBox(map) : this.lightBoxes.get(id)));
  }

  /**
   * Engine 0.16 part C T10: each placed light's `emit` (`lighting.maps.<id>.lights.<i>.emit`) runs
   * at the light's centre on the ambient system, each map part's at its place (a torch's embers
   * follow its room through a slide), started `AMBIENT_PREWARM` frames ahead.
   */
  private attachLightEmitters(frame: number, map: DeepReadonly<PresentMap>): void {
    const maps = this.skin.lighting?.maps;
    if (maps === undefined) return;
    for (const part of mapParts(map)) {
      if (!Object.hasOwn(maps, part.id)) continue;
      const ox = part.col * map.tileSize;
      const oy = part.row * map.tileSize;
      (maps[part.id]!.lights ?? []).forEach((light, i) => {
        if (light.emit === undefined) return;
        const id = `light:${part.id}:${i}`;
        const at = { x: ox + light.x, y: oy + light.y, w: 0, h: 0 };
        this.lightBoxes.set(id, at);
        for (const name of skinEmitNames(light.emit)) {
          const def = this.skin.emitters?.[name] as EmitterDef | undefined;
          if (def !== undefined) this.ambient.attach(id, name, def, at, frame - AMBIENT_PREWARM);
        }
      });
    }
  }
}

/** A map's whole box in world px. */
function mapBox(map: DeepReadonly<PresentMap>) {
  return { x: 0, y: 0, w: map.cols * map.tileSize, h: map.rows * map.tileSize };
}
