import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import type { HeadlessGame, JsonObject, JsonValue, RoundRecording } from '@engine/core/headless';
import type { KitRoundBot, KitRoundBotDef } from '@engine/core/kit';
import type { MiniGame } from '@engine/core/minigame';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { openContentFile } from '../content-file';
import { EXIT, UsageError } from '../exit-codes';
import { loadGame } from '../game-loader';
import { playRun, type HashMismatch, type FailedCheck } from '../headless-run';
import { gameKits } from '../kits';
import { defineCommand, type Outcome } from '../registry';
import { readRunFile } from '../run-file';
import { writeValue } from './edit';

/**
 * `record <runFile> --mission <id> (--input <recording.json> | --bot <plan>)` (Engine 0.14 T9,
 * gap M19): writes a hosted round's recorded input into the run file's `play` step for that
 * mission (its first one; `--play N` for the N-th, 0-based), through the editing verbs' checked
 * path (`writeValue`: the whole run file checked against its schema, written, read back and
 * verified), then plays the run with its checks and sync hashes.
 *
 * - `--input <file>`: a recording as the page's `window.__ww.recordings()` gives it (the list, or
 *   one `{ mission, tick, input }` of it) or a bare `{ steps }` script. From a list, the recording of
 *   that mission at the play step's tick is taken (else the only one of that mission).
 * - `--bot <plan>` (JSON, or `@file`): plays the run headless with the play step's own `input`
 *   left out, and while that round is hosted feeds it what the bot of the kit whose mini game it is
 *   holds (`KitDef.roundBots`: the topdown kit's `TopDownBot` for `mission-room`, the
 *   tower-defense kit's `TdBot` for `td-defence`). Only that step's round is driven: the bot is
 *   made on the first tick hosted after the step is handed over and dropped when its round ends,
 *   and every other round in the run plays as the file says. The game records the round
 *   (`HeadlessGame.recordRounds`) and that recording is written.
 *
 * Result: `{ run, mission, play, tick, source, ticks, steps, input, file, path, written, verified,
 * changed, restored, passed, finalHash, hashMismatch, failure, crossErrors }`. Exit 0 written,
 * verified and the run passes; 4 the run fails with it (a failed check, or a different round that
 * moves the sync hashes) and the file is put back as it was (`restored: true`; docs/BUILD-LOG.md,
 * Engine 0.14, decision 10), or the read-back differs; 3 a run file or recording that breaks the
 * schema (with `errors`, the file untouched); 2 a mission with no `play` step, a recording of
 * another mission or tick, no or both sources, a bad bot plan, or a game that cannot record.
 */

