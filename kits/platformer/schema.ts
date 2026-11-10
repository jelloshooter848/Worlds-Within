import type { ContentKind, KindIssue } from '@engine/core/content/kinds';
import { checkLevel, levelSchema } from './level';
import type { ProfileDef } from './profile';

/**
 * The `level` content kind: a JSON header with its `map` in a sibling `.map.txt` text grid (or
 * inline), and its optional `decor` in a `.decor.txt` one (Engine 0.16 part C T1). `checkAll` runs `checkLevel` on every level, against the `profile` entry its header
 * names; each problem names the level file and field, or the `.map.txt` file and its row and col.
 */
export function levelKind(): ContentKind<typeof levelSchema> {
  return {
    name: 'level',
    description:
      'A platformer level: id, physics profile, scroll mode, spawns and bump-block contents, with its map in a text grid of the kit legend',
    schema: levelSchema,
    gridParts: { map: '.map.txt', decor: '.decor.txt' },
    checkAll: (entries, others) => {
      const profiles = new Map(others('profile').map((e) => [e.name, e.value as ProfileDef] as const));
      return entries.flatMap((e) =>
        checkLevel(e.value, profiles.get(e.value.profile)).map((p) => {
          const issue: KindIssue = { name: e.name, path: p.path, code: p.code, message: p.message };
          if (p.row !== undefined) issue.row = p.row;
          if (p.col !== undefined) issue.col = p.col;
          return issue;
        }),
      );
    },
  };
}
