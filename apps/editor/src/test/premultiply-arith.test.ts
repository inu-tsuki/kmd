// 预乘 alpha 对偶——代数契约套件（主题一：织网 S4 / §B-bis 相关）。
//
// 约 15 个点运算滤镜（GrayFilter 模板：解预乘 → 运算 → 重新预乘，GrayFilter.ts:22-29）
// 共享同一段 GLSL 包络：
//
//     vec3 rgb   = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);   // 解预乘
//     <点运算 op>
//     finalColor = vec4(result * c.a, c.a);                  // 重新预乘
//
// 本套件把这段包络的**代数契约**钉在 TS 参考实现上：往返恒等、零钳位边界、
// op 的定义域是 straight-light rgb。这是滤镜家族共享的数学约定，与 GLSL 文本无关。
//
// ⚠️ 诚实边界（harness 不掩盖生产行为）：
//   - 本套件**证明**：包络代数自洽（α>ε 往返恒等 / α≤ε 钳零 / op 见到的是 straight rgb）。
//   - 本套件**不证明**：每个滤镜的 GLSL 真的实现了这段包络——GLSL 是逐滤镜复制变体，
//     编译正确性由 shader-gate.test.ts 钉，行为正确性由 e2e 钉。
//   - 本套件**尤其不证明**：Pixi v8 的 filter 输入纹理确为预乘格式——这正是 §B-bis
//     唯一未验证假设（lifecycle-invariants.md §B-bis 表 ⚠️ 行），由 S6 浏览器探针
//     （tests/e2e/premultiply-invariant.spec.ts）裁决。若 S6 证伪，本套件的代数仍然成立，
//     但滤镜家族的除法步骤将被判定为多余/错误并返工（S6b）。
//   - 因此本文件内不出现「已验证于 Pixi」字样——代数验证 ≠ 库边界验证。
//
// 共享此包络的滤镜家族（grep `c.rgb / c.a`，S4 勘探时点；新增滤镜若采用此惯例应更新此表）：
//   Gray, Threshold, Posterize, BackgroundDuotone, TextEmboss, BackgroundEmboss,
//   Noise, Scanline, Dissolve, Vignette, Halftone, Edge, Outline, Bloom, Sharpen
// （Pixelate/Warp/Displace/RGBSplit 明确不采用：纯 UV 量化或颜色透传，无逐像素 rgb 运算。）

import { describe, it, expect } from 'vitest';
import { approxEq } from './setup';

type Rgba = readonly [r: number, g: number, b: number, a: number];
type Rgb = readonly [r: number, g: number, b: number];

// 与 GLSL `c.a > 0.001` 严格对齐（严格大于；a === 0.001 落入钳零分支）。
const ALPHA_EPSILON = 0.001;

/** straight rgb + alpha → 预乘存储格式（渲染管线的编码侧约定）。 */
function premultiply([r, g, b]: Rgb, a: number): Rgba {
  return [r * a, g * a, b * a, a];
}

/** 包络第一步：解预乘还原 straight-light rgb（GrayFilter.ts:24 的 TS 镜像）。 */
function unpremultiply([r, g, b, a]: Rgba): Rgb {
  return a > ALPHA_EPSILON ? [r / a, g / a, b / a] : [0, 0, 0];
}

/** 包络第三步：重新预乘回存储格式（GrayFilter.ts:29 的 TS 镜像）。 */
function repremultiply([r, g, b]: Rgb, a: number): Rgba {
  return [r * a, g * a, b * a, a];
}

/** 完整包络（op = 恒等）：存储像素进去，存储像素出来。 */
function envelopeIdentity(pixel: Rgba): Rgba {
  return repremultiply(unpremultiply(pixel), pixel[3]);
}

const close = (actual: number, expected: number) =>
  expect(approxEq(actual, expected, 1e-9), `expected ${expected}, got ${actual}`).toBe(true);

const expectRgbaClose = (actual: Rgba, expected: Rgba) => {
  for (let i = 0; i < 4; i++) close(actual[i], expected[i]);
};

