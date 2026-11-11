import type { CampaignRunState, CampaignSave } from '../campaign';
import type { Renderer } from '../gfx/renderer';
import type { HeadlessGame, JsonObject, MissionStepRefusal } from '../headless';
import type { InputFrame } from '../input/input-manager';
import type { ControlKeyNames, MiniGame } from '../minigame';
import type { MissionDef, MissionRecord } from '../missions';
import type { SceneStack } from '../scene';
import type { CampaignEntryEnd, CampaignResume } from './campaign-session';
import { HostScene, type HostDrawer } from './host-scene';

/**
 * The shared mission-launch scene and campaign page flow (Engine 0.15 T10, gaps M26, M34, M36 and
 * lesson D14; docs/BUILD-LOG.md, Engine 0.15, decision 11, item 288): what a page that launches
 * missions from a host game, and plays a campaign of such games, does the same way whatever its
 * kit, written once. No DOM and no clock (`mission-bar.ts` is its DOM), so Node tests drive it with
 * presses; pure (on `PURE_CORE`). The game is a `MissionHost` (or anything shaped like one,
 * {@link LaunchGame}); what only its kit knows comes in as options: the offered missions (the RTS
 * kit's `missionButtons`), the world tick, the pointer's orders on the battle, and the end-of-entry
 * summary (the named people and the verdict).
 *
 * - **The launch** (M26): `launchButtons()` is the offered missions (none while a choice waits, a
 *   round is played, the entry is held or has ended), and `press({ kind: 'launch', mission })`
 *   opens one through the game's `mission` step (a refusal's reason goes to `message`). The host
 *   is paused while `choice()` waits: `play` starts the round (a mission without `play` is only
 *   decided: `canPlay` is false), `delegate` lets the world draw the outcome.
 * - **The round**: the scene is the engine's `HostScene` (`scene(stack, picture)`), which pushes
 *   the round's scene after the step that starts it; every loop step then steps the round (taps
 *   included, lesson D12), while the host steps one game step every `stepsPerTick` loop steps.
 *   `status(keys)` is the round's key hint while one is played (`roundHint`: the mission's `hint`
 *   or the mini game's `controls` with the player's key names, lesson D14), else the entry, the
 *   tick, the last refusal, the choice's question, the last outcome and the game's own line.
 * - **The campaign** (M34, M36; with the `campaign` option): every entry, the first too, is
 *   **held at tick 0** until the player begins it (`held()`, `briefing()` from the campaign file's
 *   `title` and `text`, `press({ kind: 'begin' })`), so a short window at the start is the
 *   player's time, not reading time. The entry ends by the game's `entryOver` (the engine's one
 *   rule, gap M35); then nothing steps and `ended()` is its result: the outcomes' titles, the
 *   game's summary, and the `CampaignSession`'s save and save code. `continue` builds the next
 *   entry from that save (or starts over once the campaign is done or nothing carries on), `code`
 *   resumes from a typed save code (a refusal's reason goes to `message`) and `stored` from the
 *   save an earlier visit kept.
 */

/** What the flow needs of the game: a `MissionHost`'s mission steps, records and round. */
export interface LaunchGame extends HeadlessGame {
  step(input: InputFrame): void;
  readonly events: readonly unknown[];
  miniGame(): MiniGame | null;
  mission(step: JsonObject): MissionStepRefusal | null;
  records(): readonly MissionRecord[];
  /** The key hint of the round hosted now (`MissionHost.roundHint`), '' when none. */
  roundHint?(keys?: ControlKeyNames): string;
}

/** A button on the page. */
export type LaunchButton =
  | { kind: 'launch'; mission: string }
  | { kind: 'play' }
  | { kind: 'delegate' }
  | { kind: 'begin' }
  | { kind: 'continue' }
  | { kind: 'code'; text: string }
  | { kind: 'stored' };

