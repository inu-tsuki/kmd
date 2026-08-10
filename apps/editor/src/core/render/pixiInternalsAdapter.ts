// Pixi 私有访问窄面适配器（主题二 S4b：处方 10 后半）。
//
// App.ts 原来散落 ~7 处 `this.pixiApp.renderer as any` 直读 pixi 内部
//（limits / renderPipes.batch / texture system / DefaultBatcher._updateMaxTextures）。
// 本模块把这些访问收口成逐个守卫的窄函数：
//
//   - 每个函数自检前置（内部面缺失 → 返回 skipped，永不崩）；
//   - preflightRenderer 汇总探测报告，stabilizeRendererForHost 按批准编排；
//   - warn once（模块级 Set）：未来 pixi 版本内部消失 → 一条诊断，优雅跳过依赖步骤。
//
// 诚实局限（harness 不掩盖生产行为）：pixi-internals-adapter.test.ts 用 fake renderer
// 只证守卫逻辑；真实 pixi 8.15 行为由 e2e 既有 spec 背书（它们跑真渲染器）。
//
// 内部面结构类型：pixi 8.15 未导出的形状，按实测表面窄化声明（探针见
// stabilizeRendererForHost 的历史行为）。升级 pixi 大版本时 preflight 先红。

import type { Application } from "pixi.js";
import { DefaultBatcher, Texture } from "pixi.js";

// ── pixi 内部面窄结构（未导出，按实测表面声明）─────────────────

interface PixiLimits {
  maxTextures?: number;
  maxBatchableTextures?: number;
}

interface PixiBatcher {
  maxTextures?: number;
  _updateMaxTextures?: (maxTextures: number) => void;
}

interface PixiBatchPipe {
  _activeBatches?: Record<string, PixiBatcher | undefined>;
  _batchersByInstructionSet?: Record<string, Record<string, PixiBatcher | undefined> | undefined>;
}

interface PixiTextureSystem {
  bind(texture: unknown, unit: number): void;
}

interface PixiRendererInternals {
  name?: string;
  limits?: PixiLimits;
  renderPipes?: { batch?: PixiBatchPipe };
  texture?: PixiTextureSystem;
  context?: { webGLVersion?: number };
  resize?: (width: number, height: number) => void;
}

export interface PreflightReport {
  /** renderer.limits 存在——capBatchableTextures 的前置。 */
  limits: boolean;
  /** renderer.renderPipes.batch 存在——syncBatcherTextureLimits 的前置。 */
  batchPipe: boolean;
  /** renderer.texture 存在——bindEmptyTextureUnits 的前置。 */
  textureSystem: boolean;
}

// warn once：同一内部面缺失只诊断一次（ticker 每帧调用会淹没控制台）。
const warnedMissingInternals = new Set<string>();

function warnMissingInternal(key: string, message: string) {
  if (warnedMissingInternals.has(key)) return;
  warnedMissingInternals.add(key);
  console.warn(`[PixiInternalsAdapter] ${message}`);
}

/** 测试/热重载用：清 warn-once 状态。 */
export function resetPreflightWarnings() {
  warnedMissingInternals.clear();
}

function asInternals(renderer: unknown): PixiRendererInternals | undefined {
  if (typeof renderer !== "object" || renderer === null) return undefined;
  // 库边界未类型面：pixi 8 未导出 renderer 内部结构，窄化为本地接口。
  return renderer as PixiRendererInternals;
}

// ── 逐个守卫函数 ──────────────────────────────────────────────

/**
 * 探测 renderer 内部面可用性（永不抛）。stabilizeRendererForHost 按报告编排：
 * 缺失的面 → 依赖步骤优雅跳过 + warn once。
 */
export function preflightRenderer(renderer: unknown): PreflightReport {
  const internals = asInternals(renderer);
  const report: PreflightReport = {
    limits: !!internals?.limits,
    batchPipe: !!internals?.renderPipes?.batch,
    textureSystem: !!internals?.texture,
  };
  if (internals && !report.limits) {
    warnMissingInternal("limits", "renderer.limits missing — batchable texture cap skipped.");
  }
  if (internals && !report.batchPipe) {
    warnMissingInternal("batchPipe", "renderer.renderPipes.batch missing — batcher sync skipped.");
  }
  if (internals && !report.textureSystem) {
    warnMissingInternal("textureSystem", "renderer.texture missing — empty texture unit bind skipped.");
  }
  return report;
}

export interface CapResult {
  capped: boolean;
  originalMaxBatchableTextures?: number;
  stableMaxBatchableTextures?: number;
  maxTextures?: number;
  rendererName?: string;
  webGLVersion?: number;
}

/**
 * Android WebView 兼容：把 limits.maxBatchableTextures 压到稳定上限。
 * 前置：preflight.limits。返回 null = skipped（内部面缺失）。
 */
