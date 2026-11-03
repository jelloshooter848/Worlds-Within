import { CanvasRenderer } from '@engine/backends/canvas2d';
import type { HeadlessEntry, JsonObject, JsonValue } from '@engine/core/headless';
import { stateHash } from '@engine/core/state-hash';
import type { ViewEntry, ViewGame } from '@engine/core/view';
import type { Change } from '@engine/sim/index';
import { changeLine, filterChanges, type EventFilter } from '../event-filter';
import { checkGameTexts } from '../game-check';
import {
  DEBUG_JOB_PATH,
  type DebugDumpJob,
  type DebugJob,
  type DebugKind,
  type DebuggerApi,
  type DebugRunJob,
} from './job';
import { DebugSession, headlessOptions, searchState, type CheckResult, type StateDiff } from './model';

/**
 * The debugger page (browser only, tools only; Engine 0.14 T10). `pnpm cli debug <file>` serves
 * it with a job (`job.ts`) at {@link DEBUG_JOB_PATH}: the page fetches it, checks the game's
 * content, imports the game's headless module (and its view, to draw the picture beside the
 * state) by URL, and steps the run in a `DebugSession` (`model.ts`): forward 1, 10 or N, to a
 * tick, and back by re-simulating from tick 0. Panels: the picture, the run's checks at the tick,
 * the hashes against the golden file, a collapsible state tree with search and the paths changed
 * since the previous tick, and the world's event log with filters. A dump file opens read-only at
 * its tick (Play from here plays its run there). `window.__wwDebugger` (`DebuggerApi`) is the
 * same for tests and the console. `?tick=N` opens at tick N.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`the debugger page has no #${id}`);
  return el as T;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls !== undefined) node.className = cls;
  return node;
}

const show = (v: JsonValue): string => JSON.stringify(v);

/** What the panels read, the same for a session and a dump. */
interface Source {
  kind: DebugKind;
  tick: number;
  ticks: number;
  hash(): string;
  state(): JsonObject;
  events(filter?: EventFilter): Change[] | null;
  stepEvents(): Change[] | null;
  eventCount(): number | null;
  checks(): CheckResult[];
  diff(): StateDiff[];
  mismatch: DebuggerApi['mismatch'];
  hashRows(): {
    tick: number;
    hash: string;
    source: string;
    actual: string | null;
    matches: boolean | null;
  }[];
  readOnly: boolean;
}

let source: Source | null = null;
let ready = false;
let error: string | null = null;
let picture: ((session: DebugSession<ViewGame>) => void) | null = null;
let session: DebugSession<ViewGame> | null = null;
let dumpJob: DebugDumpJob | null = null;

function fail(why: string): never {
  error = why;
  $('summary').textContent = `Cannot open the file: ${why}`;
  throw new Error(why);
}

/** A run job's session as panels read it. */
function sessionSource(s: DebugSession<ViewGame>, kind: DebugKind): Source {
  return {
    kind,
    get tick() {
      return s.tick;
    },
    ticks: s.ticks,
    hash: () => s.hash(),
    state: () => s.state(),
    events: (filter = {}) => s.events(filter)?.changes ?? null,
    stepEvents: () => s.stepEvents(),
    eventCount: () => s.events()?.changes.length ?? null,
    checks: () => s.checks(),
    diff: () => s.diff(),
    mismatch: () => s.mismatch,
    hashRows: () => s.hashRows(),
    readOnly: false,
  };
}

/** A dump as panels read it: one tick, read-only. */
function dumpSource(job: DebugDumpJob): Source {
  const { dump } = job;
  const hash = stateHash(dump.state as JsonObject);
  const changes = (dump.events?.changes ?? null) as Change[] | null;
  return {
    kind: 'dump',
    tick: dump.tick,
    ticks: job.run?.ticks ?? dump.tick,
    hash: () => hash,
    state: () => dump.state as JsonObject,
    events: (filter = {}) => (changes === null ? null : filterChanges(changes, filter)),
    stepEvents: () => changes,
    eventCount: () => changes?.length ?? null,
    checks: () => [],
    diff: () => [],
    mismatch: () =>
      hash === dump.hash ? null : { tick: dump.tick, kind: 'stored', expected: dump.hash, actual: hash },
    hashRows: () => [
      { tick: dump.tick, hash: dump.hash, source: 'dump', actual: hash, matches: hash === dump.hash },
    ],
    readOnly: true,
  };
}

