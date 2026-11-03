import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import type { MissionStepRefusal } from '@engine/core/headless';
import type { MissionRecord } from '@engine/core/missions';
import { RtsCamera } from '@engine/core/present';
import type { SceneStack } from '@engine/core/scene';
import { HostScene, type HostDrawer } from '@engine/core/shell/host-scene';
import {
  missionButtons,
  RtsControls,
  RTS_TILE_SIZE,
  sidesOf,
  type RtsView,
  type SideSummary,
} from '@kits/rts';
import { cameraHint, TD_TILE_SIZE, TdDefenceRound } from '@kits/towerdefense';
import { PLAYER, siegeMissions } from './content';
import { createGame, type MiniSiegeGame } from './headless';
import type { InterfaceOptions } from './picture';

/**
 * The mini siege as the browser plays it (Engine 0.11 T9): no DOM and no clock (`main.ts` has
 * them), so Node tests drive it with scripted presses. Thin glue around the same `MiniSiegeGame`
 * the tools play (`headless.ts`):
 *
 * - **The battle** steps one world tick every `stepsPerTick` loop steps (`TICKS_PER_SECOND` on the
 *   page). The pointer's gestures go to the RTS kit's `RtsControls` (select, command, pan, zoom),
 *   an order to `RtsGame.issue`; the camera is the engine's `RtsCamera`, starting on the hall.
 * - **The launch button** is the kit's mission command: `launchButtons()` lists the offered
 *   missions (`missionButtons`), and `press({ kind: 'launch', mission })` opens it through the
 *   game's `mission` step, which goes through the kit's `launchMission` (refused `not_offered`
 *   when its window has passed). The battle freezes (the sim's open mission) and the page waits:
 * - **The choice**: `choice()` is the open mission waiting for the player's answer, and
 *   `press({ kind: 'play' })` starts its round (the host's `play`) while `press({ kind:
 *   'delegate' })` lets the world draw the outcome. Nothing steps while the choice is shown.
 * - **The round** is the engine's `HostScene` (`scene(stack, picture)`): after the step that starts
 *   it, the scene pushes the core `miniGameScene`, whose steps come back here and step the host one
 *   round tick each (60 a second; the world waits, as headless). It pops itself on the round's end;
 *   from then the world steps again and the result commits at its fixed tick, either path.
 * - **Taps in the walls' round** (Engine 0.12 T8): while the hosted round is the towerdefense
 *   kit's `TdDefenceRound` (the `fortify` mission), a pointer tap goes to its `TdGame.tap` through
 *   the round's camera (`roundTap`): a tap moves the cursor there, a second tap on the cursor's
 *   cell places the chosen tower, a right click or long-press sells. The other gestures, and every
 *   gesture in the sabotage's room, are dropped (the room has keys and the touch pad only). The
 *   same lines as the sample's `TdPlay.tap`: gap D12 in docs/reports/tower-defense.md.
 */

/** World ticks the page plays per second while no round is hosted (the loop steps 60 a second). */
export const TICKS_PER_SECOND = 10;
export const STEPS_PER_TICK = 60 / TICKS_PER_SECOND;

/** What the page reads of the pointer each step (`PointerSource`, or a script in tests). */
export interface GestureFeed {
  gestures(): readonly PointerGesture[];
}

/** A button on the page. */
export type PageButton = { kind: 'launch'; mission: string } | { kind: 'play' } | { kind: 'delegate' };

export interface SiegePlayOptions {
  /** The game's content and seed (`game.json`'s `start.seed` on the page). */
  content: ContentBundle;
  seed: number;
  /** The pointer, or null (buttons only). */
  pointer: GestureFeed | null;
  /** Loop steps per world tick (default `STEPS_PER_TICK`). */
  stepsPerTick?: number;
}

export class SiegePlay {
  readonly game: MiniSiegeGame;
  readonly camera: RtsCamera;
  readonly controls: RtsControls;
  /** The last refusal (an order's or a mission step's reason), or ''. */
  message = '';
  private readonly stepsPerTick: number;
  private readonly pressed: PageButton[] = [];
  private readonly titles: ReadonlyMap<string, string>;
  private readonly outcomes: ReadonlyMap<string, string>;
  private waiting: string | null = null;
  private steps = 0;

  constructor(private readonly opts: SiegePlayOptions) {
    this.game = createGame(opts.content, opts.seed);
    this.stepsPerTick = opts.stepsPerTick ?? STEPS_PER_TICK;
    const missions = siegeMissions(opts.content);
    this.titles = new Map(missions.map((m) => [m.id, m.title]));
    this.outcomes = new Map(
      missions.flatMap((m) => m.outcomes.map((o) => [`${m.id}/${o.id}`, o.title] as const)),
    );
    const view = this.view();
    const cols = view.terrain?.width ?? 1;
    const rows = view.terrain?.height ?? 1;
    const hall = view.buildings.find((b) => b.faction === PLAYER);
    this.camera = new RtsCamera({
      view: opts.content.manifest.screen,
      area: { x: 0, y: 0, w: cols * RTS_TILE_SIZE, h: rows * RTS_TILE_SIZE },
      ...(hall && {
        centre: { x: (hall.x + hall.w / 2 + 6) * RTS_TILE_SIZE, y: (hall.y + hall.h / 2) * RTS_TILE_SIZE },
      }),
    });
    this.controls = new RtsControls(PLAYER, this.camera, RTS_TILE_SIZE, this.game.rts.rules);
  }

