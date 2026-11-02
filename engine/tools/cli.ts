import { main } from './main';

// The entry point for `pnpm cli <command>` (package.json runs it with tsx). Everything else is in
// main.ts, which tests call with captured IO.
const code = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
});
process.exitCode = code;
