import { BlurFilter } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import { RGBSplitFilter } from "../../filters/RGBSplitFilter";
import { WarpFilter } from "../../filters/WarpFilter";
import { PixelateFilter } from "../../filters/PixelateFilter";
import { GrayFilter } from "../../filters/GrayFilter";
import { ThresholdFilter } from "../../filters/ThresholdFilter";
import { DuotoneFilter } from "../../filters/DuotoneFilter";
import { PosterizeFilter } from "../../filters/PosterizeFilter";
import { SharpenFilter } from "../../filters/SharpenFilter";
import { EmbossFilter } from "../../filters/EmbossFilter";
import { EdgeFilter } from "../../filters/EdgeFilter";
import { OutlineFilter } from "../../filters/OutlineFilter";
import { BloomFilter } from "../../filters/BloomFilter";
import { HalftoneFilter } from "../../filters/HalftoneFilter";
import { hexToVec3 } from "../../filters/colorUtils";
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

// 灰度 (Gray) —— DIP-FX M1 点运算模板，静态 instant 滤镜
// luma = dot(rgb, BT.609)，按 mix 在原色与灰度间插值。
// 预乘 alpha 对偶（解预乘→运算→重新预乘），半透明字无暗边。
// char/group/block 皆可；返回 filter 实例供 seek 幂等清理。
const _gray: EffectFunction = (target, params = {}) => {
  const mix = params.mix ?? 1;
  const filter = new GrayFilter();
  filter.mix = mix;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const gray = defineEffect(_gray, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_color",
  stackable: true,
});

// 阈值 (Threshold) —— DIP-FX M1 点运算，luma 经 smoothstep 软阈值输出黑白。
// 预乘 alpha 对偶；纯逐像素，无 padding。返回 filter 实例供 seek 幂等清理。
const _threshold: EffectFunction = (target, params = {}) => {
  const level = params.level ?? 0.5;
  const soft = params.soft ?? 0.02;
  const filter = new ThresholdFilter();
  filter.level = level;
  filter.soft = soft;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const threshold = defineEffect(_threshold, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_color",
  stackable: true,
});

// 双色 (Duotone) —— DIP-FX M1 点运算，luma 映射到 shadow→highlight 渐变。
// 颜色参数经 hexToVec3 转换（解析器不解析 hex，转换由滤镜侧负责）。
// 预乘 alpha 对偶；纯逐像素，无 padding。
const _duotone: EffectFunction = (target, params = {}) => {
  const shadow = params.shadow ?? "#1a1a2e";
  const highlight = params.highlight ?? "#e94560";
  const filter = new DuotoneFilter();
  filter.shadow = hexToVec3(shadow);
  filter.highlight = hexToVec3(highlight);
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const duotone = defineEffect(_duotone, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_color",
  stackable: true,
});

// 色调分离 (Posterize) —— DIP-FX M1 点运算 + 可选 Bayer 4×4 抖动。
// levels 钳制 ≥2 防除零；dither 为 0/1 开关。预乘 alpha 对偶；无 padding。
const _posterize: EffectFunction = (target, params = {}) => {
  const levels = Math.max(2, params.levels ?? 4);
  const dither = params.dither ? 1 : 0;
  const filter = new PosterizeFilter();
  filter.levels = levels;
  filter.dither = dither;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const posterize = defineEffect(_posterize, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_color",
  stackable: true,
});

// 锐化 (Sharpen) —— DIP-FX M1 卷积模板，unsharp mask。
// 3×3 邻域采样，步长 radius 像素；filter.padding 匹配步长防透明边。
// 预乘 alpha 对偶；char/group/block 皆可。返回 filter 实例供 seek 幂等清理。
const _sharpen: EffectFunction = (target, params = {}) => {
  const amount = params.amount ?? 1;
  const radius = params.radius ?? 1;
  const filter = new SharpenFilter();
  filter.amount = amount;
  filter.radius = radius;            // setter 同步更新 padding
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const sharpen = defineEffect(_sharpen, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_conv",
  stackable: true,
});

// 浮雕 (Emboss) —— DIP-FX M1 alpha 梯度浮雕。
// 对 alpha 通道做多步长方向梯度（1px 细节 + width 像素斜坡），
// 让平坦文字内部也产生 3D 凹凸感。也可与 f.blur.emboss 链式组合。
// 预乘 alpha 对偶；叠加心智（默认 mix=0.5，浮雕灰阶叠加在原图之上）。
const _emboss: EffectFunction = (target, params = {}) => {
  const strength = params.strength ?? 1;
  const angle = params.angle ?? 45;
  const mix = params.mix ?? 0.5;
  const width = params.width ?? 3;
  const filter = new EmbossFilter();
  filter.strength = strength;
  filter.angle = angle;
  filter.mix = mix;
  filter.width = width;             // setter 同步更新 padding
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const emboss = defineEffect(_emboss, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_conv",
  stackable: true,
});

