import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { validate } from '../content/validate';
import { labelBar } from './scene3d';
import { projectileFlight, projectilePlace, projectileSchema } from './projectile';
import { skinSchema, type SkinFile } from './skin';

// Engine 0.16 E6: the tower defense's looks in a skin. Projectiles on events, a ring from a
// `range:` tag, a bar's `max` from a tag and the HUD's wave preview; the drawing is tested in
// engine/core/draw/draw.test.ts.

const errorsOf = (data: unknown) =>
  validate('skin.json', data, skinSchema).errors.map((e) => [e.path, e.code]);

function td(): SkinFile {
  return {
    backend: 'canvas2d',
    sheets: { sheet: 'td', fallbackColor: '#00a800' },
    kinds: {
      'tower:arrow': { frames: { idle: 'tower' }, ring: { tag: 'range:', color: '#fcfcfc', alpha: 0.2 } },
      'ghost:arrow': {
        frames: { idle: 'tower' },
        ring: { radius: 24, tag: 'range:', per: 8, color: '#fff' },
      },
      'enemy:runner': { frames: { walk: 'runner' } },
    },
    emitters: { dust: { burst: 4, life: 6 } },
    events: {
      'td-shot': {
        projectile: {
          frame: 'arrow',
          ticks: 6,
          arc: 8,
          ease: 'quadOut',
          turn: true,
          impact: { emit: 'dust', sound: 'thud', shake: { amount: 1, ticks: 4 } },
        },
      },
      'td-splash': { projectile: { ticks: 3, color: '#f8b800', size: 3 } },
    },
    labels: { 'enemy:runner': { from: { tag: 'hp:' }, as: 'bar', max: { tag: 'maxhp:' } } },
    hud: [
      {
        status: 'nextWaveGroups',
        as: 'preview',
        x: 4,
        y: 4,
        frames: { runner: 'runner', brute: 'brute' },
        frame: 'tower',
        spacing: 6,
      },
    ],
  };
}

describe('projectiles in skins (Engine 0.16 E6)', () => {
  it('takes a projectile on an event, a ring from a tag, a bar max from a tag and a preview', () => {
    expect(errorsOf(td())).toEqual([]);
  });

  it('names a bad projectile field, an unknown ease and an impact emitter the skin lacks', () => {
    const s = td() as unknown as { events: Record<string, { projectile: Record<string, unknown> }> };
    s.events['td-shot']!.projectile['ticks'] = 0;
    s.events['td-shot']!.projectile['impact'] = { emit: ['dust', 'smoke'] };
    s.events['td-splash']!.projectile['ease'] = 'wobble';
    s.events['td-splash']!.projectile['speed'] = 2;
    expect(errorsOf(s)).toEqual([
      ['events["td-shot"].projectile.ticks', 'too_small'],
      ['events["td-splash"].projectile.speed', 'unrecognized_keys'],
      ['events["td-splash"].projectile.ease', 'bad_ease'],
      ['events["td-shot"].projectile.impact.emit.1', 'missing_ref'],
    ]);
    expect(
      validate('p.json', { ticks: 2, ease: 'wobble' }, projectileSchema).errors.map((e) => [e.path, e.code]),
    ).toEqual([['ease', 'bad_ease']]);
  });

  it('keeps projectiles to 2D skins', () => {
    const three = {
      backend: 'three',
      kinds: { tower: { mesh: 'box', color: '#fff' } },
      events: { 'td-shot': { projectile: { ticks: 4 } } },
    };
    expect(errorsOf(three)).toEqual([['events["td-shot"].projectile', 'wrong_backend_field']]);
  });

  it('needs a radius or a tag on a ring; spacing and frames fit a preview only', () => {
    const s = td() as unknown as {
      kinds: Record<string, { ring: Record<string, unknown> }>;
      hud: Record<string, unknown>[];
    };
    delete s.kinds['tower:arrow']!.ring['tag'];
    s.hud.push({ status: 'gold', as: 'number', x: 0, y: 0, spacing: 2, frames: { a: 'b' } });
    s.hud.push({ as: 'preview', x: 0, y: 0 });
    expect(errorsOf(s)).toEqual([
      ['kinds["tower:arrow"].ring', 'missing_field'],
      ['hud.1.frames', 'custom'],
      ['hud.1.spacing', 'bad_field'],
      ['hud.2.status', 'missing_field'],
    ]);
  });

  it('checks projectile frames and sounds and preview frames across files', () => {
    const manifest = {
      id: 'g',
      kit: 'towerdefense',
      content: { skin: ['skins/*.json'], sprite: ['sprites/*.json'], sfx: ['sfx/*.json'] },
      start: { seed: 1 },
      headless: 'headless.ts',
    };
    const sprite = (frames: string[]) =>
      JSON.stringify({ palette: 'p', frames: Object.fromEntries(frames.map((f) => [f, ['0']])) });
    const files = (skin: SkinFile) => ({
      'game.json': JSON.stringify(manifest),
      'skins/canvas2d.json': JSON.stringify(skin),
      'sprites/td.json': sprite(['tower', 'arrow', 'runner', 'brute']),
      'sfx/thud.json': JSON.stringify({ id: 'thud', pulse: 'c' }),
    });
    const good = loadContent(files(td()), engineContentKinds());
    expect(good.errors).toEqual([]);

    const s = td();
    s.events!['td-shot']!.projectile = { frame: 'bolt', ticks: 4, impact: { sound: 'boom' } };
    s.events!['td-splash']!.projectile = { frame: 'arrow', sheet: 'nope', ticks: 2 };
    s.hud![0]!.frames = { runner: 'runner', brute: 'ogre' };
    const bad = loadContent(files(s), engineContentKinds(), { root: 'games/g/' });
    expect(bad.errors.filter((e) => e.file.includes('skins')).map((e) => [e.path, e.code])).toEqual([
      ['events["td-shot"].projectile.impact.sound', 'missing_ref'],
      ['events["td-shot"].projectile.frame', 'missing_frame'],
      ['events["td-splash"].projectile.sheet', 'missing_ref'],
      ['hud.0.frames.brute', 'missing_frame'],
    ]);
  });
});