/** What the game says about an entry at its end, for the result panel. */
export interface EntrySummary {
  /** One line per named person of the player's (`Captain Hale: captured, 90/120 hp`). */
  people: readonly string[];
  /** How the entry stands at its end (`the hall has fallen`). */
  verdict: string;
}

/** How one campaign entry ended (`MissionLaunch.ended()`), for the result panel. */
export interface LaunchEntryResult extends CampaignEntryEnd {
  /** The entry that ended (its id: the scenario's for a scenario entry) and its title. */
  entry: string;
  title: string;
  /** The committed missions' outcome titles, in commit order. */
  outcomes: string[];
  people: string[];
  verdict: string;
  /** The title of the entry `continue` plays next, or null when it starts over. */
  next: string | null;
}

/** The parts of `CampaignSession` the flow uses (a fake in tests). */
export interface LaunchCampaignSession {
  run(save?: CampaignSave): CampaignRunState;
  end(save: CampaignSave | null): CampaignEntryEnd;
  resume(text: string): CampaignResume;
  stored(): CampaignSave | null;
}

/** The campaign side of the flow (M34, M36). */
export interface LaunchCampaign<G> {
  session: LaunchCampaignSession;
  /** Whether the entry played now is over (the game's `entryOver`, the engine's rule). */
  entryOver(game: G): boolean;
  /** The campaign save at the entry's end (the game's `campaignSave()`), null when none carries on. */
  save(game: G): CampaignSave | null;
  /** The named people and the verdict at the entry's end. */
  summary(game: G): EntrySummary;
  /** Hold every entry at tick 0 until `begin` (default true; M34). */
  hold?: boolean;
}

export interface MissionLaunchOptions<G extends LaunchGame> {
  /** Builds the game: the campaign entry `save` is at, or the first one (null). */
  create(save: CampaignSave | null): G;
  /** The game's missions (titles, outcome titles, which have a round). */
  missions: readonly MissionDef[];
  /** The missions offered now (the RTS kit's `missionButtons(view)`). */
  offers(game: G): readonly string[];
  /** The world tick now (it stands still while a choice waits or a round is played). */
  tick(game: G): number;
  /** Loop steps per game step while no round is hosted (default 1). */
  stepsPerTick?: number;
  /**
   * Every loop step the host runs (not held, no choice, no round, not ended): the kit's own
   * controls on the host (the RTS kit's pointer orders). A string is the message to show (''
   * clears it: an order taken); null leaves the message as it is.
   */
  control?(game: G): string | null;
  /** Called with every new game (the first and each entry started): a fresh camera, say. */
  onGame?(game: G): void;
  /** The game's own part of the status line (`the hall has fallen`), '' for none. */
  status?(game: G): string;
  /** The campaign the page plays, if any. */
  campaign?: LaunchCampaign<G>;
}

export class MissionLaunch<G extends LaunchGame> {
  /** The game played now (a new one when an entry starts). */
  game: G;
  /** The last refusal (an order's, a mission step's or a save code's reason), or ''. */
  message = '';
  private readonly stepsPerTick: number;
  private readonly pressed: LaunchButton[] = [];
  private readonly titles: ReadonlyMap<string, string>;
  private readonly outcomeTitles: ReadonlyMap<string, string>;
  private readonly playable: ReadonlySet<string>;
  private readonly defs: ReadonlyMap<string, MissionDef>;
  /** The campaign save the entry played now started from (null: the campaign's first entry, fresh). */
  private save: CampaignSave | null = null;
  private waiting: string | null = null;
  private holding: boolean;
  private steps = 0;
  private result: LaunchEntryResult | null = null;
  /** The game's events of the game step this loop step took (none when it took none). */
  private stepped: readonly unknown[] = [];

