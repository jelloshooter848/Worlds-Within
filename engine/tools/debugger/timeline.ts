import { gameTickOf, type ClockEntry, type Timeline } from '@engine/sim/index';

/**
 * The debugger's timeline viewer as a pure model (Engine 0.14 T11; docs/BUILD-LOG.md, Engine
 * 0.14, decisions 2 and 4): the timeline record (`worlds-within/timeline`, `engine/sim/timeline.ts`)
 * laid out as rows on one horizontal axis of **game ticks** (what the debugger steps), with each
 * world tick placed at the first game tick the world reached it at (the record's `clock`). No DOM,
 * no Node: the page draws the rows, `window.__wwDebugger.timeline()` prints them as text
 * (`timelineText`), and Node tests check both.
 *
 * Rows, top to bottom: the run (now, a replay's failing tick, the first stored-hash mismatch), the
 * clock (where the world moves and where it stands still), frozen spans, experience time per
 * mission, opportunity windows (with their status changes and causes) and missions (open to
 * commit, with the outcome). A world tick past the clock (a window that closes later, an open
 * mission's commit) is placed as if the world then moves one tick per game tick, and marked
 * `projected`. Every marker carries the game tick to jump to (`game`).
 */

export type TimelineRowKind = 'run' | 'clock' | 'frozen' | 'experience' | 'opportunity' | 'mission';

export type TimelineMarkerKind =
  'now' | 'failure' | 'before' | 'mismatch' | 'opportunity' | 'open' | 'commit' | 'freeze' | 'unfreeze';

/** A stretch of a row, in game ticks (and the world ticks it stands for, when it has them). */
export interface TimelineSpan {
  /** First and last game tick of the span. */
  from: number;
  to: number;
  worldFrom: number | null;
  worldTo: number | null;
  /**
   * `moving` / `still` (clock), `frozen`, `experience`, an opportunity's status now (`waiting`,
   * `offered`, `taken`, `closed`, `dormant`), a mission's (`open`, `committed`).
   */
  kind: string;
  label: string;
  /** Still going at the tick shown (a span still frozen, an opportunity still offered). */
  ongoing: boolean;
  /** Its end is past the clock (placed at one world tick per game tick). */
  projected: boolean;
}

/** One point on a row: what happened, at which game tick (null when it cannot be placed). */
export interface TimelineMarker {
  game: number | null;
  world: number | null;
  kind: TimelineMarkerKind;
  /** The opportunity, mission or event id ('' for the run's own markers). */
  id: string;
  label: string;
  projected: boolean;
}

export interface TimelineRow {
  kind: TimelineRowKind;
  /** Unique within the layout: `clock`, `frozen:siege`, `opportunity:sabotage-window`, ... */
  id: string;
  label: string;
  spans: TimelineSpan[];
  markers: TimelineMarker[];
}

export interface TimelineLayout {
  /** The axis: game ticks 0 to `ticks` (the run's last tick). */
  ticks: number;
  /** The game tick shown and the world tick there. */
  gameTick: number;
  worldTick: number;
  logFrom: number | null;
  rows: TimelineRow[];
}

/** The run's own marks: a replay's failing tick and the first stored-hash mismatch. */
export interface TimelineMarks {
  failure?: { tick: number; label: string } | null;
  mismatch?: { tick: number; label: string } | null;
}

/**
 * Places world tick `world` on the game-tick axis: the first game tick the clock reached it at;
 * past the clock, one world tick per game tick from its last entry (`projected`).
 */
export function placeWorldTick(
  clock: readonly ClockEntry[] | null,
  world: number,
): { game: number; projected: boolean } {
  if (clock === null || clock.length === 0) return { game: world, projected: false };
  const game = gameTickOf(clock, world);
  if (game !== null) return { game, projected: false };
  const last = clock[clock.length - 1]!;
  return { game: last.game + (world - last.world), projected: true };
}

const byWhom = (by: string): string => (by === 'time' ? 'by time' : `by ${by}`);

