import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessGame } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { Presenter } from '@engine/core/present';
import type { Scene } from '@engine/core/scene';
import { snapshotWorld, type TopDownWorld } from '@kits/topdown';
import { DUNGEON_MUSIC, ESCAPE_MUSIC } from './content';
import { createWorld } from './headless';
import { DungeonPicture, dungeonEnd, type DungeonLook } from './picture';

/** Loop steps the end banner shows before Z (or X) starts a new run, so a sword swung at the end is not it. */
export const END_HOLD = 60;

export interface DungeonSceneOptions {
  /** The skin's event sounds (the shell's `onSound`). */
  onSound?: (id: string) => void;
  /** Plays a song by id (the page's audio, once it is there). */
  music?: (id: string) => void;
  /**
   * The page's display presenter (Canvas2D or PixiJS, which plays the skin's sounds itself);
   * left out, the scene draws through its own Canvas2D presenter with `onSound`.
   */
  presenter?: Presenter;
}

/**
 * The dungeon: the top-down kit's world in the sample's rooms, drawn by the Canvas2D backend from
 * the kit's presentation frames and the sample's skin (`picture.ts`). Walk with the arrows, Z or X
 * for the sword, C for the selected item. The run ends when the hero walks out through the exit
 * or falls; the banner says which and, `END_HOLD` steps on, Z or X starts a new run (a new seed).
 * Until then the scene is exactly the headless game (`headless()`), so the page's step hook hashes
 * it like a run file.
 */
export class DungeonScene implements Scene {
  private world: TopDownWorld;
  /** The last step's events, for the snapshot (the headless game's `snapshot().events`). */
  private last: object[];
  /** The world's events since the last draw (several updates can run between two draws). */
  private events: object[] = [];
  private picture: DungeonPicture | null = null;
  private frame = 0;
  /** Loop steps since the run ended (0 while it plays). */
  private ended = 0;

  constructor(
    private readonly content: ContentBundle,
    private readonly look: DungeonLook,
    private readonly opts: DungeonSceneOptions = {},
  ) {
    this.world = createWorld(content);
    // As `topdownGame`: the events of entering the first room are tick 0's, not a step's sounds.
    this.last = this.world.events.splice(0);
  }

  enter(): void {
    this.opts.music?.(DUNGEON_MUSIC);
  }

  update(input: InputFrame): void {
    this.frame++;
    if (
      dungeonEnd(this.world) &&
      ++this.ended > END_HOLD &&
      (input.pressed('attack') || input.pressed('jump'))
    ) {
      this.restart();
      return;
    }
    // The world steps on after the end (a fallen hero lies still, an escaped one may walk), so the
    // page stays the headless game tick for tick until a new run starts.
    const escaped = this.world.exited;
    this.world.update(input);
    this.last = this.world.events.splice(0);
    this.events.push(...this.last);
    if (this.world.exited && !escaped) this.opts.music?.(ESCAPE_MUSIC);
  }

  render(r: Renderer): void {
    const { onSound, presenter } = this.opts;
    this.picture ??= new DungeonPicture(r, this.look, {
      ...(onSound && { onSound }),
      ...(presenter && { presenter }),
    });
    this.picture.draw(this.world, this.events.splice(0));
  }

  /** The world the scene plays now as a headless game, for the page's step hook. */
  headless(): HeadlessGame {
    return {
      step: (input) => this.update(input),
      snapshot: () => snapshotWorld(this.world, this.last),
    };
  }

  /** A new run from the start, seeded from the loop steps so far (a new dungeon of bats). */
  private restart(): void {
    this.world = createWorld(this.content, this.frame);
    this.last = this.world.events.splice(0);
    this.events = [];
    this.ended = 0;
    this.picture?.reset();
    this.opts.music?.(DUNGEON_MUSIC);
  }
}
