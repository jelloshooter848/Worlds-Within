# kits/platformer fixtures

Test-only content (`engine/core/CLAUDE.md`, Fixtures): only `*.test.ts` files read these.

- `tiny.json` + `tiny.map.txt`: a 24x8 level with a floor, a three-tile gap, a two-tile step, a
  coin, a bump block holding a coin, one walker and a goal.
- `runner.profile.json`: a physics profile whose player numbers match SMBC's default runner
  (its movement profile and stomp bounce, in the same integer units, and its 150 ticks of
  invulnerability after a hit), two hit points (bricks break at two), with a walker, a
  shell-walker and a shell.
- `golden/`: the golden traces recorded from SMBC (`golden.test.ts`), their test map in the kit's
  level format, and their provenance and generator (`golden/README.md`).