async function startRun(job: DebugRunJob, tick: number): Promise<void> {
  const content = checkGameTexts(job.files, job.root);
  if (!content.ok) fail(`the game's content has errors: ${JSON.stringify(content.errors)}`);
  const entry = (await import(/* @vite-ignore */ job.headlessUrl)) as Partial<HeadlessEntry>;
  if (typeof entry.createGame !== 'function')
    fail(`${job.headlessUrl} does not export createGame(content, seed) (engine/core/headless.ts)`);
  const viewEntry =
    job.viewUrl === null ? null : ((await import(/* @vite-ignore */ job.viewUrl)) as Partial<ViewEntry>);
  const createView = viewEntry?.createView;
  const opts = headlessOptions(job);
  const createGame = entry.createGame;
  session = new DebugSession<ViewGame>(job, () => createGame(content.value, job.seed, opts), {
    ...(typeof createView === 'function'
      ? { makeView: () => createView(content.value, job.seed, opts) }
      : {}),
  });
  if (typeof createView === 'function') {
    const canvas = $<HTMLCanvasElement>('picture');
    canvas.width = job.screen.width;
    canvas.height = job.screen.height;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      const renderer = new CanvasRenderer(ctx);
      picture = (s) => s.view?.render(renderer);
      $('picture-panel').hidden = false;
    }
  }
  source = sessionSource(session, job.kind);
  session.goto(tick);
  $('to').setAttribute('max', String(job.ticks));
  const title = job.kind === 'replay' ? `Replay ${job.file}` : `Run ${job.file}`;
  $('title').textContent = title;
  const failure = job.failure === null ? '' : ` · failed at tick ${job.failure.tick}: ${job.failure.message}`;
  $('summary').textContent = `${job.game} · seed ${job.seed} · ${job.ticks} ticks${failure}`;
  $('play').hidden = true;
}

function startDump(job: DebugDumpJob): void {
  dumpJob = job;
  source = dumpSource(job);
  const { dump } = job;
  $('title').textContent = `Dump ${job.file} (read-only)`;
  $('summary').textContent =
    `${dump.game ?? dump.world ?? '?'} · seed ${dump.seed} · tick ${dump.tick} of ${dump.run}`;
  $('play').hidden = job.run === null;
}

// --- Panels -------------------------------------------------------------------------------------

function renderAll(): void {
  if (source === null) return;
  const s = source;
  for (const id of ['first', 'back10', 'back1', 'fwd1', 'fwd10', 'fwdN', 'goto', 'last'])
    $<HTMLButtonElement>(id).disabled = s.readOnly;
  $('where').textContent = `tick ${s.tick} / ${s.ticks} · hash ${s.hash()}`;
  const m = s.mismatch();
  const banner = $('banner');
  banner.hidden = m === null;
  if (m !== null)
    banner.textContent = `Not the run: at tick ${m.tick} the ${m.kind === 'view' ? "view's" : "page's"} hash is ${m.actual}, expected ${m.expected}${m.kind === 'stored' ? ` (${m.source ?? 'stored'})` : m.kind === 'rewind' ? ' (the first time there)' : ' (the headless game)'}. Stepping stops there.`;
  if (session !== null && picture !== null) picture(session);
  renderChecks(s);
  renderHashes(s);
  renderTree(s);
  renderEvents(s);
}

function renderChecks(s: Source): void {
  const list = $('checks');
  list.replaceChildren();
  const checks = s.checks();
  if (checks.length === 0)
    list.append(el('li', s.readOnly ? 'A dump has no checks.' : 'No checks at this tick.', 'muted'));
  for (const c of checks) {
    const where = c.kind === 'assertion' ? `assertion ${c.index} @${c.tick}` : `invariant ${c.index}`;
    const line = `${c.passed ? 'pass' : 'FAIL'} ${where}: ${c.path} ${c.op} ${show(c.value)}${c.message === null ? '' : ` (${c.message})`}`;
    list.append(el('li', line, c.passed ? 'pass' : 'fail'));
  }
  if (session !== null) {
    const failed = session.failedTicks();
    if (failed.length > 0)
      list.append(
        el(
          'li',
          `checks failed at ticks: ${failed.slice(0, 40).join(', ')}${failed.length > 40 ? '…' : ''}`,
          'fail',
        ),
      );
    for (const a of session.assertions().filter((x) => x.tick !== s.tick))
      list.append(
        el(
          'li',
          `${a.status} assertion ${a.index} @${a.tick}: ${a.path} ${a.op} ${show(a.value)}`,
          a.status === 'failed' ? 'fail' : a.status === 'passed' ? 'pass' : 'muted',
        ),
      );
  }
}