// 描边 (Edge) —— DIP-FX M1 alpha 内描边（类似 CSS text-stroke）。
// 在文字边缘像素上着色 uColor，区别于 outline（外描边膨胀到文字外）。
// uColor 经 hexToVec3 转换。padding = ceil(width)。
// 预乘 alpha 对偶；叠加心智（默认 mix=0.9）。
//
// width 自适应：
// - 用户不写 width 时，默认值 = 字号 × 5%（36px 字 → ~2px 描边，可见）。
//   固定 1px 在默认渲染缩放下太小，描边不可见。
// - 用户写了 width 时，clamp 到笔画可容纳范围（字号 × 0.12 × 0.8），
//   避免 width 超过笔画宽度时整字变色。大字 width=3 正常，小字自动缩。
const _edge: EffectFunction = (target, params = {}) => {
  const color = params.color ?? "#000";
  const mix = params.mix ?? 0.9;
  const userWidth = params.width;  // undefined = 未指定，用自适应默认

  // 从 target 推导字号（char/group/block 三种容器）
  let fontSize = 36;  // 默认假设
  if (target instanceof KineticChar) {
    fontSize = (target.style as any).fontSize ?? 36;
  } else if ((target as any)._options?.fontSize) {
    // KineticText (block scope)
    fontSize = (target as any)._options.fontSize;
  } else if ((target as any).chars?.[0]?.style?.fontSize) {
    // TokenWrapper (group scope)
    fontSize = (target as any).chars[0].style.fontSize;
  }

  // 默认 width = 字号 × 5%（可见描边）；用户指定则用用户值
  // clamp 到笔画可容纳范围（字号 × 0.12 × 0.8），防小字全变色
  const defaultWidth = Math.max(1, fontSize * 0.05);
  const maxStrokeWidth = Math.max(1, fontSize * 0.12 * 0.8);
  const requestedWidth = userWidth ?? defaultWidth;
  const effectiveWidth = Math.min(requestedWidth, maxStrokeWidth);

  const filter = new EdgeFilter();
  filter.width = effectiveWidth;
  filter.color = hexToVec3(color);
  filter.mix = mix;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const edge = defineEffect(_edge, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_conv",
  stackable: true,
});

// 描边 (Outline) —— DIP-FX M1 形态学，对 alpha 做 8 方向膨胀取轮廓。
// uColor 经 hexToVec3 转换。padding = ceil(width*2)（含发光扩展）。
// char 级即逐字描边，常用；预乘 alpha 对偶。
//
// width 自适应（同 edge）：默认 = 字号 × 5%，用户指定则 clamp 到笔画
// 可容纳范围，避免小字全变色。
const _outline: EffectFunction = (target, params = {}) => {
  const color = params.color ?? "#fff";
  const glow = params.glow ?? 0;
  const userWidth = params.width;

  // 从 target 推导字号（同 edge）
  let fontSize = 36;
  if (target instanceof KineticChar) {
    fontSize = (target.style as any).fontSize ?? 36;
  } else if ((target as any)._options?.fontSize) {
    fontSize = (target as any)._options.fontSize;
  } else if ((target as any).chars?.[0]?.style?.fontSize) {
    fontSize = (target as any).chars[0].style.fontSize;
  }

  const defaultWidth = Math.max(1, fontSize * 0.05);
  const maxWidth = Math.max(1, fontSize * 0.15);  // 外描边可稍宽
  const requestedWidth = userWidth ?? defaultWidth;
  const effectiveWidth = Math.min(requestedWidth, maxWidth);

  const filter = new OutlineFilter();
  filter.width = effectiveWidth;          // setter 同步更新 padding
  filter.color = hexToVec3(color);
  filter.glow = glow;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const outline = defineEffect(_outline, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_outline",
  stackable: true,
});

// 辉光 (Bloom) —— DIP-FX M1 收尾，单 shader 16-tap 环形采样 + screen 合成。
// Pixi v8 线性 filter 管线无法跨 filter 访问原图，故用单 shader（见 BloomFilter 注释）。
// padding = ceil(radius)。预乘 alpha 对偶。推荐 :block（char 小纹理几乎无效）。
const _bloom: EffectFunction = (target, params = {}) => {
  const threshold = params.threshold ?? 0.7;
  const strength = params.strength ?? 1;
  const radius = params.radius ?? 4;
  const filter = new BloomFilter();
  filter.threshold = threshold;
  filter.strength = strength;
  filter.radius = radius;             // setter 同步更新 padding
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const bloom = defineEffect(_bloom, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_bloom",
  stackable: true,
});

// 半调 (Halftone) —— DIP-FX M1 收尾，网格网点（dot/line）。
// invert: false=暗部大点（印刷默认），true=亮部大点（白字黑底场景）。
// padding = ceil(scale)。预乘 alpha 对偶。推荐 :block（需连续区域成网点视觉）。
const _halftone: EffectFunction = (target, params = {}) => {
  const scale = params.scale ?? 6;
  const angle = params.angle ?? 0;
  const shape = params.shape === "line" ? 1 : 0;
  const invert = params.invert ? 1 : 0;
  const filter = new HalftoneFilter();
  filter.scale = scale;               // setter 同步更新 padding
  filter.angle = angle;
  filter.shape = shape;
  filter.invert = invert;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const halftone = defineEffect(_halftone, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_halftone",
  stackable: true,
});
