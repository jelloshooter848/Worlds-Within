import { EXIT } from './exit-codes';
import { KIT_LIST, kitListIsCurrent, writeKitList } from './kit-list-gen';

// `pnpm docs:gen` writes the kit list and the generated docs; `pnpm docs:check` regenerates them in
// memory and exits 4 (a failed check) with a summary per stale file. See kit-list-gen.ts and
// docs-gen.ts.
const mode = process.argv[2];
const root = process.cwd();

try {
  if (mode === 'gen') {
    // The kit list first, and only then the doc sources, which read every kit through it.
    const kitList = (await writeKitList(root)) ? [KIT_LIST] : [];
    const { defaultDocSources, writeDocs } = await import('./docs-gen');
    const changed = [...kitList, ...(await writeDocs(root, defaultDocSources()))];
    console.log(changed.length ? `wrote ${changed.join(', ')}` : 'the generated docs are up to date');
  } else if (mode === 'check') {
    const stale = (await kitListIsCurrent(root))
      ? []
      : [{ file: KIT_LIST, summary: 'does not list the kits/<name>/kit.ts hooks on disk' }];
    const { defaultDocSources, staleDocs } = await import('./docs-gen');
    stale.push(...(await staleDocs(root, defaultDocSources())));
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
