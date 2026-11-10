import {
  FEATURE_NAMES,
  type FeatureBackend,
  type FeatureCase,
  type FeatureMap,
  type FeatureName,
} from './scene';

// Which cases `pnpm bench:features` measures (Engine 0.16 T13, PixiJS column T13b-6), kept apart
// from `run.ts` so `scene.test.ts` checks the plan in Node without a browser.

/** The 2D backends the benchmark measures, in order (`--backends`, default both). */
export const FEATURE_BACKENDS: readonly FeatureBackend[] = ['canvas2d', 'pixi'];

/** `--ablate`: each feature off alone, glow and additive blending off together, and all of them. */
export const ABLATIONS: readonly FeatureName[][] = [
  ...FEATURE_NAMES.map((name) => [name]),
  ['glow', 'add'],
  [...FEATURE_NAMES],
];

export interface PlanOptions {
  backends: readonly FeatureBackend[];
  maps: readonly FeatureMap[];
  zooms: readonly number[];
  units: Readonly<Record<FeatureMap, number>>;
  /** Also the game's own skin with the same units (`--no-plain` turns it off). */
  plain: boolean;
  /** Also the zoom-1 ablations (`ABLATIONS`). */
  ablate: boolean;
}

/** A planned case: every field of `FeatureCase` set. */
export type PlannedCase = Required<Pick<FeatureCase, 'backend' | 'features' | 'without'>> & FeatureCase;

/**
 * The cases, per map then backend: features on and plain at every zoom, then with `ablate` the
 * ablations at zoom 1 (per backend, so each backend's feature costs are measured the same way).
 */
export function planCases(opts: PlanOptions): PlannedCase[] {
  const variants: { features: boolean; without: FeatureName[]; zooms: readonly number[] }[] = [
    { features: true, without: [], zooms: opts.zooms },
    ...(opts.plain ? [{ features: false, without: [], zooms: opts.zooms }] : []),
    ...(opts.ablate ? ABLATIONS.map((without) => ({ features: true, without, zooms: [1] })) : []),
  ];
  const cases: PlannedCase[] = [];
  for (const map of opts.maps)
    for (const backend of opts.backends)
      for (const { features, without, zooms } of variants)
        for (const zoom of zooms)
          cases.push({ map, backend, zoom, units: opts.units[map], features, without });
  return cases;
}

/** `--backends canvas2d,pixi`: the names, checked. */
export function parseBackends(v: string): FeatureBackend[] {
  const out = v.split(',').filter((b) => b !== '');
  for (const b of out)
    if (!FEATURE_BACKENDS.includes(b as FeatureBackend))
      throw new Error(`unknown backend "${b}" (${FEATURE_BACKENDS.join(' or ')})`);
  if (out.length === 0) throw new Error('--backends needs at least one backend');
  return out as FeatureBackend[];
}
