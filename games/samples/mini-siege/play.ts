import { saveCodeContext } from '@engine/core/campaign-code';
import type { CampaignSave } from '@engine/core/campaign';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import type { MissionStepRefusal } from '@engine/core/headless';
import type { MissionRecord } from '@engine/core/missions';
import { RtsCamera } from '@engine/core/present';
import type { SceneStack } from '@engine/core/scene';
import { CampaignSession, type CampaignEntryEnd } from '@engine/core/shell/campaign-session';
import { HostScene, type HostDrawer } from '@engine/core/shell/host-scene';
import {
  missionButtons,
  RtsControls,
  RTS_TILE_SIZE,
  sidesOf,
  type RtsView,
  type SideSummary,
} from '@kits/rts';
import { PLAYER, siegeCampaign, siegeMissions } from './content';
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
 * - **Taps in the walls' round** (Engine 0.12 T8; since Engine 0.15 frame input, gaps D1 and
 *   D12): the shell puts each step's pointer taps on the frame, the host passes them through its
 *   `RoundInput`, and the towerdefense kit's round (the `fortify` mission) maps them through its
 *   own camera: a tap moves the cursor there, a second tap on the cursor's cell places the chosen
 *   tower, a right click or long-press sells. No glue here; the sabotage's room ignores taps (it
 *   has keys and the touch pad only), and the round's other gestures are dropped.
 * - **The battle's pace** stays this glue's (`stepsPerTick`), not the shell's scene `tickRate`
 *   (gap D2): the battle reads the pointer's gestures (select, box, pan) on every loop step, and a
 *   scene the shell steps only on its ticks would drop the gestures of the steps between.
 * - **The campaign** (Engine 0.13 T8): the game is one entry of the campaign file
 *   (`content/campaigns/siege.campaign.json`: the siege, then the dawn assault). An entry ends at
 *   its `ticks` (260 world ticks for the siege, 200 for the dawn), or the first world tick after
 *   once no mission is open, waiting or being played; then nothing steps and `ended()` is its
 *   result: the outcomes, the village's named people and their fates, the battle's end, and the
 *   engine's `CampaignSession` keeping the campaign save in browser storage and packing its save
 *   code. `press({ kind: 'continue' })` builds the next entry from that save (the dawn from what
 *   the siege carried), or the siege again once the campaign is over or there is no save (the
 *   hall fell, gap M31). `press({ kind: 'code', text })` resumes from a typed save code (a refused
 *   code keeps its reason in `message`, nothing changes) and `press({ kind: 'stored' })` from the
 *   save an earlier visit stored. A mission without a round (the dawn's exchange and leave)
 *   is only delegated: `canPlay(mission)` is false and the page offers "Decide".
 */

/** World ticks the page plays per second while no round is hosted (the loop steps 60 a second). */
export const TICKS_PER_SECOND = 10;
export const STEPS_PER_TICK = 60 / TICKS_PER_SECOND;

/** What the page reads of the pointer each step (`PointerSource`, or a script in tests). */
export interface GestureFeed {
  gestures(): readonly PointerGesture[];
}

/** A button on the page. */
export type PageButton =
  | { kind: 'launch'; mission: string }
  | { kind: 'play' }
  | { kind: 'delegate' }
  | { kind: 'continue' }
  | { kind: 'code'; text: string }
  | { kind: 'stored' };

/** How one campaign entry ended (`SiegePlay.ended()`), for the page's result panel. */
export interface SiegeEntryResult extends CampaignEntryEnd {
  /** The scenario entry that ended (`village`, `dawn`) and its title from the campaign file. */
  scenario: string;
  title: string;
  /** The committed missions' outcome titles, in commit order. */
  outcomes: string[];
  /** The player's named people at the end: name, fate and hp (`Captain Hale: captured, 90/120 hp`). */
  people: string[];
  /** How the battle stands: the hall fallen, the raiders beaten, every defender fallen, or both standing. */
  verdict: string;
  /** The title of the entry `continue` plays next, or null when it starts over. */
  next: string | null;
}

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
  /** The campaign entry played now (a new game when the campaign moves on). */
  game: MiniSiegeGame;
  camera: RtsCamera;
  controls: RtsControls;
  readonly session: CampaignSession;
  /** The last refusal (an order's or a mission step's reason), or ''. */
  message = '';
  private readonly stepsPerTick: number;
  private readonly pressed: PageButton[] = [];
  private readonly titles: ReadonlyMap<string, string>;
  private readonly outcomes: ReadonlyMap<string, string>;
  private readonly playable: ReadonlySet<string>;
  private waiting: string | null = null;
  private steps = 0;
  private result: SiegeEntryResult | null = null;
  /** The host's events of the game step this loop step took (none when it took none). */
  private stepped: readonly unknown[] = [];

  constructor(private readonly opts: SiegePlayOptions) {
    this.session = new CampaignSession(saveCodeContext(opts.content), siegeCampaign(opts.content));
    this.stepsPerTick = opts.stepsPerTick ?? STEPS_PER_TICK;
    const missions = siegeMissions(opts.content);
    this.titles = new Map(missions.map((m) => [m.id, m.title]));
    this.outcomes = new Map(
      missions.flatMap((m) => m.outcomes.map((o) => [`${m.id}/${o.id}`, o.title] as const)),
    );
    this.playable = new Set(missions.filter((m) => m.play !== undefined).map((m) => m.id));
    this.game = createGame(opts.content, opts.seed);
    ({ camera: this.camera, controls: this.controls } = this.lookAt());
  }

  /** A camera east of the hall and fresh controls, for the entry played now. */
  private lookAt(): { camera: RtsCamera; controls: RtsControls } {
    const opts = this.opts;
    const view = this.view();
    const cols = view.terrain?.width ?? 1;
    const rows = view.terrain?.height ?? 1;
    const hall = view.buildings.find((b) => b.faction === PLAYER);
    const camera = new RtsCamera({
      view: opts.content.manifest.screen,
      area: { x: 0, y: 0, w: cols * RTS_TILE_SIZE, h: rows * RTS_TILE_SIZE },
      ...(hall && {
        centre: { x: (hall.x + hall.w / 2 + 6) * RTS_TILE_SIZE, y: (hall.y + hall.h / 2) * RTS_TILE_SIZE },
      }),
    });
    return { camera, controls: new RtsControls(PLAYER, camera, RTS_TILE_SIZE, this.game.rts.rules) };
  }

  /** The scenario entry played now (`village`, `dawn`). */
  get scenario(): string {
    return this.game.campaign.scenario;
  }

  /** The title the campaign file gives the entry played now (its scenario id when none). */
  entryTitle(save: CampaignSave = this.game.campaign.save): string {
    const entry = this.session.run(save).entry;
    return entry?.title ?? entry?.scenario ?? '';
  }

  /** The world ticks the entry played now lasts (the campaign file's `ticks`). */
  get entryTicks(): number {
    return this.session.run(this.game.campaign.save).entry?.ticks ?? Infinity;
  }

  /** How the entry played now ended, or null while it is still played. */
  ended(): SiegeEntryResult | null {
    return this.result;
  }

  /** The save an earlier visit kept in browser storage with an entry left to play, or null. */
  storedSave(): CampaignSave | null {
    return this.session.stored();
  }

  /** Whether `mission` has a round to play; one without (a choice) is only delegated. */
  canPlay(mission: string): boolean {
    return this.playable.has(mission);
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

  /** The missions the launch buttons offer now: none while one waits for its choice or a round runs. */
  launchButtons(): string[] {
    if (this.waiting !== null || this.result !== null || this.game.miniGame() !== null) return [];
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
    this.stepped = [];
    const playing = this.game;
    for (const b of this.pressed.splice(0)) this.button(b);
    if (this.game !== playing) return; // a new entry starts at its tick 0 on the next step
    const gestures = this.opts.pointer?.gestures() ?? [];
    if (this.game.miniGame() !== null) {
      this.step(input); // the round reads the frame's keys and taps
      return;
    }
    if (this.waiting !== null || this.result !== null) return;
    for (const g of gestures) {
      const draft = this.controls.gesture(g, this.view());
      if (draft !== null) this.message = this.game.rts.issue(draft).error ?? '';
    }
    if (++this.steps % this.stepsPerTick !== 0) return;
    this.step(input);
    if (this.tick >= this.entryTicks && this.view().missions.open.length === 0) this.endEntry();
  }

  /** One game step, keeping its events (the host's mission events, gap M21) for the frame. */
  private step(input: InputFrame): void {
    this.game.step(input);
    this.stepped = this.game.events;
  }

  /** The entry played now ends: its result, its save stored and its code packed. */
  private endEntry(): void {
    const end = this.session.end(this.game.campaignSave());
    const view = this.view();
    const hall = this.game.named()['hall'];
    const raiders = Object.entries(this.sides()).filter(([f]) => f !== PLAYER);
    this.result = {
      ...end,
      scenario: this.scenario,
      title: this.entryTitle(),
      outcomes: this.records().map((r) => this.outcomeTitle(r.mission, r.outcome)),
      people: view.named
        .filter((n) => n.faction === PLAYER)
        .map((n) => `${n.name}: ${n.fate}${n.fate === 'dead' ? '' : `, ${n.hp}/${n.maxHp} hp`}`),
      verdict:
        hall && !hall.alive
          ? 'the hall has fallen'
          : raiders.every(([, s]) => s.units === 0)
            ? 'the raiders are beaten'
            : this.sides()[PLAYER]?.units === 0
              ? 'every defender has fallen'
              : 'the hall still stands',
      next: end.save !== null && !end.done ? this.entryTitle(end.save) : null,
    };
  }

  /** Plays the campaign entry `save` is at (the siege from the start when null). */
  private start(save: CampaignSave | null): void {
    const { content } = this.opts;
    this.game =
      save === null
        ? createGame(content, this.opts.seed)
        : createGame(content, save.seed, { campaign: save });
    ({ camera: this.camera, controls: this.controls } = this.lookAt());
    this.waiting = null;
    this.result = null;
    this.steps = 0;
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
    picture: (r: Renderer) => HostDrawer<MiniSiegeGame, unknown>,
  ): HostScene<MiniSiegeGame, unknown> {
    return new HostScene<MiniSiegeGame, unknown>({
      stack,
      step: (input) => this.update(input),
      world: () => this.game,
      // Only a loop step that stepped the game has events: the battle steps every few loop steps.
      events: () => this.stepped,
      miniGame: () => this.game.miniGame(),
      headless: () => this.game,
      picture,
    });
  }

  private button(b: PageButton): void {
    if (b.kind === 'continue') {
      if (this.result === null) return;
      this.message = '';
      this.start(this.result.next === null ? null : this.result.save);
      return;
    }
    if (b.kind === 'code' || b.kind === 'stored') {
      if (this.game.miniGame() !== null) return;
      const resumed =
        b.kind === 'code'
          ? this.session.resume(b.text)
          : ((save) => (save === null ? null : { ok: true as const, save }))(this.storedSave());
      if (resumed === null) return;
      if (!resumed.ok) {
        this.message = `${resumed.code}: ${resumed.error}`;
        return;
      }
      this.message = '';
      this.start(resumed.save);
      return;
    }
    if (this.result !== null) return;
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
