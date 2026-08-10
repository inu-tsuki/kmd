import gsap from "gsap";
import { Filter } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import { BloomFilter } from "../../filters/BloomFilter";
import { BackgroundDuotoneFilter, TextDuotoneFilter } from "../../filters/duotone";
import { hexToVec3 } from "../../filters/colorUtils";
import { NoiseFilter } from "../../filters/NoiseFilter";
import { OutlineFilter } from "../../filters/OutlineFilter";
import { PixelateFilter } from "../../filters/PixelateFilter";
import { RGBSplitFilter } from "../../filters/RGBSplitFilter";
import { ScanlineFilter } from "../../filters/ScanlineFilter";
import { VignetteFilter } from "../../filters/VignetteFilter";
import type {
  EffectDefinition,
  EffectFunction,
  EffectMetadata,
  EffectParameterMetadata,
  EffectParams,
} from "../types";

type ParameterSchema = Readonly<Record<string, EffectParameterMetadata>>;
type ModifierResult = { x?: number; y?: number; alpha?: number };

function defineEffect(
  fn: EffectFunction,
  meta: EffectMetadata,
  profiles?: EffectDefinition["profiles"],
): EffectDefinition {
  return { fn, meta, profiles };
}

function readNumber(params: EffectParams, schema: ParameterSchema, name: string): number {
  const spec = schema[name];
  if (!spec || spec.type !== "number" || typeof spec.default !== "number") {
    throw new Error(`[CyberpunkPreset] Missing numeric parameter schema: ${name}`);
  }
  const parsed = Number(params[name]);
  let value = Number.isFinite(parsed) ? parsed : spec.default;
  if (spec.min !== undefined) value = Math.max(spec.min, value);
  if (spec.max !== undefined) value = Math.min(spec.max, value);
  return value;
}

function readColor(params: EffectParams, schema: ParameterSchema, name: string): string | number {
  const spec = schema[name];
  if (!spec || spec.type !== "color") {
    throw new Error(`[CyberpunkPreset] Missing color parameter schema: ${name}`);
  }
  const value = params[name];
  return typeof value === "string" || typeof value === "number" ? value : spec.default as string;
}

function mountBehaviorFilters(
  target: Parameters<EffectFunction>[0],
  effectName: string,
  filters: Filter[],
  update: (timeMs: number) => void,
  modifier?: (timeMs: number) => ModifierResult,
) {
  update(0);
  target.filters = [...(target.filters || []), ...filters];

  if (target instanceof KineticChar) {
    // modifier id 必须与 effectName 一致，clearBehaviors 才能在 seek/stop 时精确移除。
    target.addModifier(effectName, "behavior", (timeMs) => {
      update(timeMs);
      return modifier?.(timeMs) ?? {};
    });
    return { filters };
  }

  // group/block 无 KineticChar modifier，统一用单 ticker 驱动组合内全部 filter。
  const tickerFn = () => update(gsap.ticker.time * 1000);
  gsap.ticker.add(tickerFn);
  return { filters, tickerFn };
}