/** The JSON of `--input`'s file, or of `--bot`'s text (`@path` reads a file). */
function readJson(cwd: string, text: string, what: string): unknown {
  let source = text;
  if (text.startsWith('@') || what === '--input') {
    const path = text.startsWith('@') ? text.slice(1) : text;
    const abs = resolve(cwd, path);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new UsageError(`${what}: no file at ${path}`);
    source = readFileSync(abs, 'utf8');
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new UsageError(`${what}: not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The input to write from `--input`'s JSON: a bare script, one recording, or a list of them. Only
 * the wrapping is checked here; the input itself is checked by the run file's schema on write.
 */
export function pickRecording(
  json: unknown,
  mission: string,
  tick: number,
): { input: JsonValue; tick: number | null; ticks: number | null } {
  if (isObject(json) && !('input' in json)) return { input: json as JsonValue, tick: null, ticks: null };
  const list = Array.isArray(json) ? json : [json];
  const ofMission = list.filter((r) => isObject(r) && r['mission'] === mission) as Record<string, unknown>[];
  if (ofMission.length === 0) {
    const named = list.map((r) => (isObject(r) ? String(r['mission']) : '?')).join(', ') || 'none';
    throw new UsageError(`--input holds no recording of mission "${mission}" (it has: ${named})`);
  }
  const at = ofMission.filter((r) => r['tick'] === tick);
  const chosen = at[0] ?? (ofMission.length === 1 ? ofMission[0]! : undefined);
  if (chosen === undefined)
    throw new UsageError(
      `--input has ${ofMission.length} recordings of "${mission}" and none at the play step's tick ${tick}`,
    );
  if (typeof chosen['tick'] === 'number' && chosen['tick'] !== tick)
    throw new UsageError(
      `the recording of "${mission}" was played at tick ${chosen['tick']}, but the run file plays it at tick ${tick}: the round would start from another world`,
    );
  if (chosen['done'] === false)
    throw new UsageError(`the recording of "${mission}" is of a round that had not ended`);
  if (!('input' in chosen)) throw new UsageError(`the recording of "${mission}" has no "input"`);
  return {
    input: chosen['input'] as JsonValue,
    tick: typeof chosen['tick'] === 'number' ? chosen['tick'] : null,
    ticks: typeof chosen['ticks'] === 'number' ? chosen['ticks'] : null,
  };
}

/** The kits' round bots for a game, by mini game id. */
function botsOf(manifest: {
  kit: string;
  uses?: readonly string[] | undefined;
}): Map<string, KitRoundBotDef> {
  const bots = new Map<string, KitRoundBotDef>();
  for (const kit of gameKits(manifest)) for (const bot of kit.roundBots?.() ?? []) bots.set(bot.game, bot);
  return bots;
}

/**
 * Plays the run with the bot driving the play step's round (entry `index`, played at `tick`) and
 * returns that round's recording. Every other round the run hosts, before or after it, gets the
 * scripted frame as before; the bot is made when the target round starts and dropped when it ends.
 */
async function botRecording(
  cwd: string,
  runFile: string,
  ticks: number,
  index: number,
  mission: string,
  tick: number,
  bots: Map<string, KitRoundBotDef>,
  plan: unknown,
): Promise<{ ok: true; recording: RoundRecording } | { ok: false; errors: ContentError[] }> {
  let recordings: () => RoundRecording[] = () => [];
  let bot: KitRoundBot | null = null;
  // 'waiting' for the target play step; 'armed' once it is handed over, so the next round hosted
  // is its round; 'driving' that round (`driven`); 'done' once it has ended.
  let state: 'waiting' | 'armed' | 'driving' | 'done' = 'waiting';
  let driven: MiniGame | null = null;
  const frame = new ScriptedInput({ steps: [] });
  const played = await playRun(cwd, runFile, {
    untilTick: ticks,
    prepare(game: HeadlessGame) {
      if (game.recordRounds === undefined || game.roundRecordings === undefined)
        throw new UsageError(
          'record --bot: the game cannot record its rounds (its game has no recordRounds(); engine/core/headless.ts)',
        );
      game.recordRounds(true);
      recordings = () => game.roundRecordings!();
    },
    missionStep(step, i) {
      if (i !== index) return step;
      state = 'armed';
      const { input: _input, ...rest } = step as typeof step & { input?: unknown };
      return rest as typeof step;
    },
    frameFor(game, scripted) {
      const round = game.miniGame?.() ?? null;
      if (state === 'driving' && round !== driven) {
        state = 'done';
        bot = null;
      }
      if (round === null || state === 'waiting' || state === 'done') return scripted;
      if (state === 'armed') {
        // The round the play step started: find the bot for its mini game.
        state = 'driving';
        driven = round;
        const id = (game.snapshot()['missions'] as JsonObject | undefined)?.['round'] as
          JsonObject | undefined;
        const playId = String(id?.['game'] ?? '');
        const def = bots.get(playId);
        if (def === undefined)
          throw new UsageError(
            `record --bot: no kit of the game has a bot for mini game "${playId}" (bots: ${[...bots.keys()].join(', ') || 'none'})`,
          );
        const parsed = def.plan.safeParse(plan);
        if (!parsed.success)
          throw new UsageError(
            `record --bot: the plan is not a "${playId}" bot plan (${def.description}): ${parsed.error.issues
              .map((i) => `${i.path.join('.') || '(plan)'}: ${i.message}`)
              .join('; ')}`,
          );
        bot = def.create(parsed.data);
      }
      frame.setHeld(bot!.next(round));
      frame.next();
      return frame;
    },
  });
  if (!played.ok) return played;
  const recording = recordings().find((r) => r.mission === mission && r.tick === tick);
  if (recording === undefined || !recording.done)
    throw new UsageError(
      `record --bot: the "${mission}" round played at tick ${tick} did not start or did not end within the run's ticks`,
    );
  return { ok: true, recording };
}

export const recordCommand = defineCommand({
  name: 'record',
  summary: "write a hosted round's recorded input into a run file's play step, then run it",
  args: z.strictObject({
    runFile: z
      .string()
      .min(1)
      .describe('the run file, such as games/samples/mini-siege/runs/played.run.json'),
  }),
  flags: z.strictObject({
    mission: z.string().min(1).describe('the mission whose play step takes the recording'),
    input: z
      .string()
      .min(1)
      .optional()
      .describe(
        'a recording file: window.__ww.recordings() from the page (the list or one entry) or a bare { steps } script',
      ),
    bot: z
      .string()
      .min(1)
      .optional()
      .describe(
        'play the round headless with the kit\'s bot and record it: the bot\'s plan as JSON, or @file ({"engine-camp": [{"do": "fight"}]} for mission-room)',
      ),
    play: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("which of the mission's play steps, 0-based (default 0, the first)"),
  }),
  async run({ args, flags }, ctx): Promise<Outcome> {
    if ((flags.input === undefined) === (flags.bot === undefined))
      throw new UsageError('record takes one source: --input <recording.json> or --bot <plan>');
    const loaded = readRunFile(ctx.cwd, args.runFile);
    if (!loaded.ok)
      return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: loaded.errors } };
    const { run, gameDir } = loaded.value;
    if (gameDir === null) throw new UsageError('record works on game runs; a world run has no rounds');
    const plays = run.missions
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.mission === flags.mission && step.action === 'play');
    const nth = flags.play ?? 0;
    const target = plays[nth];
    if (target === undefined) {
      const missions = [...new Set(run.missions.filter((m) => m.action === 'play').map((m) => m.mission))];
      throw new UsageError(
        plays.length === 0
          ? `${loaded.value.file} has no "play" step for mission "${flags.mission}" (play steps: ${missions.join(', ') || 'none'})`
          : `${loaded.value.file} has ${plays.length} "play" step(s) for "${flags.mission}"; --play ${nth} is past them`,
      );
    }
    const tick = target.step.tick;

    let input: JsonValue;
    let ticks: number | null;
    if (flags.input !== undefined) {
      ({ input, ticks } = pickRecording(readJson(ctx.cwd, flags.input, '--input'), flags.mission, tick));
    } else {
      const game = loadGame(ctx.cwd, gameDir).content;
      if (!game.ok) return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: game.errors } };
      const bots = botsOf(game.value.manifest);
      const made = await botRecording(
        ctx.cwd,
        args.runFile,
        run.ticks,
        target.index,
        flags.mission,
        tick,
        bots,
        readJson(ctx.cwd, flags.bot!, '--bot'),
      );
      if (!made.ok) return { exit: EXIT.invalidContent, result: { run: args.runFile, errors: made.errors } };
      input = made.recording.input as unknown as JsonValue;
      ticks = made.recording.ticks;
    }

    const base = {
      run: loaded.value.file,
      mission: flags.mission,
      play: nth,
      tick,
      source: flags.input !== undefined ? 'input' : 'bot',
      ticks,
      steps: isObject(input) && Array.isArray(input['steps']) ? input['steps'].length : null,
    };
    const abs = resolve(ctx.cwd, args.runFile);
    const original = readFileSync(abs, 'utf8');
    const written = await writeValue(
      openContentFile(ctx.cwd, args.runFile),
      ['missions', String(target.index), 'input'],
      input,
    );
    // The edit's `before` and `after` are whole scripts: `input` and `changed` say it shorter.
    const { before: _before, after: _after, ...edit } = written.result;
    if (written.exit !== EXIT.ok)
      return { exit: written.exit, result: { ...base, ...edit, input, passed: null, finalHash: null } };

    const played = await playRun(ctx.cwd, args.runFile);
    const restore = () => writeFileSync(abs, original);
    if (!played.ok) {
      restore();
      return {
        exit: EXIT.invalidContent,
        result: { ...base, ...edit, input, restored: true, errors: played.errors },
      };
    }
    const { failures, hashMismatch, hashes } = played.value;
    const passed = failures.length === 0 && hashMismatch === null;
    // Decision 10: a recording the run does not pass with is not kept.
    if (!passed) restore();
    return {
      exit: passed ? EXIT.ok : EXIT.failedCheck,
      result: {
        ...base,
        ...edit,
        input,
        restored: !passed,
        passed,
        finalHash: hashes.at(-1)?.hash ?? null,
        hashMismatch,
        failure: failures[0] ?? null,
      },
    };
  },
  text(result) {
    if (result.errors) {
      const head = result.written === false ? `${String(result.run)}: refused, the file is unchanged\n` : '';
      return head + formatErrors(result.errors as ContentError[]);
    }
    const lines = [
      `${String(result.run)}: "${String(result.mission)}" play step at tick ${String(result.tick)} <- ${String(result.source)} (${String(result.steps)} step(s), ${result.ticks === null ? '?' : String(result.ticks)} round tick(s)); ${result.changed === true ? 'changed' : 'unchanged'}, ${result.verified === true ? 'verified' : 'NOT verified'}`,
      `  run ${result.passed ? 'passed' : 'FAILED: the run file is put back as it was'}; final hash ${String(result.finalHash)}`,
    ];
    const mismatch = result.hashMismatch as HashMismatch | null;
    if (mismatch)
      lines.push(
        `  hash MISMATCH at tick ${mismatch.tick}: expected ${mismatch.expected}, got ${mismatch.actual} (re-record the run's hashes)`,
      );
    const failure = result.failure as FailedCheck | null;
    if (failure) lines.push(`  tick ${failure.tick}: ${failure.kind} ${failure.index}: ${failure.message}`);
    return lines.join('\n');
  },
});
