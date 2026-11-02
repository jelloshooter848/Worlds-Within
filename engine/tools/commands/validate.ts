import { z } from 'zod';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { EXIT } from '../exit-codes';
import { loadGame } from '../game-loader';
import { defineCommand } from '../registry';

/**
 * `validate <game>`: checks `game.json` and every content file against its schema. Cheap: it
 * reads files and runs schemas, and starts nothing (no world, no backend, no game code).
 *
 * Result: `{ game, fileCount, errorCount, files: [{ file, errors }], errors: ContentError[] }`,
 * where `files` lists every file read with its number of errors and `errors` holds each one
 * (`{ file, path, pointer, message, code, row?, col?, line? }`). Exit 0 when there are none, 3
 * (`invalidContent`) otherwise.
 */
export const validateCommand = defineCommand({
  name: 'validate',
  summary: 'check every content file of a game against its schema (starts nothing)',
  args: z.strictObject({
    game: z.string().min(1).describe('the game folder, such as games/demo'),
  }),
  flags: z.strictObject({}),
  run({ args }, ctx) {
    const game = loadGame(ctx.cwd, args.game);
    const errors: ContentError[] = game.content.ok ? [] : game.content.errors;
    const root = game.dir === '.' ? '' : `${game.dir}/`;
    const perFile = new Map<string, number>(game.files.map((f) => [`${root}${f}`, 0]));
    for (const e of errors) perFile.set(e.file, (perFile.get(e.file) ?? 0) + 1);
    return {
      exit: errors.length === 0 ? EXIT.ok : EXIT.invalidContent,
      result: {
        game: game.dir,
        fileCount: game.files.length,
        errorCount: errors.length,
        files: [...perFile].map(([file, n]) => ({ file, errors: n })),
        errors,
      },
    };
  },
  text(result) {
    const errors = result.errors as ContentError[];
    const head = `${String(result.game)}: ${String(result.fileCount)} file(s), ${errors.length} error(s)`;
    return errors.length === 0 ? head : `${head}\n${formatErrors(errors)}`;
  },
});
