import gsap from "gsap";
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
import { VignetteFilter } from "../../filters/VignetteFilter";
import { ScanlineFilter } from "../../filters/ScanlineFilter";
import { NoiseFilter } from "../../filters/NoiseFilter";
import { DissolveFilter } from "../../filters/DissolveFilter";
import { DisplaceFilter } from "../../filters/DisplaceFilter";
import { hexToVec3 } from "../../filters/colorUtils";
import type { EffectFunction, EffectMetadata } from "../types";

function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// RGB偏移 (RGB Shift) —— behavior-track filter。
// char 级：addModifier 驱动 offset 动画 + return filter（cleanup 靠 removeModifier + 移除 filter）。
// 容器级（:group/:block）：ticker 回调驱动 offset + return BehaviorFilterResult（cleanup 靠
//   gsap.ticker.remove + 移除 filter）。无 anim 时静态 filter 仍 return filter 供 cleanup。
const _rgbShift: EffectFunction = (target, params = {}) => {
  const distance = params.dist || 5;
  const filter = new RGBSplitFilter();
  filter.offset = { x: distance, y: 0 };
  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    if (target instanceof KineticChar) {
      // modifier id 必须等于 effectName：PlaybackController.clearBehaviors 用
      // removeModifier(effectName) 精确删除（Map.delete）。原 "rgbAnim" 命中失败
      // → modifier 残留继续 tick、写已 destroy 的 filter uniform。
      target.addModifier("rgbShift", 'behavior', (t) => {
        filter.offset = { x: Math.sin(t * 0.05) * distance, y: Math.cos(t * 0.03) * distance };
        return {};
      });
      return filter;
    } else {
      // 容器级无 addModifier → ticker 回调驱动。
      const tickFn = () => {
        const t = gsap.ticker.time * 1000;
        filter.offset = { x: Math.sin(t * 0.05) * distance, y: Math.cos(t * 0.03) * distance };
      };
      gsap.ticker.add(tickFn);
      return { filters: filter, tickerFn: tickFn };
    }
  }
  return filter;
};
export const rgbShift = defineEffect(_rgbShift, {
  type: "filter",
  track: "behavior",  // 修复：当 anim=true 时使用 addModifier
  targetType: "both",
  mutexGroup: "filter_rgb",
});

// 扭曲 (Warp) —— behavior-track filter。char + 容器级皆可。
// char 级：addModifier 驱动 uTime + return filter（modifier 靠 modName 经 removeModifier 清理）。
// 容器级（:group/:block/:bg）：gsap.ticker.add 驱动 + return BehaviorFilterResult。
const _warp: EffectFunction = (target, params = {}) => {
  const freq = params.freq || 10;
  const amp = params.amp || 0.05;
  const speed = params.speed || 0.01;

  const filter = new WarpFilter();
  filter.frequency = freq;
  filter.amplitude = amp;
  filter.padding = 20;

  target.filters = [...(target.filters || []), filter];

  // modifier id = effectName（见 rgbShift 注释）。
  if (target instanceof KineticChar) {
    target.addModifier("warp", 'behavior', (time: number) => {
      filter.time = time * speed;
      return {};
    });
    return filter;
  } else {
    const tickFn = () => {
      filter.time = gsap.ticker.time * 1000 * speed;
    };
    gsap.ticker.add(tickFn);
    return { filters: filter, tickerFn: tickFn };
  }
};
export const warp = defineEffect(_warp, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_warp",
});

// 模糊 (Blur) —— behavior-track filter。
// char 级：addModifier 驱动 strength 动画 + return filter。
// 容器级（:group/:block）：ticker 回调驱动 + return BehaviorFilterResult。
// 无 anim 时静态 filter 仍 return filter 供 cleanup（behavior track 下 seek 仍需移除）。
const _blur: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 4;
  const filter = new BlurFilter();
  filter.strength = strength;

  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    if (target instanceof KineticChar) {
      // modifier id = effectName（见 rgbShift 注释）。
      target.addModifier("blur", 'behavior', (time: number) => {
        filter.strength = (Math.sin(time * 0.005) + 1) * strength;
        return {};
      });
      return filter;
    } else {
      const tickFn = () => {
        const t = gsap.ticker.time * 1000;
        filter.strength = (Math.sin(t * 0.005) + 1) * strength;
      };
      gsap.ticker.add(tickFn);
      return { filters: filter, tickerFn: tickFn };
    }
  }
  return filter;
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

