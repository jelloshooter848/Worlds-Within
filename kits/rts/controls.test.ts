import { describe, expect, it } from 'vitest';
import { battleSnapshot, siegeSnapshot } from './__fixtures__/world';
import { validate } from '@engine/core/content/validate';
import { presentFrameSchema, RtsCamera } from '@engine/core/present';
import { RtsControls } from './controls';
import { presentWorld, RtsPresentState } from './present';
import { readWorld } from './snapshot';

const TS = 16;

/** Controls over the fixture map at zoom 2, the camera at the map's top-left. */
function setup() {
  const camera = new RtsCamera({
    view: { width: 128, height: 96 },
    area: { x: 0, y: 0, w: 128, h: 96 },
    zoom: 2,
    centre: { x: 0, y: 0 },
  });
  return { controls: new RtsControls('red', camera, TS), view: readWorld(battleSnapshot()) };
}
/** The picture point over cell (x, y) at zoom 2 from the top-left. */
const px = (x: number, y: number) => ({ x: x * TS * 2 + 4, y: y * TS * 2 + 4 });

describe('RtsControls', () => {
  it('a tap selects through the camera, a right tap commands, a box selects', () => {
    const { controls, view } = setup();
    expect(controls.gesture({ type: 'tap', button: 'primary', ...px(1, 1), kind: 'mouse' }, view)).toBeNull();
    expect(controls.selection.ids()).toEqual([3]);
    const p0 = px(0, 0);
    expect(
      controls.gesture(
        { type: 'box', phase: 'move', x0: p0.x, y0: p0.y, x1: 100, y1: 60, kind: 'mouse' },
        view,
      ),
    ).toBeNull();
    expect(controls.presentOptions(view).box).toEqual({ x: 2, y: 2, w: 48, h: 28 });
    controls.gesture({ type: 'box', phase: 'end', x0: p0.x, y0: p0.y, x1: 100, y1: 60, kind: 'mouse' }, view);
    expect(controls.selection.ids()).toEqual([5]);
    expect(controls.presentOptions(view).box).toBeNull();
    expect(controls.gesture({ type: 'tap', button: 'secondary', ...px(1, 0), kind: 'touch' }, view)).toEqual({
      faction: 'red',
      type: 'move',
      units: [5],
      target: { x: 1, y: 0 },
    });
  });

  it('places a building with the next tap, shows the ghost, and a right tap cancels', () => {
    const { controls, view } = setup();
    controls.selection.set([5]);
    controls.startPlacing('barracks');
    controls.hover(px(1, 0));
    expect(controls.placing(view)).toEqual({ building: 'barracks', cell: { x: 1, y: 0 }, w: 2, h: 2 });
    expect(
      controls.gesture({ type: 'tap', button: 'primary', ...px(1, 0), kind: 'mouse' }, view),
    ).toMatchObject({
      type: 'build',
      units: [5],
      target: { x: 1, y: 0 },
      building: 'barracks',
    });
    expect(controls.placing(view)).toBeNull();
    controls.startPlacing('barracks');
    expect(
      controls.gesture({ type: 'tap', button: 'secondary', ...px(1, 0), kind: 'mouse' }, view),
    ).toBeNull();
    expect(controls.placing(view)).toBeNull();
  });

  it('pans and zooms the camera, and the buttons make orders', () => {
    const { controls, view } = setup();
    expect(controls.gesture({ type: 'pan', dx: -32, dy: 0, source: 'drag' }, view)).toBeNull();
    expect(controls.camera.topLeft()).toEqual({ x: 16, y: 0 });
    controls.gesture({ type: 'zoom', factor: 0.5, x: 0, y: 0, source: 'wheel' }, view);
    expect(controls.camera.zoom).toBe(1);
    controls.selection.set([3]);
    expect(controls.train(view, 'worker')).toMatchObject({ type: 'train', units: [3] });
    expect(controls.selectHeroes(view)).toEqual([7]);
    expect(controls.stop(view)).toEqual({ faction: 'red', type: 'stop', units: [7] });
    expect(controls.presentOptions(view).camera).toEqual(controls.camera.hint());
  });
});

describe('RtsControls: the mission button (Engine 0.11)', () => {
  it('launches an offered mission through the launcher and reports a refusal', () => {
    const { controls } = setup();
    const view = readWorld(siegeSnapshot());
    const opened: string[] = [];
    expect(controls.launchMission(view, 'raid', { launch: (id) => (opened.push(id), null) }).ok).toBe(true);
    expect(opened).toEqual(['raid']);
    const refused = controls.launchMission(view, 'raid', {
      launch: () => ({ code: 'round_hosted', error: 'a mission round is being played' }),
    });
    expect(refused).toMatchObject({ ok: false, code: 'round_hosted' });
    expect(
      controls.launchMission(readWorld(siegeSnapshot({ offer: 'closed' })), 'raid', { launch: () => null }),
    ).toMatchObject({ ok: false, code: 'not_offered' });
  });
});