function hash01(value: number, seed: number): number {
  const x = Math.sin(value * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function oscillator(timeMs: number, speed: number, phase = 0): number {
  return Math.sin(timeMs * 0.001 * speed * Math.PI * 2 + phase);
}

const cyberGlitchParameters = {
  rgb: { type: "number", default: 10, min: 0, max: 64, step: 1, description: "RGB 通道最大撕裂距离（px）" },
  frequency: { type: "number", default: 4, min: 0.1, max: 30, step: 0.1, description: "故障采样频率（Hz）" },
  burst: { type: "number", default: 0.22, min: 0.02, max: 1, step: 0.01, description: "故障脉冲出现概率" },
  blockSize: { type: "number", default: 10, min: 1, max: 64, step: 1, description: "脉冲期间的像素块尺寸（px）" },
  noise: { type: "number", default: 0.16, min: 0, max: 1, step: 0.01, description: "数字噪声混合量" },
  jitter: { type: "number", default: 3, min: 0, max: 32, step: 0.5, description: "逐字水平跳帧距离（px）" },
} as const satisfies ParameterSchema;

const _cyberGlitch: EffectFunction = (target, params = {}) => {
  const rgbAmount = readNumber(params, cyberGlitchParameters, "rgb");
  const frequency = readNumber(params, cyberGlitchParameters, "frequency");
  const burst = readNumber(params, cyberGlitchParameters, "burst");
  const blockSize = readNumber(params, cyberGlitchParameters, "blockSize");
  const noiseAmount = readNumber(params, cyberGlitchParameters, "noise");
  const jitter = readNumber(params, cyberGlitchParameters, "jitter");

  const rgb = new RGBSplitFilter();
  const noise = new NoiseFilter();
  noise.mono = 0;
  noise.scale = 8;
  const pixelate = new PixelateFilter();

  const signal = (timeMs: number) => {
    const step = Math.floor(timeMs * 0.001 * frequency * 8);
    const active = hash01(step, 1.7) > 1 - burst ? 1 : 0;
    return {
      active,
      x: (hash01(step, 3.1) * 2 - 1) * rgbAmount * active,
      y: (hash01(step, 5.9) * 2 - 1) * rgbAmount * 0.35 * active,
    };
  };
  const update = (timeMs: number) => {
    const current = signal(timeMs);
    rgb.offset = { x: current.x, y: current.y };
    noise.time = timeMs * 0.001 * frequency;
    noise.amount = noiseAmount * (current.active ? 1 : 0.25);
    pixelate.size = current.active ? blockSize : 1;
  };

  return mountBehaviorFilters(target, "cyberGlitch", [rgb, noise, pixelate], update, (timeMs) => {
    const current = signal(timeMs);
    return { x: current.x / Math.max(rgbAmount, 1) * jitter };
  });
};

export const cyberGlitch = defineEffect(_cyberGlitch, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_cyber_glitch",
  category: "cyberpunk",
  parameters: cyberGlitchParameters,
});

const crtDisplayParameters = {
  density: { type: "number", default: 3, min: 0.25, max: 12, step: 0.25, description: "CRT 扫描线密度" },
  curvature: { type: "number", default: 0.12, min: 0, max: 1, step: 0.01, description: "桶形屏幕畸变强度" },
  flicker: { type: "number", default: 0.08, min: 0, max: 0.8, step: 0.01, description: "垂直同步亮度闪烁强度" },
  noise: { type: "number", default: 0.06, min: 0, max: 1, step: 0.01, description: "模拟雪花噪声混合量" },
  grain: { type: "number", default: 5, min: 0.5, max: 32, step: 0.5, description: "噪声颗粒尺度" },
  speed: { type: "number", default: 1.2, min: 0, max: 12, step: 0.1, description: "扫描与闪烁播放速度" },
  vignette: { type: "number", default: 0.78, min: 0.5, max: 1, step: 0.01, description: "暗角起始半径" },
  softness: { type: "number", default: 0.35, min: 0.05, max: 0.5, step: 0.01, description: "暗角过渡柔和度" },
} as const satisfies ParameterSchema;

const _crtDisplay: EffectFunction = (target, params = {}) => {
  const speed = readNumber(params, crtDisplayParameters, "speed");
  const scanline = new ScanlineFilter();
  scanline.density = readNumber(params, crtDisplayParameters, "density");
  scanline.curvature = readNumber(params, crtDisplayParameters, "curvature");
  scanline.flicker = readNumber(params, crtDisplayParameters, "flicker");

  const noise = new NoiseFilter();
  noise.amount = readNumber(params, crtDisplayParameters, "noise");
  noise.scale = readNumber(params, crtDisplayParameters, "grain");
  noise.mono = 1;

  const vignette = new VignetteFilter();
  vignette.radius = readNumber(params, crtDisplayParameters, "vignette");
  vignette.softness = readNumber(params, crtDisplayParameters, "softness");

  return mountBehaviorFilters(target, "crtDisplay", [scanline, noise, vignette], (timeMs) => {
    const time = timeMs * 0.001 * speed;
    scanline.time = time;
    noise.time = time * 0.73;
  });
};

export const crtDisplay = defineEffect(_crtDisplay, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_crt_display",
  category: "cyberpunk",
  parameters: crtDisplayParameters,
});

const neonGlowParameters = {
  color: { type: "color", default: "#00f5ff", description: "霓虹高光颜色" },
  shadow: { type: "color", default: "#07131f", description: "霓虹暗部颜色" },
  strength: { type: "number", default: 1.8, min: 0, max: 6, step: 0.1, description: "Bloom 曝光强度" },
  radius: { type: "number", default: 7, min: 1, max: 32, step: 1, description: "Bloom 扩散半径（px）" },
  threshold: { type: "number", default: 0.3, min: 0, max: 1, step: 0.01, description: "Bloom 亮部提取阈值" },
  width: { type: "number", default: 2, min: 0.5, max: 16, step: 0.5, description: "文字霓虹描边宽度（px）" },
  outlineGlow: { type: "number", default: 1, min: 0, max: 3, step: 0.1, description: "文字外描边发光强度" },
  pulse: { type: "number", default: 0.25, min: 0, max: 1, step: 0.01, description: "辉光呼吸振幅" },
  speed: { type: "number", default: 1.1, min: 0, max: 10, step: 0.1, description: "辉光呼吸速度（Hz）" },
} as const satisfies ParameterSchema;

