import { BlurFilter } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import { RGBSplitFilter } from "../../filters/RGBSplitFilter";
import { WarpFilter } from "../../filters/WarpFilter";
import { PixelateFilter } from "../../filters/PixelateFilter";
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

// 像素化 (Pixelate) —— DIP-FX M0 模板，静态 instant 滤镜
// 纯下采样，char/group/block 皆可；作用域靠显式 :group/:block 路由
// （默认 f.pixelate 走 char 逐字，{...} @ f.pixelate 仍逐字，要容器级须 f.pixelate:group）。
// 返回 filter 实例供 PlaybackController.registerInstantEffects 做 seek 幂等清理。
const _pixelate: EffectFunction = (target, params = {}) => {
  const size = params.size ?? 8;
  const filter = new PixelateFilter();
  filter.size = size;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const pixelate = defineEffect(_pixelate, {
  type: "filter",
  track: "instant",            // 静态滤镜；依赖 commit ce647c3 的 instant 桶生效
  targetType: "both",
  mutexGroup: "filter_pixelate",
  stackable: true,             // 多次叠加加深像素化
});
