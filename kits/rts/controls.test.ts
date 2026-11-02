import { describe, expect, it } from 'vitest';
import { RtsCamera } from '@engine/core/present';
import { battleSnapshot, siegeSnapshot } from './__fixtures__/world';
import { RtsControls } from './controls';
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
