/** The browser shell games share (Engine 0.7): backend choice, the host scene, displays and the boot. */
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
  showBackendToggle,
  showDisplayMessage,
  type BootAudio,
  type BootedGame,
  type BootPage,
  type BrowserBootOptions,
  type DisplayFactory,
  type DisplayShell,
} from './boot';
export {
  CampaignSession,
  type CampaignEntryEnd,
  type CampaignResume,
  type CampaignResumeRefusalCode,
} from './campaign-session';
