/**
 * The top-down kit: rooms from text on a grid (room.ts), a world with tile collision, doors,
 * room slides and conditions (world.ts), a sword hero with an item slot (hero.ts), enemies and objects
 * (enemies.ts, entity.ts), items such as the boomerang and bombs (items.ts), drawing (render.ts, hud.ts) and sheet helpers (view.ts, frames.ts).
 * Nothing here knows about a particular game; a mini game supplies the rooms, any extra spawn
 * kinds (a boss) and its own scene.
 */
export * from './geometry';
export * from './room';
export * from './entity';
export * from './enemies';
export * from './items';
export * from './hero';
export * from './world';
export * from './view';
export * from './render';
export * from './hud';
export * from './frames';
export * from './walker';
export * from './person';
