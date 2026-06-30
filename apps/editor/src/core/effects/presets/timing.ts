import gsap from "gsap";
import type { EffectFunction, EffectMetadata } from "../types";
import { EffectProcessor } from "../EffectProcessor";

function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

export const go = defineEffect((_target, params = {}) => ({
  type: "delay", value: EffectProcessor.resolvePauseDuration(params, 0)
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

export const slow = defineEffect((_target, params = {}) => ({
  type: "speedMultiplier", value: Number(params.factor ?? params.f ?? params[0] ?? 2.0)
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

export const fast = defineEffect((_target, params = {}) => ({
  type: "speedMultiplier", value: Number(params.factor ?? params.f ?? params[0] ?? 0.5)
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

export const hold = defineEffect((_target, params = {}) => new Promise<void>(resolve => {
  gsap.delayedCall(EffectProcessor.resolvePauseDuration(params, 1), resolve);
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});
