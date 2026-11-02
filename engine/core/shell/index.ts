/** The browser shell games share (Engine 0.7): backend choice, the host scene, displays and the boot. */
export {
  backendFromQuery,
  otherBackendLink,
  THREE_QUERY,
  type BackendLink,
  type PageBackend,
} from './backend-choice';
export type { BrowserDisplay, DisplayResult } from './display';
export { HostScene, type HostDrawer, type HostSceneOptions } from './host-scene';
export {
  bootBrowserGame,
  showBackendToggle,
  showDisplayMessage,
  type BootedGame,
  type BrowserBootOptions,
  type DisplayFactory,
} from './boot';