// ── DIP-FX M2 氛围集 ──

// 暗角 (Vignette) —— DIP-FX M2 氛围集，静态 instant 滤镜。
// 径向亮度衰减。推荐 :block（整段才有暗角语义）。预乘 alpha 对偶。
const _vignette: EffectFunction = (target, params = {}) => {
  const radius = params.radius ?? 0.75;
  const softness = params.softness ?? 0.45;
  const filter = new VignetteFilter();
  filter.radius = radius;
  filter.softness = softness;
  target.filters = [...(target.filters || []), filter];
  return filter;
};
export const vignette = defineEffect(_vignette, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_vignette",
  stackable: true,
});

// 扫描线 (Scanline) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// CRT 周期亮度调制 + 可选桶形畸变 + 闪烁。推荐 :block。
const _scanline: EffectFunction = (target, params = {}) => {
  const density = params.density ?? 2;
  const curvature = params.curvature ?? 0;
  const flicker = params.flicker ?? 0;
  const speed = params.speed ?? 0.01;
  const filter = new ScanlineFilter();
  filter.density = density;
  filter.curvature = curvature;
  filter.flicker = flicker;
  target.filters = [...(target.filters || []), filter];

  if (target instanceof KineticChar) {
    target.addModifier("scanline", 'behavior', (t) => {
      filter.time = t * speed;
      return {};
    });
    return filter;
  } else {
    const tickFn = () => {
      filter.time = gsap.ticker.time * 1000 * speed;
    };
    gsap.ticker.add(tickFn);
    return { filters: filter, tickerFn: tickFn };
  }
};
export const scanline = defineEffect(_scanline, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_scanline",
});

// 噪声 (Noise) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 时变噪声叠加，uMono 控制单色/彩噪。数字降解视觉。
const _noise: EffectFunction = (target, params = {}) => {
  const amount = params.amount ?? 0.1;
  const mono = params.mono !== undefined ? (params.mono ? 1 : 0) : 1;
  const scale = params.scale ?? 4;
  const speed = params.speed ?? 0.01;
  const filter = new NoiseFilter();
  filter.amount = amount;
  filter.mono = mono;
  filter.scale = scale;
  target.filters = [...(target.filters || []), filter];

  if (target instanceof KineticChar) {
    target.addModifier("noise", 'behavior', (t) => {
      filter.time = t * speed;
      return {};
    });
    return filter;
  } else {
    const tickFn = () => {
      filter.time = gsap.ticker.time * 1000 * speed;
    };
    gsap.ticker.add(tickFn);
    return { filters: filter, tickerFn: tickFn };
  }
};
export const noise = defineEffect(_noise, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_noise",
});

// 溶解 (Dissolve) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 噪声场与 uProgress 阈值比较：低于阈值 alpha=0（消散），边缘带用 uEdge 上色。
// progress 来源：state 对象 + gsap tween（同构 fadeShake），作者可 progress= 锁定。
// char 级 return { filters, tween }（无 tickerFn——progress 由 addModifier 逐帧驱动；
//   filters 字段仍需带上，否则 unpackBehaviorResult 只捕获 tween，char.filters 里的
//   DissolveFilter 永远不会被 clearBehaviors 移除/destroy，seek 反复触发会不断堆积）。
// 容器级 return { filters, tickerFn, tween }（BehaviorFilterResult.tween 被 unpackBehaviorResult 提取）。
const _dissolve: EffectFunction = (target, params = {}) => {
  const progress = params.progress;
  const scale = params.scale ?? 8;
  const edgeColor = params.edge ?? "#fff";
  const duration = params.duration ?? 1;
  const ease = params.ease ?? "none";
  const filter = new DissolveFilter();
  filter.scale = scale;
  filter.edge = hexToVec3(edgeColor);
  target.filters = [...(target.filters || []), filter];

  // 静态 progress 锁定（作者给定 progress= 值）
  if (progress !== undefined) {
    filter.progress = progress;
    // 仍需 cleanup：behavior track 的 filter 靠 clearBehaviors 移除
    if (target instanceof KineticChar) {
      // char 级无需 modifier（progress 是静态的），但仍需 return filter 供 cleanup
      return filter;
    } else {
      // 容器级无 ticker（progress 静态），但仍需 return filter 供 cleanup
      return filter;
    }
  }

  // 自动 progress 0→1（同构 fadeShake）
  const state = { progress: 0 };
  const progressTween = gsap.to(state, { progress: 1, duration, ease });

  if (target instanceof KineticChar) {
    target.addModifier("dissolve", 'behavior', () => {
      filter.progress = state.progress;
      return {};
    });
    // 无 tickerFn（progress 已由 addModifier 驱动），但仍需带 filters 供 clearBehaviors 清理。
    return { filters: filter, tween: progressTween };
  } else {
    const tickFn = () => {
      filter.progress = state.progress;
    };
    gsap.ticker.add(tickFn);
    return { filters: filter, tickerFn: tickFn, tween: progressTween };
  }
};
export const dissolve = defineEffect(_dissolve, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_dissolve",
});