/** The timeline record at the tick shown, laid out as rows (see the file comment). */
export function timelineLayout(
  record: Timeline,
  at: { gameTick: number; ticks: number },
  marks: TimelineMarks = {},
): TimelineLayout {
  const clock = record.clock;
  const place = (world: number) => placeWorldTick(clock, world);
  const now = at.gameTick;
  const marker = (kind: TimelineMarkerKind, id: string, world: number, label: string): TimelineMarker => {
    const p = place(world);
    return { game: p.game, world, kind, id, label, projected: p.projected };
  };
  const span = (kind: string, label: string, worldFrom: number, worldTo: number | null): TimelineSpan => {
    const from = place(worldFrom);
    const to = worldTo === null ? { game: now, projected: false } : place(worldTo);
    return {
      from: from.game,
      to: Math.max(from.game, to.game),
      worldFrom,
      worldTo: worldTo ?? record.worldTick,
      kind,
      label,
      ongoing: worldTo === null,
      projected: from.projected || to.projected,
    };
  };

  const run: TimelineRow = {
    kind: 'run',
    id: 'run',
    label: 'run',
    spans: [],
    markers: [
      {
        game: now,
        world: record.worldTick,
        kind: 'now',
        id: '',
        label: `now: game ${now}, world ${record.worldTick}`,
        projected: false,
      },
    ],
  };
  if (marks.failure) {
    const f = marks.failure;
    run.markers.push({
      game: f.tick,
      world: null,
      kind: 'failure',
      id: '',
      label: f.label,
      projected: false,
    });
    if (f.tick > 0)
      run.markers.push({
        game: f.tick - 1,
        world: null,
        kind: 'before',
        id: '',
        label: `the tick before the failure (${f.tick - 1})`,
        projected: false,
      });
  }
  if (marks.mismatch)
    run.markers.push({
      game: marks.mismatch.tick,
      world: null,
      kind: 'mismatch',
      id: '',
      label: marks.mismatch.label,
      projected: false,
    });

  const clockRow: TimelineRow = { kind: 'clock', id: 'clock', label: 'world clock', spans: [], markers: [] };
  const entries = clock ?? [];
  for (let i = 0; i + 1 < entries.length; i++) {
    const a = entries[i]!;
    const b = entries[i + 1]!;
    const still = a.world === b.world;
    clockRow.spans.push({
      from: a.game,
      to: b.game,
      worldFrom: a.world,
      worldTo: b.world,
      kind: still ? 'still' : 'moving',
      label: still ? `world stands at ${a.world}` : `world ${a.world}-${b.world}`,
      ongoing: false,
      projected: false,
    });
  }

  const rows: TimelineRow[] = [run, clockRow];
  for (const f of record.frozen)
    rows.push({
      kind: 'frozen',
      id: `frozen:${f.event}:${f.from}`,
      label: `frozen ${f.event}`,
      spans: [span('frozen', `${f.event} frozen ${byWhom(f.by)}`, f.from, f.to)],
      markers: [
        marker('freeze', f.event, f.from, `freeze ${f.event} ${byWhom(f.by)}`),
        ...(f.to === null ? [] : [marker('unfreeze', f.event, f.to, `unfreeze ${f.event} ${byWhom(f.by)}`)]),
      ],
    });
  for (const e of record.experience) {
    const row: TimelineRow = {
      kind: 'experience',
      id: `experience:${e.mission}`,
      label: `inside ${e.mission}`,
      spans: [],
      markers: [],
    };
    if (e.from !== null) {
      const start = place(e.from);
      row.spans.push({
        from: start.game,
        to: start.game + e.ticks,
        worldFrom: e.from,
        worldTo: e.from,
        kind: 'experience',
        label: `${e.ticks} experience tick(s) inside ${e.mission}`,
        ongoing: false,
        projected: start.projected,
      });
    }
    rows.push(row);
  }
  for (const o of record.opportunities) {
    const row: TimelineRow = {
      kind: 'opportunity',
      id: `opportunity:${o.id}`,
      label: `${o.id} (${o.mission})`,
      spans: [],
      markers: o.history.map((h) => marker('opportunity', o.id, h.at, `${o.id} ${h.status} ${byWhom(h.by)}`)),
    };
    if (o.opens !== null && o.closes !== null)
      row.spans.push({
        ...span(o.status, `${o.id} window ${o.opens}-${o.closes}, ${o.status}`, o.opens, o.closes),
        ongoing: o.status === 'offered' || o.status === 'waiting',
      });
    rows.push(row);
  }
  for (const m of record.missions) {
    const committed = m.status === 'committed';
    const how =
      m.outcome === null ? '' : `: ${m.outcome}${m.resolution === null ? '' : ` (${m.resolution})`}`;
    rows.push({
      kind: 'mission',
      id: `mission:${m.mission}`,
      label: `mission ${m.mission}`,
      spans: [
        {
          ...span(
            m.status,
            `${m.mission} ${committed ? 'committed' : 'open'}${how}`,
            m.openTick,
            m.commitTick,
          ),
          ongoing: !committed,
        },
      ],
      markers: [
        marker('open', m.mission, m.openTick, `open ${m.mission}`),
        ...(committed ? [marker('commit', m.mission, m.commitTick, `commit ${m.mission}${how}`)] : []),
      ],
    });
  }
  for (const row of rows) row.markers.sort((a, b) => (a.game ?? 0) - (b.game ?? 0));
  return { ticks: at.ticks, gameTick: now, worldTick: record.worldTick, logFrom: record.logFrom, rows };
}

/** Every marker of a layout in game tick order (then row order), for lists and clicks. */
export function timelineMarkers(layout: TimelineLayout): (TimelineMarker & { row: string })[] {
  const all = layout.rows.flatMap((row) => row.markers.map((m) => ({ ...m, row: row.id })));
  return all
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.game ?? 0) - (b.m.game ?? 0) || a.i - b.i)
    .map(({ m }) => m);
}

const where = (game: number | null, world: number | null, projected: boolean): string =>
  `game ${game ?? '?'}${world === null ? '' : ` (world ${world})`}${projected ? ' projected' : ''}`;

/**
 * The layout as text, one row per block: the row's spans on its first line, then one line per
 * marker (`  game 566 (world 160) commit sabotage: both-burnt (played)`).
 */
export function timelineText(layout: TimelineLayout): string {
  const lines = [
    `timeline at game tick ${layout.gameTick} of ${layout.ticks} (world tick ${layout.worldTick}${layout.logFrom === null ? ', no log' : `, log from ${layout.logFrom}`})`,
  ];
  for (const row of layout.rows) {
    const spans = row.spans.map(
      (s) => `game ${s.from}-${s.to}${s.ongoing ? '+' : ''}${s.projected ? ' projected' : ''} ${s.label}`,
    );
    lines.push(`${row.label}:${spans.length === 0 ? '' : ` ${spans.join(' | ')}`}`);
    for (const m of row.markers) lines.push(`  ${where(m.game, m.world, m.projected)} ${m.kind}: ${m.label}`);
  }
  return lines.join('\n');
}
