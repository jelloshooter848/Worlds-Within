/** The browser shell games share (Engine 0.7): backend choice, the host scene, displays, the boot and its step hook. */
export {
  backendFromQuery,
  otherBackendLink,
  THREE_QUERY,
  type BackendLink,
  type PageBackend,
} from './backend-choice';
export type { BrowserDisplay, DisplayResult } from './display';
export {
  HostScene,
  type HostDrawer,
  type HostSceneAccessorOptions,
  type HostSceneGameOptions,
  type HostSceneOptions,
} from './host-scene';
export {
  AUDIO_UNLOCK_EVENTS,
  bootBrowserGame,
  DEBUG_STEP_QUERY,
  manualFromQuery,
  RECORD_QUERY,
  recordFromQuery,
  showBackendToggle,
  showDisplayMessage,
  tapsOf,
  type BootAudio,
  type BootedGame,
  type BootPage,
  type BrowserBootOptions,
  type DebugWindow,
  type DisplayFactory,
  type DisplayShell,
} from './boot';
export {
  mountVolumeControl,
  VOLUME_CONTROL_ID,
  type VolumeControl,
  type VolumeControlOptions,
  type VolumeTarget,
} from './volume-control';
export { PageDebugHook, type PageDebug, type PageDebugTarget, type ReplayRefusal } from './debug';
export type { RoundRecording } from '../headless';
export {
  CampaignSession,
  type CampaignEntryEnd,
  type CampaignResume,
  type CampaignResumeRefusalCode,
} from './campaign-session';
export {
  MissionLaunch,
  type EntrySummary,
  type LaunchButton,
  type LaunchCampaign,
  type LaunchCampaignSession,
  type LaunchEntryResult,
  type LaunchGame,
  type MissionLaunchOptions,
} from './mission-launch';
export { MISSION_BAR_HEIGHT, mountMissionBar, type MissionBar, type MissionBarOptions } from './mission-bar';
export { ShellTransitions, type ShellTransitionOptions, type TransitionRequest } from './transitions';
export { UiScene, type UiSceneOptions } from './ui-scene';
