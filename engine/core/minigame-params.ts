import type { ContentBundle } from './content/bundle';
import { contentError, issuesToErrors, type ContentError, type FieldPath } from './content/validate';
import type { JsonObject } from './headless';
import type { MiniGameDef, MiniGameWorldScenario } from './minigame';

/**
 * Checking the content's mini game params with the content (Engine 0.10, gap G16, item 157): every
 * place in a game's content that names a mini game and hands it `params` (a platformer level's
 * trigger, a mission's `play` and `params`) is a {@link MiniGameUse}; {@link miniGameParamErrors}
 * checks each against the game's mini games, so `validate` reports a bad param or an unknown mini
 * game id at its file and field instead of the round throwing when it starts.
 *
 * The engine finds the missions' uses itself ({@link missionMiniGameUses}); a kit whose content
 * names mini games gives its own through its hook (`KitDef.miniGameUses`, `kit.ts`). The tools learn
 * a game's mini games from its headless entry (`HeadlessEntry.miniGames`, `headless.ts`). Pure.
 */

/** One place in the content that names a mini game and the params it hands it. */
export interface MiniGameUse {
  /** The content file, relative to the game folder (an entry's `file`). */
  readonly file: string;
  /** The mini game id named there. */
  readonly game: string;
  /** Where the id is in the file (`['triggers', 0, 'game']`, `['play']`). */
  readonly gameAt: FieldPath;
  /** The params handed to the round (`{}` when none). */
  readonly params: JsonObject;
  /** Where the params are in the file (`['triggers', 0, 'params']`, `['params']`). */
  readonly paramsAt: FieldPath;
  /**
   * The content entry that names the mini game, for the def's `checkUse` (Engine 0.11): a
   * mission's whole definition. Left out (a level trigger), `checkUse` gets null.
   */
  readonly owner?: JsonObject;
}

/**
 * Every mission's use (`*.mission.json`: `play` names the mini game, `params` its params). A
 * mission with no `play` (a choice, only delegated: Engine 0.13) names none and is left out.
 */
export function missionMiniGameUses(content: ContentBundle): MiniGameUse[] {
  return content.entries
    .filter((e) => e.kind === 'mission' && typeof (e.value as JsonObject)['play'] === 'string')
    .map((e) => {
      const m = e.value as JsonObject & { play: string; params?: JsonObject };
      return {
        file: e.file,
        game: m.play,
        gameAt: ['play'],
        params: m.params ?? {},
        paramsAt: ['params'],
        owner: m,
      };
    });
}

/**
 * A world scenario of the game, as the tools build it for `validate` (Engine 0.15 T7, lesson D7):
 * what `checkUse` sees (`MiniGameWorldScenario`) plus the missions its opportunities offer.
 */
export interface GameWorldScenario extends MiniGameWorldScenario {
  /** The mission ids the scenario's `opportunities` name. */
  readonly offers: readonly string[];
}

/**
 * The errors of `uses` against the game's mini games `defs`, in the uses' order: `unknown_mini_game`
 * at the id when no def has it (naming the ids there are), else each issue of the def's
 * `paramsSchema` (when it has one) at its field under the params (`triggers.0.params.goal`), with
 * Zod's codes, and, once the params pass it, each problem of the def's `checkUse` (Engine 0.11) as
 * `bad_mini_game_use` at its field. `root` goes in front of each file name, as in `loadContent`.
 * `scenarios` (Engine 0.15 T7, lesson D7): the game's world scenarios; a mission's `checkUse` is
 * handed the ones whose opportunities offer it, so its selectors are checked against those worlds.
 */
export function miniGameParamErrors(
  uses: readonly MiniGameUse[],
  defs: readonly MiniGameDef[],
  root = '',
  scenarios: readonly GameWorldScenario[] = [],
): ContentError[] {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const known = defs.map((d) => `"${d.id}"`).join(', ') || 'none';
  const errors: ContentError[] = [];
  for (const use of uses) {
    const file = `${root}${use.file}`;
    const def = byId.get(use.game);
    if (!def) {
      const message = `unknown mini game "${use.game}" (the game has: ${known})`;
      errors.push(contentError(file, use.gameAt, 'unknown_mini_game', message));
      continue;
    }
    if (def.paramsSchema) {
      const parsed = def.paramsSchema.safeParse(use.params);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ ...i, path: [...use.paramsAt, ...i.path] }));
        errors.push(...issuesToErrors(file, issues));
        continue;
      }
    }
    const id = use.owner?.['id'];
    const offered = scenarios
      .filter((sc) => typeof id === 'string' && sc.offers.includes(id))
      .map(({ file, snapshot, keys }) => ({ file: `${root}${file}`, snapshot, keys }));
    const check = { params: use.params, owner: use.owner ?? null, scenarios: offered };
    for (const problem of def.checkUse?.(check) ?? [])
      errors.push(
        contentError(file, [...use.paramsAt, ...problem.path], 'bad_mini_game_use', problem.message),
      );
  }
  return errors;
}