describe('premultiply envelope algebra — round-trip identity (α > ε)', () => {
  const cases: Array<{ label: string; straight: Rgb; alpha: number }> = [
    { label: 'opaque red', straight: [1, 0, 0], alpha: 1 },
    { label: 'half-alpha red', straight: [1, 0, 0], alpha: 0.5 },
    { label: 'quarter white', straight: [1, 1, 1], alpha: 0.25 },
    { label: 'arbitrary color @0.73', straight: [0.2, 0.6, 0.9], alpha: 0.73 },
    { label: 'near-ε alpha 0.002', straight: [0.5, 0.5, 0.5], alpha: 0.002 },
    { label: 'just above ε boundary 0.0011', straight: [0.8, 0.1, 0.3], alpha: 0.0011 },
  ];

  it.each(cases)('round-trips $label through the identity envelope', ({ straight, alpha }) => {
    const stored = premultiply(straight, alpha);
    expectRgbaClose(envelopeIdentity(stored), stored);
  });

  it('is its own inverse on arbitrary premultiplied pixels (storage domain, not just straight-encoded)', () => {
    // 存储域中合法预乘像素须满足 rgb ≤ a；任取几组验证包络在存储域上的恒等性。
    const storedPixels: Rgba[] = [
      [0.1, 0.2, 0.3, 0.4],
      [0.0, 0.0, 0.0, 0.9],
      [0.05, 0.05, 0.05, 0.05],
    ];
    for (const px of storedPixels) expectRgbaClose(envelopeIdentity(px), storedIdentity(px));
  });
});

// 辅助：存储域恒等参照（独立写法，避免与被测函数共享代码路径）。
function storedIdentity([r, g, b, a]: Rgba): Rgba {
  if (a <= ALPHA_EPSILON) return [0, 0, 0, a];
  return [(r / a) * a, (g / a) * a, (b / a) * a, a];
}

describe('premultiply envelope algebra — zero-clamp (α ≤ ε)', () => {
  it('clamps rgb to zero at and below ε, preserving alpha channel', () => {
    // 严格大于语义：a === 0.001 落入钳零分支（与 GLSL `c.a > 0.001` 一致）。
    expectRgbaClose(envelopeIdentity([0.0005, 0.0003, 0.0001, 0.001]), [0, 0, 0, 0.001]);
    expectRgbaClose(envelopeIdentity([0, 0, 0, 0]), [0, 0, 0, 0]);
    expectRgbaClose(envelopeIdentity([0.0002, 0.0001, 0, 0.0005]), [0, 0, 0, 0.0005]);
  });

  it('clamps even degenerate stored pixels (nonzero rgb with α ≤ ε) to zero rgb', () => {
    // 退化输入（正常管线不会产生，但包络必须稳健）：rgb 非零而 α ≤ ε。
    const rgb = unpremultiply([0.5, 0.5, 0.5, 0.0001]);
    expect(rgb).toEqual([0, 0, 0]);
  });

  it('never divides by zero or near-zero alpha (no NaN/Infinity anywhere in the envelope)', () => {
    for (const a of [0, 1e-9, 0.0005, 0.001]) {
      const out = envelopeIdentity([a * 0.5, a * 0.25, a, a]);
      for (const channel of out) {
        expect(Number.isFinite(channel), `channel ${channel} at α=${a} must be finite`).toBe(true);
      }
    }
  });
});