function renderHashes(s: Source): void {
  const list = $('hashes');
  list.replaceChildren();
  const rows = s.hashRows();
  if (rows.length === 0) list.append(el('li', 'No stored hashes for this run.', 'muted'));
  for (const r of rows) {
    const state = r.matches === null ? 'not reached' : r.matches ? 'matches' : `page ${r.actual ?? ''}`;
    const li = el(
      'li',
      `t${r.tick} ${r.hash} (${r.source}) ${state}`,
      r.matches === null ? 'muted' : r.matches ? 'pass' : 'fail',
    );
    if (r.tick === s.tick) li.classList.add('changed');
    list.append(li);
  }
}

/** The state tree: objects and arrays as `<details>`, filled when opened; changed paths marked. */
const openPaths = new Set<string>(['']);

function renderTree(s: Source): void {
  const tree = $('tree');
  const diffList = $('diff');
  const diff = s.diff();
  const changed = new Set<string>();
  for (const d of diff) {
    const parts = d.path.split('.');
    for (let i = 1; i <= parts.length; i++) changed.add(parts.slice(0, i).join('.'));
  }
  diffList.replaceChildren();
  if (diff.length === 0)
    diffList.append(
      el('li', s.tick === 0 || s.readOnly ? 'Nothing to compare with.' : 'Nothing changed.', 'muted'),
    );
  for (const d of diff)
    diffList.append(
      el(
        'li',
        d.op === 'change'
          ? `${d.path}: ${show(d.before!)} -> ${show(d.after!)}`
          : `${d.op} ${d.path}: ${show((d.op === 'add' ? d.after : d.before)!)}`,
      ),
    );

  const query = $<HTMLInputElement>('search').value;
  tree.replaceChildren();
  if (query.trim() !== '') {
    const ul = el('ul', undefined, 'list');
    const matches = searchState(s.state(), query);
    if (matches.length === 0) ul.append(el('li', 'No match.', 'muted'));
    for (const m of matches) {
      const text =
        m.value !== null && typeof m.value === 'object'
          ? Array.isArray(m.value)
            ? `[${m.value.length}]`
            : '{…}'
          : show(m.value);
      ul.append(el('li', `${m.path} = ${text}`, changed.has(m.path) ? 'changed' : undefined));
    }
    tree.append(ul);
    return;
  }
  tree.append(node('', 'state', s.state(), changed));
}

