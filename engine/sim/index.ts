/** engine/sim: the headless, deterministic world simulation. See CLAUDE.md in this folder. */
export { defineComponent } from './component';
export type { ComponentDef } from './component';
export { createWorld } from './world';
export type { AnyComponent, Entity, System, World, WorldOptions, WorldSnapshot } from './world';
export { EXTERNAL_CAUSE } from './events';
export { SAVE_FORMAT, SAVE_VERSION, SaveError, loadWorld, saveWorld, worldSaveSchema } from './save';
export type { LoadOptions, SaveIssue, WorldSave } from './save';
export type { Cause, Change, ChangeOp, LogOptions } from './events';
export {
  SCENARIO_FORMAT,
  SCENARIO_VERSION,
  ScenarioError,
  scenarioSchema,
  worldFromScenario,
} from './scenario';
export type { Scenario, ScenarioIssue, ScenarioOptions } from './scenario';
export {
  Hauler,
  SYSTEM_COMPONENTS,
  Walk,
  buildSystem,
  haulSystem,
  patrolSystem,
  walkToward,
} from './systems';
export type { HaulerData, WalkData } from './systems';
export { STEPS, UNREACHABLE, distanceField, nextStep } from './path';
export type { Cell } from './path';
export {
  ANGLE_STEPS,
  FIXED_ONE,
  QUARTER_TURN,
  chebyshev,
  clamp,
  cosFixed,
  directionAngle,
  directionVector,
  distFloor,
  distSq,
  iatan2,
  idiv,
  imod,
  ipow,
  isqrt,
  manhattan,
  scaleFixed,
  sinFixed,
  wrapAngle,
} from './math';
export {
  Construction,
  Health,
  Inventory,
  Member,
  Owner,
  Patrol,
  Position,
  ROLES,
  STANDARD_COMPONENTS,
  Squad,
  Worker,
  inventoryAdd,
} from './components';
export type {
  ConstructionData,
  HealthData,
  InventoryData,
  MemberData,
  OwnerData,
  PatrolData,
  PositionData,
  Role,
  SquadData,
  WorkerData,
} from './components';
export { applyLosses, joinSquad, lossOrder, pickMembers, squadMembers, squadStrength } from './squad';
export type { SquadMember } from './squad';
export {
  GROUND,
  Terrain,
  cellAt,
  cellIndex,
  flatTerrain,
  heightAt,
  inBounds,
  moveCost,
  passable,
  terrainEntity,
  terrainOf,
  typeAt,
} from './terrain';
export type { TerrainData, TerrainType } from './terrain';