describe('RtsControls through a ground view (Engine 0.16 F2)', () => {
  /** Controls with a pitched, turned 3D camera over the fixture map (8 x 6 cells of 16 px). */
  function ground() {
    const camera = new RtsCamera({
      view: { width: 160, height: 120 },
      area: { x: 0, y: 0, w: 128, h: 96 },
      zoom: 1.5,
      centre: { x: 64, y: 48 },
      ground: { pitch: 50, yaw: 30, fov: 45 },
    });
    return { camera, controls: new RtsControls('red', camera, TS), view: readWorld(battleSnapshot()) };
  }
  /** The picture point over the centre of cell (x, y) on the ground. */
  const over = (camera: RtsCamera, x: number, y: number) =>
    camera.worldToScreen((x + 0.5) * TS, (y + 0.5) * TS);

  it('a tap selects the thing on the cell under it, and a right tap orders to that cell', () => {
    const { camera, controls, view } = ground();
    controls.gesture({ type: 'tap', button: 'primary', ...over(camera, 1, 1), kind: 'mouse' }, view);
    expect(controls.selection.ids()).toEqual([3]);
    controls.gesture({ type: 'tap', button: 'primary', ...over(camera, 2, 1), kind: 'mouse' }, view);
    expect(controls.selection.ids()).toEqual([5]);
    expect(
      controls.gesture({ type: 'tap', button: 'secondary', ...over(camera, 3, 2), kind: 'mouse' }, view),
    ).toEqual({ faction: 'red', type: 'move', units: [5], target: { x: 3, y: 2 } });
    controls.startPlacing('barracks');
    controls.hover(over(camera, 4, 3));
    expect(controls.placing(view)).toMatchObject({ cell: { x: 4, y: 3 } });
  });

  it('a box selects the units drawn inside the picture rectangle', () => {
    const { camera, controls, view } = ground();
    const a = over(camera, 1, 3);
    const b = over(camera, 2, 3);
    const rect = {
      x0: Math.min(a.x, b.x) - 3,
      y0: Math.min(a.y, b.y) - 3,
      x1: Math.max(a.x, b.x) + 3,
      y1: Math.max(a.y, b.y) + 3,
    };
    controls.gesture({ type: 'box', phase: 'move', ...rect, kind: 'mouse' }, view);
    // The box shown is the ground patch under the rectangle.
    const shown = controls.presentOptions(view).box!;
    expect(shown).toEqual(
      camera.screenBoxToWorld({ x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 }),
    );
    controls.gesture({ type: 'box', phase: 'end', ...rect, kind: 'mouse' }, view);
    expect(controls.selection.ids()).toEqual([6, 7]);
    // The worker at (2, 1) is not drawn inside it.
    const worker = { x: 2.5 * TS, y: 1.5 * TS };
    expect(
      camera.inScreenBox(
        { x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 },
        worker.x,
        worker.y,
      ),
    ).toBe(false);
    controls.gesture({ type: 'box', phase: 'end', x0: 0, y0: 0, x1: 1, y1: 1, kind: 'mouse' }, view);
    expect(controls.selection.ids()).toEqual([]);
  });

  it('gives an accepted order its marker and bark, which the present state carries into frames', () => {
    const { controls, view } = setup();
    controls.selection.set([6]);
    const move = controls.gesture({ type: 'tap', button: 'secondary', ...px(3, 2), kind: 'mouse' }, view)!;
    const fb = controls.feedback(move, view);
    expect(fb.marker).toEqual({ kind: 'move', x: 3, y: 2, w: 1, h: 1, entity: null });
    expect(fb.events).toEqual([
      { type: 'bark', side: 'own', order: 'move', unitType: 'soldier', entity: 'unit-6', x: 24, y: 56 },
    ]);
    // On an enemy: an attack marker on its box, following it.
    const attack = controls.gesture({ type: 'tap', button: 'secondary', ...px(7, 4), kind: 'mouse' }, view)!;
    expect(controls.feedback(attack, view).marker).toEqual({
      kind: 'attack',
      x: 7,
      y: 4,
      w: 1,
      h: 1,
      entity: 10,
    });
    // A build marks the footprint; stop and train bark with no marker.
    controls.selection.set([5]);
    expect(controls.feedback(controls.stop(view)!, view)).toMatchObject({
      marker: null,
      events: [{ order: 'stop' }],
    });
    const build = controls.feedback(
      { faction: 'red', type: 'build', units: [5], target: { x: 4, y: 3 }, building: 'barracks' },
      view,
    );
    expect(build.marker).toEqual({ kind: 'build', x: 4, y: 3, w: 2, h: 2, entity: null });
    expect(build.events[0]).toMatchObject({ order: 'build', unitType: 'worker', kind: 'barracks' });
    controls.selection.set([3]);
    const train = controls.feedback(controls.train(view, 'worker')!, view);
    expect(train.marker).toBeNull();
    expect(train.events).toEqual([
      {
        type: 'bark',
        side: 'own',
        order: 'train',
        unitType: 'worker',
        kind: 'hall',
        entity: 'building-3',
        x: 16,
        y: 16,
      },
    ]);
    // Through the present state: the marker drawn, the bark sent once, passing the schema.
    const state = new RtsPresentState();
    state.accept(fb, view.tick);
    const frame = presentWorld(view, { faction: 'red', size: { width: 128, height: 96 }, state });
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
    expect(frame.entities.filter((e) => e.kind === 'order-marker').map((e) => e.anim.state)).toEqual([
      'move',
    ]);
    expect(frame.events.map((e) => e.type)).toEqual(['bark']);
  });
});