  /** The world as the kit reads it now. */
  view(): RtsView {
    return this.game.rts.view();
  }

  /** The world tick (it stands still while a round is played). */
  get tick(): number {
    return this.game.rts.tick;
  }

  /** Every side at a glance (the kit's `sidesOf`). */
  sides(): Record<string, SideSummary> {
    return sidesOf(this.view(), this.game.factions);
  }

  /** The hosted round when it is the walls' tower-defense round (`fortify`), else null. */
  defenceRound(): TdDefenceRound | null {
    const round = this.game.miniGame();
    return round instanceof TdDefenceRound ? round : null;
  }

  /**
   * A pointer tap at picture point (x, y) in the walls' round (see the file comment), through the
   * frame the round presents (the picture size and the kit's `cameraHint`). False when no such
   * round is hosted.
   */
  roundTap(x: number, y: number, button: 'primary' | 'secondary' = 'primary'): boolean {
    const round = this.defenceRound();
    if (round === null) return false;
    const frame = {
      size: this.opts.content.manifest.screen,
      camera: cameraHint(round.game.world, TD_TILE_SIZE),
    };
    round.game.tap(x, y, frame, button, TD_TILE_SIZE);
    return true;
  }

  /** The missions the launch buttons offer now: none while one waits for its choice or a round runs. */
  launchButtons(): string[] {
    if (this.waiting !== null || this.game.miniGame() !== null) return [];
    return missionButtons(this.view());
  }

  /** The open mission waiting for play or delegate, or null. */
  choice(): string | null {
    return this.waiting;
  }

  /** A mission's title (its id when the game has none). */
  title(mission: string): string {
    return this.titles.get(mission) ?? mission;
  }

  /** An outcome's title from the mission file (its id when there is none). */
  outcomeTitle(mission: string, outcome: string): string {
    return this.outcomes.get(`${mission}/${outcome}`) ?? outcome;
  }

  /** The committed missions' records (outcome, resolution), in commit order. */
  records(): readonly MissionRecord[] {
    return this.game.records();
  }

  /** A page button: carried out at the start of the next step. */
  press(button: PageButton): void {
    this.pressed.push(button);
  }

  /** One loop step (`HostScene` calls it, and so does the round's scene while it is on top). */
  update(input: InputFrame): void {
    for (const b of this.pressed.splice(0)) this.button(b);
    const gestures = this.opts.pointer?.gestures() ?? [];
    if (this.game.miniGame() !== null) {
      for (const g of gestures) if (g.type === 'tap') this.roundTap(g.x, g.y, g.button);
      this.game.step(input);
      return;
    }
    if (this.waiting !== null) return;
    for (const g of gestures) {
      const draft = this.controls.gesture(g, this.view());
      if (draft !== null) this.message = this.game.rts.issue(draft).error ?? '';
    }
    if (++this.steps % this.stepsPerTick !== 0) return;
    this.game.step(input);
  }

  /** The interface state the battle's frames show (selection, box, camera). */
  readonly ui: InterfaceOptions = () => this.controls.presentOptions(this.view());

  /**
   * The page's scene: the engine's `HostScene` over the game, stepped through `update`, pushing the
   * round's scene when a round starts. `picture` makes the drawer on the first render (the page's
   * `siegePicture` onto the display's presenter, with `ui`).
   */
  scene(
    stack: SceneStack,
    picture: (r: Renderer) => HostDrawer<MiniSiegeGame, never>,
  ): HostScene<MiniSiegeGame, never> {
    return new HostScene<MiniSiegeGame, never>({
      stack,
      step: (input) => this.update(input),
      world: () => this.game,
      events: () => [],
      miniGame: () => this.game.miniGame(),
      picture,
    });
  }

  private button(b: PageButton): void {
    if (b.kind === 'launch') {
      if (this.waiting !== null) return;
      if (this.answer(this.game.mission({ mission: b.mission, action: 'open' }))) this.waiting = b.mission;
      return;
    }
    const mission = this.waiting;
    if (mission === null) return;
    if (this.answer(this.game.mission({ mission, action: b.kind }))) this.waiting = null;
  }

  /** Keeps a refusal's reason for the status line; true when the step was taken. */
  private answer(refused: MissionStepRefusal | null): boolean {
    this.message = refused === null ? '' : `${refused.code}: ${refused.error}`;
    return refused === null;
  }
}
