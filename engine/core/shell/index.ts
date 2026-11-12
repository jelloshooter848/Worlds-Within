/** The browser shell games share (Engine 0.7): backend choice, the host scene, displays, the boot and its step hook. */
export {
  backendFromQuery,
  CANVAS2D_QUERY,
  otherBackendLink,
  queryNamesThree,
  PIXI_QUERY,
  THREE_QUERY,
  type BackendLink,
  type Page2dBackend,
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
  PAUSE_BUTTON_ID,
  PAUSE_CODES,
  tapsOf,
  TITLE_QUERY,
  titleFromQuery,
  dialogsFromQuery,
  DIALOGS_QUERY,
  type BootAudio,
  type BootMenus,
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
export {
  PageDebugHook,
  type MenusView,
  type PageDebug,
  type PageDebugTarget,
  type ReplayRefusal,
} from './debug';
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
export {
  briefingScreen,
  CARD_MARGIN,
  CARD_PANEL,
  CARD_WIDTH,
  MISSION_SCREEN_WORDS,
  missionCardScreen,
  missionChoiceScreen,
  MissionScreens,
  missionScreensScene,
  outcomeScreen,
  resultsScreen,
  windowBadgeScreen,
  type MissionCardView,
  type MissionCardLook,
  type MissionScreenContext,
  type MissionScreenKind,
  type MissionScreensOptions,
  type MissionScreenWords,
  type ResultsView,
} from './mission-screens';
export { MISSION_BAR_HEIGHT, mountMissionBar, type MissionBar, type MissionBarOptions } from './mission-bar';
export { ShellTransitions, type ShellTransitionOptions, type TransitionRequest } from './transitions';
export { GameSpeed, SPEED_BUTTON_ID, SPEED_CODES, SPEED_PAD_BUTTON, SPEED_STATUS } from './game-speed';
export { UiScene, type UiSceneOptions } from './ui-scene';
export { GameMenus, type GameMenusOptions, type MenuSettingsHost, type MenusState } from './game-menus';
export {
  isLayerRound,
  roundLayerDisplay,
  type RoundLayerDisplay,
  type RoundLayerOptions,
} from './round-layer';
