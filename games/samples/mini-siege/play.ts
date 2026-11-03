import { saveCodeContext } from '@engine/core/campaign-code';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import { RtsCamera } from '@engine/core/present';
import type { SceneStack } from '@engine/core/scene';
import { CampaignSession } from '@engine/core/shell/campaign-session';
import type { HostDrawer, HostScene } from '@engine/core/shell/host-scene';
import { MissionLaunch, type EntrySummary } from '@engine/core/shell/mission-launch';
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
 * them), so Node tests drive it with scripted presses. Since Engine 0.15 T10 (gaps M26, M34, M36,
 * lesson D14) the page's flow is the engine's: `launch` is the shell's `MissionLaunch`
 * (`engine/core/shell/mission-launch.ts`: the launch buttons, the battle paused while the player
 * chooses to play or delegate, the round stepped, every campaign entry held at tick 0 until the
 * player begins it, the entry's end, the result, Continue and resuming from a save code), and the
 * shell's `mountMissionBar` is its DOM. This file hands it only what is the mini siege's or the
 * RTS kit's:
 *
 * - **the game**: `createGame` at the campaign entry a save is at (the siege from the start when
 *   none), the engine's `CampaignSession` over the campaign file, and the game's `entryOver`
 *   (the engine's one rule, gap M35) and `campaignSave()`;
 * - **the offers**: the RTS kit's `missionButtons` (the opportunities open now);
 * - **the battle's controls**: the pointer's gestures to the kit's `RtsControls` (select, command,
 *   pan, zoom; an order to `RtsGame.issue`, its refusal the status line's), with the engine's
 *   `RtsCamera` starting east of the hall, fresh for every entry. The battle steps one world tick
 *   every `stepsPerTick` loop steps (`TICKS_PER_SECOND` on the page): that pace stays this glue's,
 *   not the shell's scene `tickRate` (gap D2), as the battle reads the pointer every loop step;
 * - **the entry's summary**: the village's named people and their fates, and the verdict (the hall
 *   fallen, the raiders beaten, every defender fallen, or the hall standing), which is also the
 *   status line's last part.
 *
 * The rounds' key hints are the kits' (`missionRoom` and `tdDefence` declare their controls), and
 * taps in the walls' round are frame input the kit's round reads itself (gaps D1, D12).
 */

/** World ticks the page plays per second while no round is hosted (the loop steps 60 a second). */
export const TICKS_PER_SECOND = 10;
export const STEPS_PER_TICK = 60 / TICKS_PER_SECOND;

/** What the page reads of the pointer each step (`PointerSource`, or a script in tests). */
export interface GestureFeed {
  gestures(): readonly PointerGesture[];
}

export interface SiegePlayOptions {
  /** The game's content and seed (`game.json`'s `start.seed` on the page). */
  content: ContentBundle;
  seed: number;
  /** The pointer, or null (buttons only). */
  pointer: GestureFeed | null;
  /** Loop steps per world tick (default `STEPS_PER_TICK`). */
  stepsPerTick?: number;
  /** Hold each campaign entry at tick 0 until `begin` (default true, gap M34). */
  hold?: boolean;
}

export class SiegePlay {
  /** The engine's mission-launch flow over the game. */
  readonly launch: MissionLaunch<MiniSiegeGame>;
  readonly session: CampaignSession;
  camera!: RtsCamera;
  controls!: RtsControls;

  constructor(private readonly opts: SiegePlayOptions) {
    const { content } = opts;
    this.session = new CampaignSession(saveCodeContext(content), siegeCampaign(content));
    this.launch = new MissionLaunch<MiniSiegeGame>({
      create: (save) =>
        save === null ? createGame(content, opts.seed) : createGame(content, save.seed, { campaign: save }),
      missions: siegeMissions(content),
      offers: (game) => missionButtons(game.rts.view()),
      tick: (game) => game.rts.tick,
      stepsPerTick: opts.stepsPerTick ?? STEPS_PER_TICK,
      control: (game) => this.control(game),
      onGame: (game) => this.lookAt(game),
      status: (game) => {
        const verdict = this.verdict(game);
        return verdict === 'the hall still stands' || verdict === 'every defender has fallen' ? '' : verdict;
      },
      campaign: {
        session: this.session,
        entryOver: (game) => game.entryOver(),
        save: (game) => game.campaignSave(),
        summary: (game) => this.summary(game),
        hold: opts.hold ?? true,
      },
    });
  }

  /** The campaign entry played now (a new game when the campaign moves on). */
  get game(): MiniSiegeGame {
    return this.launch.game;
  }

  /** The scenario entry played now (`village`, `dawn`). */
  get scenario(): string {
    return this.game.campaign.scenario;
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
  sides(game: MiniSiegeGame = this.game): Record<string, SideSummary> {
    return sidesOf(game.rts.view(), game.factions);
  }

  /** The interface state the battle's frames show (selection, box, camera). */
  readonly ui: InterfaceOptions = () => this.controls.presentOptions(this.view());

  /** The page's scene: the launch's `HostScene`, drawing through `picture`. */
  scene(
    stack: SceneStack,
    picture: (r: Renderer) => HostDrawer<MiniSiegeGame, unknown>,
  ): HostScene<MiniSiegeGame, unknown> {
    return this.launch.scene(stack, picture);
  }

  /** A camera east of the hall and fresh controls, for a new entry's game. */
  private lookAt(game: MiniSiegeGame): void {
    const view = game.rts.view();
    const cols = view.terrain?.width ?? 1;
    const rows = view.terrain?.height ?? 1;
    const hall = view.buildings.find((b) => b.faction === PLAYER);
    this.camera = new RtsCamera({
      view: this.opts.content.manifest.screen,
      area: { x: 0, y: 0, w: cols * RTS_TILE_SIZE, h: rows * RTS_TILE_SIZE },
      ...(hall && {
        centre: { x: (hall.x + hall.w / 2 + 6) * RTS_TILE_SIZE, y: (hall.y + hall.h / 2) * RTS_TILE_SIZE },
      }),
    });
    this.controls = new RtsControls(PLAYER, this.camera, RTS_TILE_SIZE, game.rts.rules);
  }

  /** The pointer's gestures this loop step as orders; the last order's refusal ('' when taken). */
  private control(game: MiniSiegeGame): string | null {
    let message: string | null = null;
    for (const g of this.opts.pointer?.gestures() ?? []) {
      const draft = this.controls.gesture(g, game.rts.view());
      if (draft !== null) message = game.rts.issue(draft).error ?? '';
    }
    return message;
  }

  /** How the battle stands: the hall fallen, the raiders beaten, every defender fallen, or neither. */
  private verdict(game: MiniSiegeGame): string {
    const sides = this.sides(game);
    const hall = game.named()['hall'];
    const raiders = Object.entries(sides).filter(([f]) => f !== PLAYER);
    if (hall && !hall.alive) return 'the hall has fallen';
    if (raiders.every(([, s]) => s.units === 0)) return 'the raiders are beaten';
    if (sides[PLAYER]?.units === 0) return 'every defender has fallen';
    return 'the hall still stands';
  }

  /** The village's named people and their fates, and the verdict, at an entry's end. */
  private summary(game: MiniSiegeGame): EntrySummary {
    return {
      people: game.rts
        .view()
        .named.filter((n) => n.faction === PLAYER)
        .map((n) => `${n.name}: ${n.fate}${n.fate === 'dead' ? '' : `, ${n.hp}/${n.maxHp} hp`}`),
      verdict: this.verdict(game),
    };
  }
}