const createNeonGlow = (backgroundProfile: boolean): EffectFunction => (target, params = {}) => {
  const color = readColor(params, neonGlowParameters, "color");
  const shadow = readColor(params, neonGlowParameters, "shadow");
  const baseStrength = readNumber(params, neonGlowParameters, "strength");
  const pulse = readNumber(params, neonGlowParameters, "pulse");
  const speed = readNumber(params, neonGlowParameters, "speed");

  const duotone = backgroundProfile ? new BackgroundDuotoneFilter() : new TextDuotoneFilter();
  duotone.shadow = hexToVec3(shadow);
  duotone.highlight = hexToVec3(color);

  const filters: Filter[] = [duotone];
  if (!backgroundProfile) {
    const outline = new OutlineFilter();
    outline.color = hexToVec3(color);
    outline.width = readNumber(params, neonGlowParameters, "width");
    outline.glow = readNumber(params, neonGlowParameters, "outlineGlow");
    filters.push(outline);
  }

  const bloom = new BloomFilter();
  bloom.radius = readNumber(params, neonGlowParameters, "radius");
  bloom.threshold = readNumber(params, neonGlowParameters, "threshold");
  filters.push(bloom);

  return mountBehaviorFilters(target, "neonGlow", filters, (timeMs) => {
    bloom.strength = baseStrength * (1 + oscillator(timeMs, speed) * pulse);
  });
};

const _neonGlow = createNeonGlow(false);
const _backgroundNeonGlow = createNeonGlow(true);
export const neonGlow = defineEffect(_neonGlow, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_neon_glow",
  category: "cyberpunk",
  parameters: neonGlowParameters,
}, { background: _backgroundNeonGlow });

const digitalFlickerParameters = {
  rate: { type: "number", default: 12, min: 0.5, max: 60, step: 0.5, description: "亮度采样频率（Hz）" },
  duty: { type: "number", default: 0.22, min: 0.02, max: 1, step: 0.01, description: "出现暗帧的概率" },
  intensity: { type: "number", default: 0.65, min: 0, max: 1, step: 0.01, description: "暗帧最大衰减量" },
  minAlpha: { type: "number", default: 0.25, min: 0, max: 1, step: 0.01, description: "暗帧透明度下限" },
  noise: { type: "number", default: 0.08, min: 0, max: 1, step: 0.01, description: "暗帧伴随的数字噪声量" },
  density: { type: "number", default: 3, min: 0.25, max: 12, step: 0.25, description: "伴随扫描线密度" },
} as const satisfies ParameterSchema;

const _digitalFlicker: EffectFunction = (target, params = {}) => {
  if (!(target instanceof KineticChar)) return;

  const rate = readNumber(params, digitalFlickerParameters, "rate");
  const duty = readNumber(params, digitalFlickerParameters, "duty");
  const intensity = readNumber(params, digitalFlickerParameters, "intensity");
  const minAlpha = readNumber(params, digitalFlickerParameters, "minAlpha");
  const noiseAmount = readNumber(params, digitalFlickerParameters, "noise");

  const noise = new NoiseFilter();
  noise.mono = 1;
  noise.scale = 10;
  const scanline = new ScanlineFilter();
  scanline.density = readNumber(params, digitalFlickerParameters, "density");
  scanline.flicker = intensity * 0.2;

  const frame = (timeMs: number) => {
    const step = Math.floor(timeMs * 0.001 * rate);
    const amount = hash01(step, 9.7);
    const active = amount < duty;
    return {
      active,
      alpha: active ? Math.max(minAlpha, 1 - intensity * hash01(step, 4.3)) : 1,
    };
  };

  return mountBehaviorFilters(target, "digitalFlicker", [noise, scanline], (timeMs) => {
    const current = frame(timeMs);
    noise.time = timeMs * 0.001 * rate;
    noise.amount = current.active ? noiseAmount : noiseAmount * 0.15;
    scanline.time = timeMs * 0.001 * rate * 0.2;
  }, (timeMs) => ({ alpha: frame(timeMs).alpha }));
};

export const digitalFlicker = defineEffect(_digitalFlicker, {
  type: "filter",
  track: "behavior",
  targetType: "char",
  mutexGroup: "filter_digital_flicker",
  category: "cyberpunk",
  parameters: digitalFlickerParameters,
});