describe('premultiply envelope algebra — op domain is straight-light rgb', () => {
  // GrayFilter 的 op：luma = dot(rgb, BT.609)，mix(rgb, luma, uMix)。
  const BT609: Rgb = [0.299, 0.587, 0.114];
  const grayOp = ([r, g, b]: Rgb, mix: number): Rgb => {
    const luma = r * BT609[0] + g * BT609[1] + b * BT609[2];
    return [
      r + (luma - r) * mix,
      g + (luma - g) * mix,
      b + (luma - b) * mix,
    ];
  };
  const grayEnvelope = (pixel: Rgba, mix: number): Rgba =>
    repremultiply(grayOp(unpremultiply(pixel), mix), pixel[3]);

  it('gives the op straight-light rgb: half-alpha red reads as (1,0,0), not (0.5,0,0)', () => {
    const stored = premultiply([1, 0, 0], 0.5); // 存储 (0.5, 0, 0, 0.5)
    const seen = unpremultiply(stored);
    close(seen[0], 1);
    close(seen[1], 0);
    close(seen[2], 0);
  });

  it('full-gray of half-alpha red: luma computed on straight rgb, output re-premultiplied', () => {
    const stored = premultiply([1, 0, 0], 0.5);
    const out = grayEnvelope(stored, 1);
    // luma(1,0,0) = 0.299；重新预乘 → 各 rgb 通道 = 0.299 × 0.5 = 0.1495。
    expectRgbaClose(out, [0.1495, 0.1495, 0.1495, 0.5]);
  });
});

describe('premultiply envelope algebra — where the envelope is and is not load-bearing', () => {
  // 诚实的代数事实：gray 的 mix 插值对 rgb 是齐次线性的（r(1-mix) + luma·mix，无常数项），
  // 故 grayOp(α·x) = α·grayOp(x)——对 GrayFilter 自身，「解预乘→运算→重新预乘」与
  // 「直接在存储值上运算」代数等价，包络对 gray 是冗余的。包络真正分叉于非线性 op：
  // nonlinear(α·rgb) ≠ α·nonlinear(rgb)（threshold softstep / posterize 量化 / duotone 梯度映射）。
  // 这与 §B-bis 的怀疑方向一致（「该步骤可能多余」——对线性 op 确实多余，对非线性 op 承重）。
  const BT609: Rgb = [0.299, 0.587, 0.114];
  const grayOp = ([r, g, b]: Rgb, mix: number): Rgb => {
    const luma = r * BT609[0] + g * BT609[1] + b * BT609[2];
    return [
      r + (luma - r) * mix,
      g + (luma - g) * mix,
      b + (luma - b) * mix,
    ];
  };

  it('gray envelope ≡ gray applied directly on storage (linearity ⇒ envelope redundant for gray)', () => {
    const storeds: Array<{ pixel: Rgba; mix: number }> = [
      { pixel: premultiply([1, 0, 0], 0.5), mix: 1 },
      { pixel: premultiply([0.2, 0.6, 0.9], 0.73), mix: 0.5 },
      { pixel: premultiply([1, 1, 1], 0.25), mix: 0 },
      { pixel: premultiply([0.8, 0.1, 0.3], 0.0011), mix: 0.8 },
    ];
    for (const { pixel, mix } of storeds) {
      const viaEnvelope = repremultiply(grayOp(unpremultiply(pixel), mix), pixel[3]);
      const directOnStorage = grayOp([pixel[0], pixel[1], pixel[2]], mix);
      for (let i = 0; i < 3; i++) close(viaEnvelope[i], directOnStorage[i]);
    }
  });

  it('posterize-style quantization diverges: envelope ≠ direct-on-storage (nonlinearity ⇒ envelope load-bearing)', () => {
    // 4 级量化：quant(x) = floor(x·4 + 0.5) / 4。
    const quant = (x: number) => Math.floor(x * 4 + 0.5) / 4;
    const quantOp = ([r, g, b]: Rgb): Rgb => [quant(r), quant(g), quant(b)];

    // straight 0.8 @ α=0.5 → 存储 0.4。
    const stored = premultiply([0.8, 0, 0], 0.5);
    // 包络内：quant(straight 0.8) = floor(3.7)/4 = 0.75 → 重新预乘 = 0.375。
    const viaEnvelope = repremultiply(quantOp(unpremultiply(stored)), stored[3]);
    close(viaEnvelope[0], 0.375);
    // 直接在存储上：quant(0.4) = floor(2.1)/4 = 0.5 ——半透明被当成「更暗的色」量化到错误级别。
    const directOnStorage = quantOp([stored[0], stored[1], stored[2]]);
    close(directOnStorage[0], 0.5);
    expect(viaEnvelope[0]).not.toBe(directOnStorage[0]);
  });
});
