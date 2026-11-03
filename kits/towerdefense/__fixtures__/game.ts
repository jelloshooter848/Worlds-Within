/**
 * Test helpers over `game/` (tests only): the fixture game's files loaded as a game would load
 * them, and its one round. The tiny map (6 x 4): the path bends from the entry at the top left
 * (0, 0) east to (2, 0), south to (2, 2) and east to the exit (5, 2); build cells (1, 1), (3, 1) and
 * (2, 3).
 */
import { readFileSync } from 'node:fs';
import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import { tdRound } from '../game';
import { kit } from '../kit';
import type { TdRoundDef } from '../world';

const FILES = [
  'game.json',
  'content/maps/tiny.json',
  'content/maps/tiny.map.txt',
  'content/towers.json',
  'content/waves/tiny.json',
];

/** The fixture game's content. */
export function fixtureContent(): ContentBundle {
  const files: Record<string, string> = {};
  for (const f of FILES) files[f] = readFileSync(new URL(`game/${f}`, import.meta.url), 'utf8');
  const kinds = engineContentKinds();
  for (const k of kit.kinds()) kinds.register(k);
  const loaded = loadContent(files, kinds, { root: 'games/td/' });
  if (!loaded.ok) throw new Error(`fixture game does not load: ${loaded.errors[0]!.message}`);
  return loaded.value;
}

/** The fixture game's round (`tdRound`). */
export function fixtureRound(): TdRoundDef {
  return tdRound(fixtureContent());
}
