import { defaultDocSources, staleDocs, writeDocs } from './docs-gen';
import { EXIT } from './exit-codes';

// `pnpm docs:gen` writes the generated docs; `pnpm docs:check` regenerates them in memory and exits
// 4 (a failed check) with a summary per stale page. See docs-gen.ts.
const mode = process.argv[2];
const root = process.cwd();

try {
  if (mode === 'gen') {
    const changed = await writeDocs(root, defaultDocSources());
    console.log(changed.length ? `wrote ${changed.join(', ')}` : 'the generated docs are up to date');
  } else if (mode === 'check') {
    const stale = await staleDocs(root, defaultDocSources());
    if (stale.length === 0) console.log('the generated docs are up to date');
    else {
      for (const s of stale) console.error(`${s.file}: ${s.summary}`);
      console.error('The generated docs are out of date: run "pnpm docs:gen" and commit the result.');
      process.exitCode = EXIT.failedCheck;
    }
  } else {
    console.error('usage: tsx engine/tools/docs.ts gen|check');
    process.exitCode = EXIT.usage;
  }
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = EXIT.crash;
}
