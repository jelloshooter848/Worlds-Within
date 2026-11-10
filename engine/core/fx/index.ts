export { fxRange, fxRng } from './rng';
export { ease, EASE_NAMES, isEaseName, type EaseName } from './ease';
export { lerpColor, parseHexColor } from './color';
export {
  TWEEN_DEFAULT_AMOUNT,
  TWEEN_DEFAULT_FROM_COLOR,
  TWEEN_PROPS,
  TWEEN_REST,
  tweenSpecSchema,
  tweensSchema,
  type ColorTweenSpec,
  type NumberTweenProp,
  type NumberTweenSpec,
  type TweenProp,
  type TweenSpec,
  type TweensSpec,
} from './schema';
export { REST_STATE, Tween, tweenList, TweenSet, type TweenState } from './tween';
export { EMITTER_DEFAULTS, emitterSchema, type EmitterDef, type Keyframes } from './schema';
export {
  anchorPoint,
  keyframeAt,
  PARTICLE_CATCH_UP,
  PARTICLE_SYSTEM_MAX,
  ParticleSystem,
  type ParticleAnchorBox,
  type ParticleLocate,
  type ParticleSystemOptions,
  type ParticleView,
} from './particles';
export { REDUCED_FLASH_ALPHA, SkinParticles } from './skin-particles';