// 位移 (Displace) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 噪声场驱动 UV 位移，underwater 组合的几何半边。推荐 :block。
// char 级 addModifier 驱动 uTime + return filter；容器级 gsap.ticker.add + return BehaviorFilterResult。
const _displace: EffectFunction = (target, params = {}) => {
  const amount = params.amount ?? 10;
  const scale = params.scale ?? 4;
  const speed = params.speed ?? 0.01;
  const filter = new DisplaceFilter();
  filter.amount = amount;
  filter.scale = scale;
  target.filters = [...(target.filters || []), filter];

  if (target instanceof KineticChar) {
    target.addModifier("displace", 'behavior', (t) => {
      filter.time = t * speed;
      return {};
    });
    return filter;
  } else {
    const tickFn = () => {
      filter.time = gsap.ticker.time * 1000 * speed;
    };
    gsap.ticker.add(tickFn);
    return { filters: filter, tickerFn: tickFn };
  }
};
export const displace = defineEffect(_displace, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_displace",
});

// 水下 (Underwater) —— DIP-FX M2 旗舰组合预设（非新 shader）。
// fn 内组合 displace（波纹位移）+ duotone（蓝移 tint）+ blur（Pixi BlurFilter 轻 blur），
// 串进 target.filters，一个 tickerFn/addModifier 驱动全部 filter 的 uTime。
// 首个返回 filters: Filter[] 的 preset——cleanup 经 clearBehaviors 的 Array.isArray 分支
// 逐个移除 + destroyFilterDeep（BlurFilter 子 pass 已覆盖），无需改 PlaybackController。
// duotone 直接 new DuotoneFilter() 构造（不调 duotone effect fn，避免双注册 + 双 push）。
// char 级 return { filters: [...] }（无 tickerFn，addModifier 驱动，同 dissolve char 级形态）；
// 容器级 return { filters: [...], tickerFn }。
const _underwater: EffectFunction = (target, params = {}) => {
  const amount = params.amount ?? 8;
  const scale = params.scale ?? 4;
  const speed = params.speed ?? 0.01;
  const tint = params.tint ?? "#0a1e3f";       // 深蓝 shadow
  const highlight = params.highlight ?? "#5fb8d6"; // 浅青 highlight
  const blurStrength = params.blur ?? 1;

  const displaceFilter = new DisplaceFilter();
  displaceFilter.amount = amount;
  displaceFilter.scale = scale;

  const duotoneFilter = new DuotoneFilter();
  duotoneFilter.shadow = hexToVec3(tint);
  duotoneFilter.highlight = hexToVec3(highlight);

  const blurFilter = new BlurFilter();
  blurFilter.strength = blurStrength;

  const filters = [displaceFilter, duotoneFilter, blurFilter];
  for (const f of filters) {
    target.filters = [...(target.filters || []), f];
  }

  if (target instanceof KineticChar) {
    target.addModifier("underwater", 'behavior', (t) => {
      displaceFilter.time = t * speed;
      return {};
    });
    // 无 tickerFn（displace.time 由 addModifier 驱动；duotone/blur 静态无 time）。
    // filters 数组供 clearBehaviors 移除全部三个（同 dissolve char 级 { filters, tween } 形态）。
    return { filters };
  } else {
    const tickFn = () => {
      displaceFilter.time = gsap.ticker.time * 1000 * speed;
    };
    gsap.ticker.add(tickFn);
    return { filters, tickerFn: tickFn };
  }
};
export const underwater = defineEffect(_underwater, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_underwater",
});