describe('projectile flight (Engine 0.16 E6)', () => {
  const from = { x: 0, y: 40 };
  const to = { x: 40, y: 40 };

  it('reads the flight from the event, or none without both points', () => {
    expect(projectileFlight({ type: 'td-shot', x: 40, y: 40, fromX: 0, fromY: 40 })).toEqual({ from, to });
    expect(projectileFlight({ type: 'td-shot', x: 40, y: 40 })).toBeNull();
    expect(projectileFlight({ type: 'td-shot', fromX: 0, fromY: 40 })).toBeNull();
    expect(projectileFlight({ type: 'td-shot', x: 40, y: 40, fromX: '0', fromY: 40 })).toBeNull();
  });

  it('flies straight in `ticks` frames and has landed from then on', () => {
    const look = { ticks: 4 };
    expect(projectilePlace(look, from, to, 0)).toEqual({ x: 0, y: 40, angle: 0 });
    expect(projectilePlace(look, from, to, 1)).toEqual({ x: 10, y: 40, angle: 0 });
    expect(projectilePlace(look, from, to, 3)).toEqual({ x: 30, y: 40, angle: 0 });
    expect(projectilePlace(look, from, to, 4)).toBeNull();
    expect(projectilePlace(look, from, to, 9)).toBeNull();
    expect(projectilePlace(look, from, to, -1)).toBeNull();
  });

  it('rises on its arc to mid-way and points along the path', () => {
    const look = { ticks: 4, arc: 8 };
    const up = projectilePlace(look, from, to, 1)!;
    const top = projectilePlace(look, from, to, 2)!;
    const down = projectilePlace(look, from, to, 3)!;
    expect(top).toEqual({ x: 20, y: 32, angle: 0 });
    expect(up.y).toBeCloseTo(34);
    expect(up.angle).toBeLessThan(0);
    expect(down.angle).toBeGreaterThan(0);
    expect(down.angle).toBeCloseTo(-up.angle);
    // Straight down the screen.
    expect(projectilePlace({ ticks: 2 }, { x: 0, y: 0 }, { x: 0, y: 10 }, 1)!.angle).toBe(90);
  });

  it('eases along the way', () => {
    const eased = projectilePlace({ ticks: 4, ease: 'quadOut' }, from, to, 2)!;
    expect(eased.x).toBe(30);
  });
});

describe('a bar label with a max from a tag (Engine 0.16 E6)', () => {
  it("reads each entity's own max, and falls back without the tag", () => {
    const label = { as: 'bar', from: { tag: 'hp:' }, max: { tag: 'maxhp:' } } as const;
    expect(labelBar(label, '3', {}, { tags: ['hp:3', 'maxhp:12'] })).toEqual({ value: 3, max: 12 });
    expect(labelBar(label, '3', {}, { tags: ['hp:3', 'maxhp:4'] })).toEqual({ value: 3, max: 4 });
    expect(labelBar(label, '3', {}, { tags: ['hp:3'] })).toEqual({ value: 3, max: 100 });
    expect(labelBar(label, '3/5', {}, { tags: ['maxhp:x'] })).toEqual({ value: 3, max: 5 });
    expect(labelBar(label, '3', {})).toEqual({ value: 3, max: 100 });
  });
});
