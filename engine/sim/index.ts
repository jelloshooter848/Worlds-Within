/** engine/sim: the headless, deterministic world simulation. See CLAUDE.md in this folder. */
export { defineComponent } from './component';
export type { ComponentDef } from './component';
export { createWorld } from './world';
export type { AnyComponent, Entity, System, World, WorldOptions, WorldSnapshot } from './world';
