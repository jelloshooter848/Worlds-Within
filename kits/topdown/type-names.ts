import { BeamBurst, SwordBeam } from './beam';
import { Bat, Knight, Projectile, Rock, Spitter } from './enemies';
import { Chest, FloorSwitch, Pickup, Poof, PushBlock, Torch, type TdEntity } from './entity';
import { Bomb, Boomerang, Explosion } from './items';
import { TdPerson } from './person';

/**
 * The kit's entity classes by their names, written out: a minified build (a game page's Vite
 * build) may rename classes, so `constructor.name` there is not the name a headless run reads, and
 * a snapshot that named a thing by it would hash differently in the page (Engine 0.15 T12, found
 * replaying the dungeon sample's run files through its built page). Each name is the class's own,
 * so no snapshot or hash changes.
 */
const KIT_TYPE_NAMES: ReadonlyMap<unknown, string> = new Map<unknown, string>([
  [SwordBeam, 'SwordBeam'],
  [BeamBurst, 'BeamBurst'],
  [Projectile, 'Projectile'],
  [Rock, 'Rock'],
  [Bat, 'Bat'],
  [Knight, 'Knight'],
  [Spitter, 'Spitter'],
  [Poof, 'Poof'],
  [Pickup, 'Pickup'],
  [Chest, 'Chest'],
  [PushBlock, 'PushBlock'],
  [FloorSwitch, 'FloorSwitch'],
  [Torch, 'Torch'],
  [Boomerang, 'Boomerang'],
  [Explosion, 'Explosion'],
  [Bomb, 'Bomb'],
  [TdPerson, 'TdPerson'],
]);

/**
 * An entity's class name, the same in Node and in a minified build: the written-out name for a
 * kit class, else `constructor.name` (a game's own class, such as a boss; a game whose page
 * hashes such a thing keeps class names in its build or gives it a `kind`).
 */
export function typeNameOf(e: TdEntity): string {
  return KIT_TYPE_NAMES.get(e.constructor) ?? e.constructor.name;
}