  constructor(private readonly opts: MissionLaunchOptions<G>) {
    this.stepsPerTick = opts.stepsPerTick ?? 1;
    this.titles = new Map(opts.missions.map((m) => [m.id, m.title]));
    this.outcomeTitles = new Map(
      opts.missions.flatMap((m) => m.outcomes.map((o) => [`${m.id}/${o.id}`, o.title] as const)),
    );
    this.defs = new Map(opts.missions.map((m) => [m.id, m]));
    this.playable = new Set(opts.missions.filter((m) => m.play !== undefined).map((m) => m.id));
    this.holding = this.holds();
    this.game = opts.create(null);
    opts.onGame?.(this.game);
  }

  private holds(): boolean {
    return this.opts.campaign !== undefined && this.opts.campaign.hold !== false;
  }

  /** The world tick now. */
  get tick(): number {
    return this.opts.tick(this.game);
  }

  /** The campaign entry played now, or null without a campaign. */
  entry(save: CampaignSave | null = this.save): CampaignRunState['entry'] {
    return this.opts.campaign?.session.run(save ?? undefined).entry ?? null;
  }

  /** The title of the entry `save` is at (the one played now by default): its `title`, else its id. */
  entryTitle(save: CampaignSave | null = this.save): string {
    const entry = this.entry(save);
    if (entry === null) return '';
    return entry.title ?? entry.scenario ?? entry.mission ?? entry.level ?? '';
  }

  /** True while the entry is held at tick 0, waiting for `begin` (M34). */
  held(): boolean {
    return this.holding;
  }

  /** The entry's title and text while it is held, else null. */
  briefing(): { title: string; text: string } | null {
    if (!this.holding) return null;
    return { title: this.entryTitle(), text: this.entry()?.text ?? '' };
  }

  /** How the entry played now ended, or null while it is still played (or without a campaign). */
  ended(): LaunchEntryResult | null {
    return this.result;
  }

  /** The save an earlier visit kept with an entry left to play, or null (offered at tick 0 only). */
  storedSave(): CampaignSave | null {
    if (this.tick !== 0 || this.result !== null) return null;
    return this.opts.campaign?.session.stored() ?? null;
  }

  /** Whether `mission` has a round to play; one without (a choice) is only decided. */
  canPlay(mission: string): boolean {
    return this.playable.has(mission);
  }

  /** True while a round is played. */
  playing(): boolean {
    return this.game.miniGame() !== null;
  }

  /** The missions the launch buttons offer now. */
  launchButtons(): string[] {
    if (this.waiting !== null || this.result !== null || this.holding || this.playing()) return [];
    return [...this.opts.offers(this.game)];
  }

  /** The open mission waiting for play or delegate, or null. */
  choice(): string | null {
    return this.waiting;
  }

  /** A mission's title (its id when the game has none). */
  title(mission: string): string {
    return this.titles.get(mission) ?? mission;
  }

  /** A mission's definition (for the in-picture mission card, Engine 0.16 F5), or null when the game has none of that id. */
  missionDef(mission: string): MissionDef | null {
    return this.defs.get(mission) ?? null;
  }

  /** An outcome's title from the mission file (its id when there is none). */
  outcomeTitle(mission: string, outcome: string): string {
    return this.outcomeTitles.get(`${mission}/${outcome}`) ?? outcome;
  }

  /** The committed missions' records, in commit order. */
  records(): readonly MissionRecord[] {
    return this.game.records();
  }

  /**
   * The status line: the round's key hint while one is played (with `keys`, the player's key
   * names), else the entry and tick, the last refusal, the choice's question, the last outcome and
   * the game's own line, joined with " | ".
   */
  status(keys: ControlKeyNames = {}): string {
    if (this.playing()) return this.game.roundHint?.(keys) ?? '';
    const title = this.entryTitle();
    const waiting = this.waiting;
    const record = this.records().at(-1);
    return [
      title === '' ? `tick ${this.tick}` : `${title}, tick ${this.tick}`,
      this.holding ? 'press Begin when ready' : '',
      this.message,
      waiting === null
        ? ''
        : this.canPlay(waiting)
          ? 'play the mission yourself, or delegate it?'
          : 'decide?',
      record ? this.outcomeTitle(record.mission, record.outcome) : '',
      this.opts.status?.(this.game) ?? '',
    ]
      .filter((s) => s !== '')
      .join(' | ');
  }