function node(path: string, key: string, value: JsonValue, changed: Set<string>): HTMLElement {
  const mark = changed.has(path) ? 'changed' : undefined;
  if (value === null || typeof value !== 'object')
    return el('div', `${key}: ${show(value)}`, `leaf ${mark ?? ''}`.trim());
  const details = el('details');
  const entries: [string, JsonValue][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.keys(value)
        .sort()
        .map((k) => [k, value[k]!]);
  const summary = el(
    'summary',
    `${key} ${Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}`,
    mark,
  );
  details.append(summary);
  const fill = () => {
    if (details.childElementCount > 1) return;
    for (const [k, v] of entries) details.append(node(path === '' ? k : `${path}.${k}`, k, v, changed));
  };
  if (openPaths.has(path)) {
    details.open = true;
    fill();
  }
  details.addEventListener('toggle', () => {
    if (details.open) {
      openPaths.add(path);
      fill();
    } else openPaths.delete(path);
  });
  return details;
}

function eventFilter(): EventFilter {
  const num = (id: string): number | undefined => {
    const v = $<HTMLInputElement>(id).value.trim();
    return v === '' ? undefined : Number(v);
  };
  const text = (id: string): string | undefined => {
    const v = $<HTMLInputElement>(id).value.trim();
    return v === '' ? undefined : v;
  };
  const entity = num('ev-entity');
  const cause = text('ev-cause');
  const component = text('ev-component');
  return {
    ...(entity === undefined ? {} : { entity }),
    ...(cause === undefined ? {} : { cause }),
    ...(component === undefined ? {} : { component }),
  };
}

function renderEvents(s: Source): void {
  const list = $('events');
  const head = $('events-head');
  list.replaceChildren();
  const filter = eventFilter();
  const range = $<HTMLSelectElement>('range').value;
  let changes: Change[] | null;
  if (range === 'step') {
    const step = s.stepEvents();
    changes = step === null ? null : filterChanges(step, filter);
  } else {
    const from = range === 'span' ? Number($<HTMLInputElement>('ev-from').value || 0) : undefined;
    const to =
      range === 'span' && $<HTMLInputElement>('ev-to').value !== ''
        ? Number($<HTMLInputElement>('ev-to').value)
        : undefined;
    changes = s.events({
      ...filter,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
  }
  if (changes === null) {
    head.textContent = 'This game has no world, so no event log.';
    return;
  }
  head.textContent = `${changes.length} change(s) shown of ${s.eventCount() ?? 0} kept`;
  for (const c of changes.slice(-500)) {
    const li = el('li', changeLine(c));
    li.title = JSON.stringify(c);
    list.append(li);
  }
}

// --- Controls and the test hook -----------------------------------------------------------------

function move(to: (s: DebugSession<ViewGame>) => number): number {
  if (session === null || source?.readOnly)
    throw new Error('a dump file is read-only: playFromHere() steps its run');
  const tick = to(session);
  renderAll();
  return tick;
}

const nOf = (id: string, fallback: number): number => {
  const v = Number($<HTMLInputElement>(id).value);
  return Number.isInteger(v) && v >= 0 ? v : fallback;
};

function wire(): void {
  $('first').onclick = () => move((s) => s.goto(0));
  $('back10').onclick = () => move((s) => s.goto(s.tick - 10));
  $('back1').onclick = () => move((s) => s.goto(s.tick - 1));
  $('fwd1').onclick = () => move((s) => s.step(1));
  $('fwd10').onclick = () => move((s) => s.step(10));
  $('fwdN').onclick = () => move((s) => s.step(nOf('n', 1)));
  $('goto').onclick = () => move((s) => s.goto(nOf('to', s.tick)));
  $('last').onclick = () => move((s) => s.goto(s.ticks));
  $('play').onclick = () => void api.playFromHere();
  for (const id of ['search', 'ev-from', 'ev-to', 'ev-entity', 'ev-cause', 'ev-component'])
    $(id).addEventListener('input', () => source && renderAll());
  $('range').addEventListener('change', () => source && renderAll());
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || source?.readOnly !== false) return;
    if (e.key === 'ArrowRight') move((s) => s.step(e.shiftKey ? 10 : 1));
    if (e.key === 'ArrowLeft') move((s) => s.goto(s.tick - (e.shiftKey ? 10 : 1)));
  });
}

const need = (): Source => {
  if (source === null) throw new Error(error ?? 'the debugger has not loaded yet');
  return source;
};

const api: DebuggerApi = {
  get ready() {
    return ready;
  },
  get error() {
    return error;
  },
  get kind() {
    return need().kind;
  },
  get tick() {
    return need().tick;
  },
  get ticks() {
    return need().ticks;
  },
  hash: () => need().hash(),
  state: () => need().state(),
  events: (filter) => need().events(filter),
  stepEvents: () => need().stepEvents(),
  eventCount: () => need().eventCount(),
  step: (n = 1) => move((s) => s.step(n)),
  goto: (tick) => move((s) => s.goto(tick)),
  checks: () => need().checks(),
  diff: () => need().diff(),
  mismatch: () => need().mismatch(),
  async playFromHere() {
    if (dumpJob === null || dumpJob.run === null)
      throw new Error('only a dump of a game run can be played from');
    const job = dumpJob.run;
    dumpJob = null;
    await startRun(job, job.openTick);
    renderAll();
  },
};

window.__wwDebugger = api;

async function boot(): Promise<void> {
  wire();
  try {
    const res = await fetch(DEBUG_JOB_PATH);
    if (!res.ok)
      fail(`no job at ${DEBUG_JOB_PATH} (${res.status}): open this page with pnpm cli debug <file>`);
    const job = (await res.json()) as DebugJob;
    const asked = new URLSearchParams(location.search).get('tick');
    if (job.kind === 'dump') startDump(job);
    else await startRun(job, asked === null ? job.openTick : Number(asked));
    renderAll();
    ready = true;
  } catch (e) {
    error ??= e instanceof Error ? e.message : String(e);
    $('summary').textContent = `Cannot open the file: ${error}`;
  }
}

void boot();
