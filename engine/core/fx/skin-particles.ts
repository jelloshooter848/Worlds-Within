import { particlesEffectEmitter, skinEmitNames, type SkinFile } from '../present/skin';
import type { DeepReadonly, PresentEntity, PresentEvent } from '../present/types';
import { anchorPoint, ParticleSystem, type ParticleAnchorBox, type ParticleView } from './particles';
import type { EmitterDef } from './schema';

type Skin = DeepReadonly<SkinFile>;
type Entity = DeepReadonly<PresentEntity>;
type EventEntry = NonNullable<SkinFile['events']>[string];

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

  constructor(
    private readonly skin: Skin,
    opts: { seed?: number; max?: number } = {},
  ) {
    this.system = new ParticleSystem(opts);
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
   * system to `frame`.
   */
  update(frame: number, entities: readonly Entity[], fixed: readonly FixedEmitters[] = []): void {
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
    const all = this.system.particles();
    if (!opts.reduceFlashing) return all;
    return all.map((p) =>
      p.blend === 'add' ? { ...p, blend: 'normal', alpha: p.alpha * REDUCED_FLASH_ALPHA, glow: 0 } : p,
    );
  }
}