export function capBatchableTextures(renderer: unknown, stableLimit: number): CapResult | null {
  const internals = asInternals(renderer);
  const limits = internals?.limits;
  if (!limits) return null;

  const original = limits.maxBatchableTextures;
  const stable = Math.min(original ?? stableLimit, stableLimit);
  if (original === stable) {
    return { capped: false, originalMaxBatchableTextures: original, stableMaxBatchableTextures: stable };
  }
  limits.maxBatchableTextures = stable;
  return {
    capped: true,
    originalMaxBatchableTextures: original,
    stableMaxBatchableTextures: stable,
    maxTextures: limits.maxTextures,
    rendererName: internals?.name,
    webGLVersion: internals?.context?.webGLVersion,
  };
}

/**
 * 预热 batch shader：构造一次性 DefaultBatcher 强制编译，避免首帧卡顿。
 * 永不抛（编译失败只记日志由调用方处理——本函数返回 boolean 供诊断）。
 */
export function primeBatchShader(maxTextures: number): boolean {
  try {
    const batcher = new DefaultBatcher({ maxTextures });
    // pixi 内部方法：按 maxTextures 重建纹理槽 uniform——8.15 实测存在。
    (batcher as unknown as PixiBatcher)._updateMaxTextures?.(maxTextures);
    batcher.destroy();
    return true;
  } catch {
    return false;
  }
}

/**
 * 同步既有 batcher 的纹理上限。前置：preflight.batchPipe。
 * 返回同步的 batcher 数（0 = skipped 或无 batcher）。
 */
export function syncBatcherTextureLimits(renderer: unknown, maxTextures: number): number {
  const batchPipe = asInternals(renderer)?.renderPipes?.batch;
  if (!batchPipe) return 0;

  let synced = 0;
  const visit = (batcher: PixiBatcher | undefined) => {
    if (!batcher) return;
    batcher.maxTextures = maxTextures;
    batcher._updateMaxTextures?.(maxTextures);
    synced += 1;
  };
  Object.values(batchPipe._activeBatches ?? {}).forEach(visit);
  Object.values(batchPipe._batchersByInstructionSet ?? {}).forEach((batchersByName) => {
    Object.values(batchersByName ?? {}).forEach(visit);
  });
  return synced;
}

/**
 * 绑定 EMPTY 纹理到全部纹理单元（Android 驱动首帧采样未绑定单元的兜底）。
 * 前置：preflight.textureSystem。返回绑定的单元数（0 = skipped）。
 */
export function bindEmptyTextureUnits(renderer: unknown): number {
  const internals = asInternals(renderer);
  const textureSystem = internals?.texture;
  const maxTextureUnits = Number(internals?.limits?.maxTextures ?? 0);
  if (!textureSystem || !Number.isFinite(maxTextureUnits) || maxTextureUnits <= 0) return 0;

  const safeTextureUnits = Math.min(maxTextureUnits, 32);
  for (let unit = 0; unit < safeTextureUnits; unit += 1) {
    textureSystem.bind(Texture.EMPTY, unit);
  }
  return safeTextureUnits;
}

/**
 * 应用尺寸变更：优先 app.resize()（resizeTo 自动模式），否则按显式尺寸
 * renderer.resize(w, h)。返回 applied/skipped。
 *
 * resolveFallbackSize 仅在 app.resize 不存在时调用（惰性——resizeTo 模式
 * 下不触碰 DOM 测量）。
 */
export function resizeApp(
  app: Application,
  resolveFallbackSize?: () => { width: number; height: number } | null,
): boolean {
  // 守卫顺序与原 App.resizeToHost 一致：renderer 缺失先 return——
  // pre-init 时 Application.resize 会因 renderer 未就绪而崩，不可先试 app.resize。
  const internals = asInternals(app.renderer);
  if (!internals) return false;
  const appMaybeResize = app as Application & { resize?: (width?: number, height?: number) => void };
  if (typeof appMaybeResize.resize === "function") {
    appMaybeResize.resize();
    return true;
  }
  const size = resolveFallbackSize?.();
  if (typeof internals.resize === "function" && size) {
    internals.resize(size.width, size.height);
    return true;
  }
  return false;
}

/**
 * 手动渲染一帧：优先 app.render()，否则 renderer.render(stage)。
 * 返回 applied/skipped。
 */
export function renderApp(app: Application): boolean {
  const appMaybeRender = app as Application & { render?: () => void };
  if (typeof appMaybeRender.render === "function") {
    appMaybeRender.render();
    return true;
  }
  const renderer = asInternals(app.renderer) as (PixiRendererInternals & { render?: (stage: unknown) => void }) | undefined;
  if (typeof renderer?.render === "function") {
    renderer.render(app.stage);
    return true;
  }
  return false;
}
