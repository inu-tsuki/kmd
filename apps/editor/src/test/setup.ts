// Vitest 共享 headless 环境（架构体检处方 5 / 测试网支柱 1）。
//
// 这是 final-playback-test.ts 第 18–98 行的 gsap 互操作 / document stub / DOMAdapter 合成度量
// shim 的**单一真相源**。所有需要真实 pixi/gsap/layout 管线的套件（playback、layout 坐标、
// effects 分类若需构造）共享同一确定性度量模型，避免 shim 漂移导致两套测试基准不一致。
//
// 设计文档 §1.4 诚实的盲区：合成字体度量（width = 字符数 × fontSize × 0.5）意味着布局测试
// 测的是**布局逻辑**，非真实渲染几何——真实渲染靠 Playwright e2e 补。
//
// 以下注释保留 final-playback-test.ts 原文（含 §B-bis 引用），因它们编码了已验证的运行时行为
//（AGENTS.md：verify-then-write —— 代码注释断言运行时行为须探针验证，非推断）。

import gsap from 'gsap';
import { DOMAdapter } from 'pixi.js';

// tsx 的 CJS/ESM 互操作把 gsap 当命名空间导入，默认导出落在 .default；
// vite（生产）的标准 ESM 解析则直接给默认导出。两者统一到此，让测试/生产同源。
// （§B-bis：已验证 tsx 运行时行为——gsap.default.timeline 是 function，gsap.timeline 是 undefined）
export const G = ((gsap as any).default ?? gsap) as typeof gsap;

// R15（SA-30 / SA-27 教训）：为测 DisplayAssembler baseline 路径需构造真实 KineticChar，但其构造
// 函数调 `gsap.ticker.add(this.update)`——tsx 下 gsap 命名空间的 .ticker 是 undefined（§B-bis 互操作
// quirk），会抛 `Cannot read properties of undefined (reading 'add')`。此处给 gsap 命名空间对象
// 注入 ticker stub（add/remove no-op），仅让 KineticChar 构造通过；timeline 走 G.timeline() 不经
// ticker，不受影响。
if (!(gsap as any).ticker) {
  (gsap as any).ticker = { add: () => {}, remove: () => {} };
}
// R17/SA-32（§13 端到端管线）：SegmentBuilder/PlaybackController 等生产代码直接调 `gsap.timeline()`
// / `gsap.core`（不经本文件的 G 别名）。tsx 互操作下 gsap 命名空间这些是 undefined（落在 .default）。
// 把 G（= gsap.default）的属性提升到 gsap 命名空间，让生产代码的 `gsap.timeline()` 可用。这是 §13
// 端到端真实管线的必要补丁（§1-§12 用 G.timeline() 别名绕过，但真实 SegmentBuilder 不绕过）。
if ((gsap as any).timeline !== G.timeline) {
  for (const k of Object.keys(G)) {
    try { if (!(k in (gsap as any))) (gsap as any)[k] = (G as any)[k]; } catch { /* readonly prop */ }
  }
}

// R17/SA-32（§13 端到端管线）：为驱动真实 `parser → SegmentBuilder.build → layout → seek`，需额外
// 两个 headless shim（已验证可跑端到端，见 R17 调研探针）：
// (1) document stub：KineticText.ts:82 读 `document.fonts`，node 下未定义会 ReferenceError。
//     注意：**不要** stub `window`——LayoutPlanner.isDiagnosticsEnabled 检查 `typeof window`，
//     window 未定义时早返回 false（line 348）；若 stub 了 window 会落到 `window.location.search` 崩溃。
// (2) DOMAdapter canvas stub：layout 路径调 `CanvasTextMetrics.measureFont`（LayoutPlanner:97
//     measureFontSafe），pixi v8 的 `_canvas` getter 先试 `OffscreenCanvas`（node 下 undefined）→
//     fallback `DOMAdapter.get().createCanvas()` → 默认 BrowserAdapter 用 document.createElement
//     （node 下崩）。注入合成 canvas（getContext 返回带 measureText 的 2d ctx）让字体度量通过。
//     度量是合成的（width=charCount*fontSize*0.5），几何不真实但 style/baseline/timing/seek 语义
//     真实——§13 测的是 R-B 单一真相源 + R13-R16 在真实管线的端到端正确性，不是布局几何。
//     pixi 升级若改 measureFont 路径，此 shim 可能需更新（失效时 §13 报错 ≠ R-B 逻辑错，先查 shim）。
if (!(globalThis as any).document) {
  (globalThis as any).document = {
    fonts: { ready: Promise.resolve() },
    createElement: () => ({}) as any,
  };
}
const _ctxProto = { prototype: { letterSpacing: undefined, textLetterSpacing: undefined } };
const _makeCtx = () => ({
  font: '',
  measureText(t: string) {
    const sz = parseFloat((this.font || '24px').match(/(\d+)px/)?.[1] || '24');
    // actualBoundingBoxLeft/Right 必须提供：pixi CanvasTextMetrics._measureText 计算
    //   boundsWidth = actualBoundingBoxRight - actualBoundingBoxLeft
    //   lineWidth = Math.max(metricWidth, boundsWidth)
    // 缺这两个字段 → undefined - undefined = NaN → Math.max(width, NaN) = NaN
    //   → measureChars 返回 width:NaN，layout 坐标全 NaN。
    // 合成模型：左边界 0，右边界 = width（等宽假设），与 width = chars × sz × 0.5 一致。
    const width = (t || '').length * sz * 0.5;
    return {
      actualBoundingBoxAscent: sz * 0.8,
      actualBoundingBoxDescent: sz * 0.2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      width,
    };
  },
});
DOMAdapter.set({
  createCanvas: () => ({ width: 0, height: 0, getContext: () => _makeCtx(), style: {} }) as any,
  getCanvasRenderingContext2D: () => _ctxProto as any,
  createImage: () => ({}) as any,
  getBaseUrl: () => 'file:///',
  getFontFaceSet: () => undefined,
} as any);

// ─── 合成度量模型的公开句柄（供 layout 坐标套件引用同一模型，勿在各套件重新声明） ───
//
// 度量契约（§1.4 诚实盲区：这是布局逻辑测试，非真实渲染几何）：
//   width(text)            = text.length × fontSize × 0.5
//   actualBoundingBoxAscent = fontSize × 0.8
//   actualBoundingBoxDescent = fontSize × 0.2
//   baseline y              = 由 TextLayoutEngine 按 ascent/descent + lineHeight 推导
// 任何套件需要"给定度量模型即确定"的坐标断言时，import 此常量声明以表达同源。
export const SYNTHETIC_METRICS = {
  widthFactor: 0.5,
  ascentFactor: 0.8,
  descentFactor: 0.2,
} as const;

// ─── approxEq（playback 套件渐拆时复用，避免各 testXxx 重定义） ──────────────
export function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}