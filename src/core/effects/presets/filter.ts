import { BlurFilter } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import { RGBSplitFilter } from "../../filters/RGBSplitFilter";
import { WarpFilter } from "../../filters/WarpFilter";
import type { EffectFunction, EffectMetadata } from "../types";

function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// RGB偏移 (RGB Shift)
const _rgbShift: EffectFunction = (target, params = {}) => {
  const distance = params.dist || 5;
  const filter = new RGBSplitFilter();
  filter.offset = { x: distance, y: 0 };
  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    if (target instanceof KineticChar) {
      target.addModifier("rgbAnim", 'behavior', (t) => {
        filter.offset = { x: Math.sin(t * 0.05) * distance, y: Math.cos(t * 0.03) * distance };
        return {};
      });
    }
  }
};
export const rgbShift = defineEffect(_rgbShift, {
  type: "filter",
  track: "behavior",  // 修复：当 anim=true 时使用 addModifier
  targetType: "both",
  mutexGroup: "filter_rgb",
});

// 扭曲 (Warp)
const _warp: EffectFunction = (target, params = {}) => {
  if (!(target instanceof KineticChar)) {
    console.warn("[Effect] warp effect requires KineticChar");
    return;
  }
  const freq = params.freq || 10;
  const amp = params.amp || 0.05;
  const speed = params.speed || 0.01;

  const filter = new WarpFilter();
  filter.frequency = freq;
  filter.amplitude = amp;
  filter.padding = 20;

  target.filters = [...(target.filters || []), filter];

  target.addModifier("warpAnim", 'behavior', (time: number) => {
    filter.time = time * speed;
    return {};
  });
};
export const warp = defineEffect(_warp, {
  type: "filter",
  track: "behavior",  // 修复：总是使用 addModifier 更新 filter.time
  targetType: "char",
  mutexGroup: "filter_warp",
});

// 模糊 (Blur)
const _blur: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 4;
  const filter = new BlurFilter();
  filter.strength = strength;

  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    if (target instanceof KineticChar) {
      target.addModifier("blurAnim", 'behavior', (time: number) => {
        filter.strength = (Math.sin(time * 0.005) + 1) * strength;
        return {};
      });
    }
  }
};
export const blur = defineEffect(_blur, {
  type: "filter",
  track: "behavior",  // 修复：当 anim=true 时使用 addModifier
  targetType: "both",
  mutexGroup: "filter_blur",
  stackable: true,
});
