/** engine/sim: the headless, deterministic world simulation. See CLAUDE.md in this folder. */
export { defineComponent } from './component';
export type { ComponentDef, ComponentOptions } from './component';
export { createWorld } from './world';
export type { AnyComponent, Entity, System, World, WorldOptions, WorldSnapshot } from './world';
export { EXTERNAL_CAUSE } from './events';
export {
  SAVE_FORMAT,
  SAVE_VERSION,
  SaveError,
  changeSchema,
  loadWorld,
  saveWorld,
  worldSaveSchema,
} from './save';
export type { LoadOptions, SaveIssue, WorldSave } from './save';
export type { Cause, Change, ChangeOp, LogOptions } from './events';
export {
  SCENARIO_FORMAT,
  SCENARIO_VERSION,
  ScenarioError,
  scenarioKeys,
  scenarioSchema,
  worldFromScenario,
} from './scenario';
export type { Scenario, ScenarioIssue, ScenarioOptions } from './scenario';
export {
  CARRIED_FORMAT,
  CARRIED_VERSION,
  CARRY_CAUSE,
  carriedRecord,
  carriedRecordSchema,
  carryFromSchema,
  carrySpecSchema,
} from './carry';
export type { CarriedPerson, CarriedRecord, CarryFrom } from './carry';
export { DEFAULT_SYSTEM_SET, SYSTEM_SETS, SYSTEM_SET_NAMES } from './system-sets';
export type { SystemSet, SystemSetName } from './system-sets';
export {
  Hauler,
  SYSTEM_COMPONENTS,
  Walk,
  addWork,
  buildSystem,
  haulSystem,
  patrolSystem,
  walkToward,
} from './systems';
export type { HaulerData, WalkData } from './systems';
export {
  Cooldown,
  Facing8,
  Target,
  Task,
  UNIT_COMPONENTS,
  Unit,
  attackSystem,
  facingOf,
  inRange,
  moveSystem,
} from './rts';
export type { CooldownData, Facing8Data, TargetData, TaskData, UnitData } from './rts';
export { RTS_COMPONENTS, RTS_SYSTEMS, applyOrder } from './rts-orders';
export {
  FATE_COMPONENTS,
  FATE_STATES,
  Fate,
  MAP_COMPONENTS,
  capturePerson,
  deathSystem,
  fateOf,
  fateStepSchema,
  freePerson,
  injurePerson,
  killPerson,
  namedPeople,
  setFate,
  startFate,
} from './fate';
export type {
  FateData,
  FateOptions,
  FateReading,
  FateRefusal,
  FateResult,
  FateState,
  FateStep,
  FateView,
  FateWriteOptions,
  NamedPerson,
  StartFateOptions,
} from './fate';
export type { OrderResult } from './rts-orders';
export {
  ECONOMY_COMPONENTS,
  Gatherer,
  Producer,
  Resource,
  RtsTypes,
  Stockpile,
  constructSystem,
  economyOrderRefusal,
  finished,
  gatherSystem,
  placeBuilding,
  placementRefusal,
  rtsTypesOf,
  spawnUnit,
  stockpileOf,
  trainSystem,
} from './economy';
export type { EconomyOrder, GathererData, ProducerData, ResourceData, StockpileData } from './economy';
export { Building, footprintOf, inReach, inRect, rectsOverlap, ringAround } from './footprint';
export type { BuildingData, Rect } from './footprint';
export { rtsBuildingTypeSchema, rtsCostSchema, rtsTypesSchema, rtsUnitTypeSchema } from '../core/rts-types';
export type { RtsBuildingType, RtsTypes as RtsTypesData, RtsUnitType } from '../core/rts-types';
export {
  ORDER_TYPES,
  buildOrderSchema,
  gatherOrderSchema,
  orderSchema,
  parseOrder,
  trainOrderSchema,
} from '../core/orders';
export type { Order, OrderCell, OrderType } from '../core/orders';
export { STEPS, UNREACHABLE, distanceField, nextStep } from './path';
export type { Cell } from './path';
export {
  ASTAR_MAX_EXPANDED,
  DIAGONAL_COST,
  FLOW_GROUP_SIZE,
  STEPS_8,
  STRAIGHT_COST,
  findPath,
  flowField,
  flowStep,
  stepCost,
  stepsOf,
} from './astar';
export type { FlowField, FlowOptions, Neighbourhood, Path, PathOptions } from './astar';
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
export {
  applyLosses,
  joinSquad,
  leaveSquad,
  lossOrder,
  pickMembers,
  squadMembers,
  squadStrength,
} from './squad';
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
export {
  EventMember,
  TIME_COMPONENTS,
  WorldTime,
  addExperience,
  commitmentSchema,
  eventMembers,
  experienceSchema,
  freezeEvent,
  frozenCheck,
  frozenSchema,
  joinEvent,
  leaveEvent,
  stampCommitment,
  startExperience,
  timeOf,
  unfreezeEvent,
  worldTimeEntity,
} from './time';
export type {
  Commitment,
  EventMemberData,
  Experience,
  Frozen,
  TimeRefusal,
  TimeResult,
  TimeService,
  WorldTimeData,
} from './time';
export {
  MISSION_COMPONENTS,
  Missions,
  commitMission,
  delegateMission,
  missionCause,
  missionRecordSchema,
  missionSnapshot,
  missionRecords,
  missionsOf,
  openMission,
  openMissionSchema,
  playMission,
  quitMission,
  settleMissions,
} from './mission';
export { missionPort, roundSeed } from './mission-port';
export { worldKeys } from './keys';
export { rtsWorldPort, type RtsPort } from './rts-port';
export type {
  CommitResult,
  MissionRefusal,
  MissionRefused,
  MissionsData,
  MissionsView,
  OpenMission,
  OpenOptions,
  OpenResult,
  ResolveResult,
} from './mission';
export {
  OPPORTUNITY_COMPONENTS,
  OPPORTUNITY_STATUSES,
  Opportunities,
  TIME_CAUSE,
  addOpportunities,
  applyOpportunityEffect,
  knowsOpportunity,
  opportunitiesOf,
  opportunityGate,
  opportunityStateSchema,
  settleOpportunities,
  takeOpportunity,
} from './opportunity';
export type {
  OpportunitiesData,
  OpportunitiesView,
  OpportunityChange,
  OpportunityRefusal,
  OpportunityRefused,
  OpportunityState,
  OpportunityStatus,
} from './opportunity';
export {
  MISSION_EFFECT_TYPES,
  opportunitySchema,
  parseOpportunity,
  missionEffectSchema,
  missionOutcomeSchema,
  missionSchema,
  parseMission,
  pickOutcome,
  totalWeight,
} from '../core/missions';
export type {
  MissionDef,
  MissionEffect,
  MissionOutcome,
  MissionRecord,
  MissionReport,
  MissionResolution,
  MissionResult,
  OpportunityDef,
} from '../core/missions';
export {
  TIMELINE_FORMAT,
  TIMELINE_VERSION,
  clockEntrySchema,
  compressClock,
  eventsSince,
  experienceEntrySchema,
  frozenSpanSchema,
  gameTickOf,
  logFrom,
  opportunityStepSchema,
  opportunityWindowSchema,
  timelineEntries,
  timelineMissionSchema,
  timelineOf,
  timelineSchema,
  worldTimeline,
} from './timeline';
export type {
  ClockEntry,
  ExperienceEntry,
  FrozenSpan,
  OpportunityStep,
  OpportunityWindow,
  Timeline,
  TimelineEntry,
  TimelineEntryKind,
  TimelineMission,
  TimelineSource,
} from './timeline';