  /** A page button: carried out at the start of the next loop step. */
  press(button: LaunchButton): void {
    this.pressed.push(button);
  }

  /** One loop step (`HostScene` calls it, and so does the round's scene while it is on top). */
  update(input: InputFrame): void {
    this.stepped = [];
    const before = this.game;
    for (const b of this.pressed.splice(0)) this.button(b);
    if (this.game !== before) return; // a new entry starts at its tick 0 on the next step
    if (this.playing()) {
      this.step(input); // the round reads the frame's keys and taps
      return;
    }
    if (this.waiting !== null || this.result !== null || this.holding) return;
    const message = this.opts.control?.(this.game) ?? null;
    if (message !== null) this.message = message;
    if (++this.steps % this.stepsPerTick !== 0) return;
    this.step(input);
    const campaign = this.opts.campaign;
    if (campaign !== undefined && campaign.entryOver(this.game)) this.endEntry(campaign);
  }

  /** The game the page plays now, for the shell's step hook. */
  headless(): G {
    return this.game;
  }

  /**
   * The page's scene: the engine's `HostScene` over the game, stepped through `update`, pushing the
   * round's scene when a round starts; `picture` makes the drawer on the first render.
   */
  scene(stack: SceneStack, picture: (r: Renderer) => HostDrawer<G, unknown>): HostScene<G, unknown> {
    return new HostScene<G, unknown>({
      stack,
      step: (input) => this.update(input),
      world: () => this.game,
      // Only a loop step that stepped the game has events: the host may step every few loop steps.
      events: () => this.stepped,
      miniGame: () => this.game.miniGame(),
      headless: () => this.game,
      picture,
    });
  }

  private step(input: InputFrame): void {
    this.game.step(input);
    this.stepped = this.game.events;
  }

  /** The entry played now ends: its result, its save stored and its code packed. */
  private endEntry(campaign: LaunchCampaign<G>): void {
    const end = campaign.session.end(campaign.save(this.game));
    const summary = campaign.summary(this.game);
    this.result = {
      ...end,
      entry: this.entryId(),
      title: this.entryTitle(),
      outcomes: this.records().map((r) => this.outcomeTitle(r.mission, r.outcome)),
      people: [...summary.people],
      verdict: summary.verdict,
      next: end.save !== null && !end.done ? this.entryTitle(end.save) : null,
    };
  }

  private entryId(): string {
    const entry = this.entry();
    return entry?.scenario ?? entry?.mission ?? entry?.level ?? '';
  }

  /** Plays the entry `save` is at (the first, fresh, when null), held at tick 0 when the flow holds. */
  private start(save: CampaignSave | null): void {
    this.save = save;
    this.game = this.opts.create(save);
    this.waiting = null;
    this.result = null;
    this.steps = 0;
    this.holding = this.holds();
    this.opts.onGame?.(this.game);
  }

  private button(b: LaunchButton): void {
    const session = this.opts.campaign?.session;
    if (b.kind === 'begin') {
      this.holding = false;
      return;
    }
    if (b.kind === 'continue') {
      if (this.result === null) return;
      this.message = '';
      this.start(this.result.next === null ? null : this.result.save);
      return;
    }
    if (b.kind === 'code' || b.kind === 'stored') {
      if (session === undefined || this.playing()) return;
      if (b.kind === 'stored') {
        const save = this.storedSave();
        if (save === null) return;
        this.message = '';
        this.start(save);
        return;
      }
      const resumed = session.resume(b.text);
      if (!resumed.ok) {
        this.message = `${resumed.code}: ${resumed.error}`;
        return;
      }
      this.message = '';
      this.start(resumed.save);
      return;
    }
    if (this.result !== null || this.holding) return;
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
