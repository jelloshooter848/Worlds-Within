# Skills

Agent skills for common jobs, in `.claude/skills/<name>/SKILL.md`. Claude Code loads them by name;
any other agent can read them as plain Markdown steps. Each one uses only the CLI (`pnpm -s cli ...
--json`) and the files it names, so following it needs no other context than `llms.txt` and the
[cheat sheet](../CHEATSHEET.md).

- [scaffold-game](../../.claude/skills/scaffold-game/SKILL.md): make a new one-room game in
  `games/<name>/` on the top-down kit (manifest, room, headless and view entries, browser page, run
  file with golden hashes, agent docs) that passes `validate`, `run` and the four checks.
- [debug-failing-run](../../.claude/skills/debug-failing-run/SKILL.md): from a failing `run` to
  the first failing tick, a dump there and the tick before, a screenshot, the replay, mutant checks,
  then a fix and a rerun.

## Adding a skill

Make `.claude/skills/<name>/SKILL.md` with a front matter `name` and `description` (when to use it),
then numbered steps with the exact commands. Link it here and from `llms.txt`
(`tests/architecture/agent-docs.test.ts` checks every link there points at a file). `.gitignore`
keeps `.claude/skills/` while ignoring the rest of `.claude/`.