const hologramParameters = {
  tint: { type: "color", default: "#66f7ff", description: "全息高光色" },
  shadow: { type: "color", default: "#03131f", description: "全息暗部色" },
  scan: { type: "number", default: 4, min: 0.25, max: 12, step: 0.25, description: "全息扫描线密度" },
  jitter: { type: "number", default: 2.5, min: 0, max: 24, step: 0.5, description: "色彩通道抖动距离（px）" },
  glow: { type: "number", default: 1.2, min: 0, max: 6, step: 0.1, description: "全息 Bloom 强度" },
  radius: { type: "number", default: 5, min: 1, max: 24, step: 1, description: "全息 Bloom 半径（px）" },
  flicker: { type: "number", default: 0.16, min: 0, max: 0.8, step: 0.01, description: "全息透明度闪烁振幅" },
  speed: { type: "number", default: 1.6, min: 0, max: 12, step: 0.1, description: "扫描和抖动速度（Hz）" },
  float: { type: "number", default: 2, min: 0, max: 24, step: 0.5, description: "逐字垂直漂移距离（px）" },
} as const satisfies ParameterSchema;

const createHologram = (backgroundProfile: boolean): EffectFunction => (target, params = {}) => {
  const tint = readColor(params, hologramParameters, "tint");
  const shadow = readColor(params, hologramParameters, "shadow");
  const jitter = readNumber(params, hologramParameters, "jitter");
  const glow = readNumber(params, hologramParameters, "glow");
  const flicker = readNumber(params, hologramParameters, "flicker");
  const speed = readNumber(params, hologramParameters, "speed");
  const floatAmount = readNumber(params, hologramParameters, "float");

  const duotone = backgroundProfile ? new BackgroundDuotoneFilter() : new TextDuotoneFilter();
  duotone.shadow = hexToVec3(shadow);
  duotone.highlight = hexToVec3(tint);

  const scanline = new ScanlineFilter();
  scanline.density = readNumber(params, hologramParameters, "scan");
  scanline.flicker = flicker * 0.5;

  const rgb = new RGBSplitFilter();
  const bloom = new BloomFilter();
  bloom.radius = readNumber(params, hologramParameters, "radius");
  bloom.threshold = 0.25;

  const update = (timeMs: number) => {
    const wave = oscillator(timeMs, speed);
    scanline.time = timeMs * 0.001 * speed;
    rgb.offset = { x: wave * jitter, y: oscillator(timeMs, speed * 0.61, 1.2) * jitter * 0.2 };
    bloom.strength = glow * (0.82 + (wave + 1) * 0.09);
  };

  return mountBehaviorFilters(target, "hologram", [duotone, scanline, rgb, bloom], update, (timeMs) => ({
    alpha: Math.max(0, 1 - flicker * (oscillator(timeMs, speed * 3.7) + 1) * 0.5),
    y: oscillator(timeMs, speed * 0.35, 0.4) * floatAmount,
  }));
};

const _hologram = createHologram(false);
const _backgroundHologram = createHologram(true);
export const hologram = defineEffect(_hologram, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_hologram",
  category: "cyberpunk",
  parameters: hologramParameters,
}, { background: _backgroundHologram });

const chromaticAberrationParameters = {
  x: { type: "number", default: 6, min: -64, max: 64, step: 0.5, description: "水平色差距离（px）" },
  y: { type: "number", default: 0, min: -64, max: 64, step: 0.5, description: "垂直色差距离（px）" },
  pulse: { type: "number", default: 0.3, min: 0, max: 1, step: 0.01, description: "色差呼吸振幅" },
  speed: { type: "number", default: 1.2, min: 0, max: 12, step: 0.1, description: "色差呼吸速度（Hz）" },
} as const satisfies ParameterSchema;

const _chromaticAberration: EffectFunction = (target, params = {}) => {
  const x = readNumber(params, chromaticAberrationParameters, "x");
  const y = readNumber(params, chromaticAberrationParameters, "y");
  const pulse = readNumber(params, chromaticAberrationParameters, "pulse");
  const speed = readNumber(params, chromaticAberrationParameters, "speed");
  const rgb = new RGBSplitFilter();

  return mountBehaviorFilters(target, "chromaticAberration", [rgb], (timeMs) => {
    const scale = 1 + oscillator(timeMs, speed) * pulse;
    rgb.offset = { x: x * scale, y: y * scale };
  });
};

export const chromaticAberration = defineEffect(_chromaticAberration, {
  type: "filter",
  track: "behavior",
  targetType: "both",
  mutexGroup: "filter_rgb",
  category: "cyberpunk",
  parameters: chromaticAberrationParameters,
});
