// Effects 四轨分类表套件（支柱 2c / docs/planning/test-net-design-2026-07.md §3）。
//
// 遍历 effectManager.getRegisteredNames() + styleManager.getRegisteredNames()，断言每个 preset 的
// track / type / targetType / mutexGroup / stackable 对一张**提交的分类表**。
// 新增/改 preset 必须显式改表——逼出有意识变更，钉死 Phase B EffectMiddleware 要消费的分类。
//
// 这是"现状特征"表，不是"正确性裁判"（§1.4）：发现分类 bug 单独记录，不在本任务顺手改行为。
// 表来自 live registry dump（effectManager.getMetadata），非静态文件推断——是运行时真相。

import { describe, it, expect } from 'vitest';
import { effectManager } from '../core/effects/EffectManager';
import { styleManager } from '../core/effects/StyleManager';

// ─── 分类表（提交的真相；改分类须显式改此表） ──────────────────────────
//
// 字段对齐 EffectMetadata（effects/types.ts:14-20）：
//   track: "entrance" | "behavior" | "instant" | "timing"（四轨，§3 支柱 2c）
//   type: "behavior" | "style" | "filter" | "action" | "anim"
//   targetType: "char" | "group" | "both"
//   mutexGroup: string | null（timing 轨 go/slow/fast/hold 无 mutex → null）
//   stackable: boolean（缺省 false；此处显式写全，避免"缺省"歧义）

interface PresetClass {
  track: 'entrance' | 'behavior' | 'instant' | 'timing';
  type: 'behavior' | 'style' | 'filter' | 'action' | 'anim';
  targetType: 'char' | 'group' | 'both';
  mutexGroup: string | null;
  stackable: boolean;
}

const EFFECT_TABLE: Record<string, PresetClass> = {
  // entrance 轨（一次性入场 tween；mutexGroup=enter 表示同字互斥，action/position 为特例）
  fadeIn:    { track: 'entrance', type: 'anim',  targetType: 'char', mutexGroup: 'enter',    stackable: false },
  popIn:     { track: 'entrance', type: 'anim',  targetType: 'char', mutexGroup: 'enter',    stackable: false },
  pulseIn:   { track: 'entrance', type: 'anim',  targetType: 'char', mutexGroup: 'enter',    stackable: false },
  jumpIn:    { track: 'entrance', type: 'anim',  targetType: 'char', mutexGroup: 'enter',    stackable: false },
  blurIn:    { track: 'entrance', type: 'anim',  targetType: 'both', mutexGroup: 'enter',    stackable: false },
  punch:     { track: 'entrance', type: 'anim',  targetType: 'char', mutexGroup: 'action',   stackable: false },
  jump:      { track: 'entrance', type: 'anim',  targetType: 'char', mutexGroup: 'position', stackable: false },

  // behavior 轨（持续 ticker；可叠加）
  shake:     { track: 'behavior', type: 'behavior', targetType: 'both', mutexGroup: 'position', stackable: true },
  wave:      { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'position', stackable: true },
  float:     { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'position', stackable: true },
  pulse:     { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'scale',    stackable: true },
  jitter:    { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'position', stackable: true },
  rotate:    { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'rotation', stackable: true },
  swing:     { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'rotation', stackable: true },
  gravity:   { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'position', stackable: true },
  fadeShake: { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'position', stackable: false },
  flash:     { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'alpha',    stackable: true },
  rainbow:   { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'color',    stackable: false },
  glitch:    { track: 'behavior', type: 'behavior', targetType: 'char', mutexGroup: 'position', stackable: true },

  // filter 轨（instant = 无状态一次应用；behavior = 持续 animate 滤镜参数）
  rgbShift:  { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_rgb',       stackable: false },
  warp:      { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_warp',      stackable: false },
  blur:      { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_blur',      stackable: true },
  scanline:  { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_scanline',  stackable: false },
  noise:     { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_noise',     stackable: false },
  dissolve:  { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_dissolve',  stackable: false },
  displace:  { track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_displace',  stackable: false },
  underwater:{ track: 'behavior', type: 'filter', targetType: 'both', mutexGroup: 'filter_underwater',stackable: false },
  pixelate:  { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_pixelate',  stackable: true },
  gray:      { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_color',     stackable: true },
  threshold: { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_color',     stackable: true },
  duotone:   { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_color',     stackable: true },
  posterize: { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_color',     stackable: true },
  sharpen:   { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_conv',      stackable: true },
  emboss:    { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_conv',      stackable: true },
  edge:      { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_conv',      stackable: true },
  outline:   { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_outline',   stackable: true },
  bloom:     { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_bloom',     stackable: true },
  halftone:  { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_halftone',  stackable: true },
  vignette:  { track: 'instant',  type: 'filter', targetType: 'both', mutexGroup: 'filter_vignette',  stackable: true },

  // style 轨（instant = 无状态样式；behavior = 持续样式变化）
  border:    { track: 'instant',  type: 'style',  targetType: 'group', mutexGroup: 'border',          stackable: false },
  box:       { track: 'instant',  type: 'style',  targetType: 'group', mutexGroup: 'box',             stackable: false },
  dim:       { track: 'behavior', type: 'style',  targetType: 'both',  mutexGroup: 'alpha',           stackable: false },
  shift:     { track: 'behavior', type: 'style',  targetType: 'char',  mutexGroup: 'position_shift',  stackable: true },

  // timing 轨（go/slow/fast/hold 位置偏移；无 mutex）
  go:        { track: 'timing', type: 'action', targetType: 'both', mutexGroup: null, stackable: false },
  slow:      { track: 'timing', type: 'action', targetType: 'both', mutexGroup: null, stackable: false },
  fast:      { track: 'timing', type: 'action', targetType: 'both', mutexGroup: null, stackable: false },
  hold:      { track: 'timing', type: 'action', targetType: 'both', mutexGroup: null, stackable: false },
};

const STYLE_TABLE: Record<string, PresetClass> = {
  // 全部 style/instant/char；mutexGroup 区分 color/weight/fontFamily/fontStyle/size/sizeModifier/shadow/stroke
  red:     { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  blue:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  gray:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  green:   { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  yellow:  { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  purple:  { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  orange:  { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  cyan:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  pink:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'color',        stackable: false },
  bold:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'weight',       stackable: false },
  italic:  { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'fontStyle',    stackable: false },
  thin:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'weight',       stackable: false },
  serif:   { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'fontFamily',   stackable: false },
  special: { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'fontFamily',   stackable: false },
  size:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'size',         stackable: false },
  font:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'fontFamily',   stackable: false },
  sans:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'fontFamily',   stackable: false },
  mono:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'fontFamily',   stackable: false },
  big:     { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'sizeModifier', stackable: false },
  small:   { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'sizeModifier', stackable: false },
  glow:    { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'shadow',       stackable: false },
  stroke:  { track: 'instant', type: 'style', targetType: 'char', mutexGroup: 'stroke',       stackable: false },
};

// ─── 断言：registry 与表双向一致 ───────────────────────────────────────

describe('effects four-track classification table', () => {
  it('every registered effect matches the classification table', () => {
    const registered = effectManager.getRegisteredNames().sort();
    expect(registered.length).toBeGreaterThan(0);
    const unregistered = Object.keys(EFFECT_TABLE).filter((n) => !effectManager.has(n));
    const missingFromTable = registered.filter((n) => !EFFECT_TABLE[n]);
    // 双向：表里有但 registry 没注册 = 表 typo/过期条目；registry 有但表里没 = 新 preset 未登记。
    expect(unregistered, '表中有、registry 未注册（表过期或 typo）').toEqual([]);
    expect(missingFromTable, 'registry 已注册、表中缺失（新增 preset 须显式补表）').toEqual([]);

    for (const name of registered) {
      const meta = effectManager.getMetadata(name);
      const expected = EFFECT_TABLE[name];
      expect(meta, `metadata missing for ${name}`).toBeDefined();
      expect({ track: meta!.track, type: meta!.type, targetType: meta!.targetType,
        mutexGroup: meta!.mutexGroup ?? null, stackable: meta!.stackable ?? false })
        .toEqual(expected);
    }
  });

  it('every registered style matches the classification table', () => {
    const registered = styleManager.getRegisteredNames().sort();
    expect(registered.length).toBeGreaterThan(0);
    const unregistered = Object.keys(STYLE_TABLE).filter((n) => !styleManager.has(n));
    const missingFromTable = registered.filter((n) => !STYLE_TABLE[n]);
    expect(unregistered, '表中有、registry 未注册（表过期或 typo）').toEqual([]);
    expect(missingFromTable, 'registry 已注册、表中缺失（新增 style 须显式补表）').toEqual([]);

    for (const name of registered) {
      const meta = styleManager.getMetadata(name);
      const expected = STYLE_TABLE[name];
      expect(meta, `metadata missing for ${name}`).toBeDefined();
      expect({ track: meta!.track, type: meta!.type, targetType: meta!.targetType,
        mutexGroup: meta!.mutexGroup ?? null, stackable: meta!.stackable ?? false })
        .toEqual(expected);
    }
  });

  // ─── 四轨覆盖不变量（Phase B EffectMiddleware 要消费的分类） ──────────

  it('all four tracks are represented in the effect registry', () => {
    const tracks = new Set(effectManager.getRegisteredNames().map((n) => effectManager.getMetadata(n)?.track));
    expect(tracks.has('entrance')).toBe(true);
    expect(tracks.has('behavior')).toBe(true);
    expect(tracks.has('instant')).toBe(true);
    expect(tracks.has('timing')).toBe(true);
  });

  it('mutexGroup is non-null for non-timing effects and null for timing', () => {
    for (const [name, cls] of Object.entries(EFFECT_TABLE)) {
      if (cls.track === 'timing') {
        expect(cls.mutexGroup, `timing effect ${name} should have null mutexGroup`).toBeNull();
      } else {
        expect(cls.mutexGroup, `non-timing effect ${name} should have a mutexGroup`).not.toBeNull();
      }
    }
  });

  it('filter mutex groups are unique per filter family (no cross-family collisions)', () => {
    // 同一 mutexGroup 的滤镜应属同一视觉族（如 filter_color: gray/threshold/duotone/posterize）。
    // 这条不变量防"两个不相关滤镜误用同 mutex 导致互相踢"。
    const byMutex: Record<string, string[]> = {};
    for (const [name, cls] of Object.entries(EFFECT_TABLE)) {
      if (cls.type === 'filter' && cls.mutexGroup) {
        (byMutex[cls.mutexGroup] ??= []).push(name);
      }
    }
    // filter_color 有 4 个（gray/threshold/duotone/posterize）——互斥族，预期。
    expect(byMutex.filter_color?.sort()).toEqual(['duotone', 'gray', 'posterize', 'threshold']);
    expect(byMutex.filter_conv?.sort()).toEqual(['edge', 'emboss', 'sharpen']);
  });

  it('classification table is sorted-stable (no duplicate entries)', () => {
    const effNames = Object.keys(EFFECT_TABLE);
    const styleNames = Object.keys(STYLE_TABLE);
    expect(new Set(effNames).size).toBe(effNames.length);
    expect(new Set(styleNames).size).toBe(styleNames.length);
    // effect 与 style 名空间有意重叠 'gray'：effect gray = filter（灰度滤镜），
    // style gray = color（灰色字色）。命令路由经 commandCatalog.getFamily 按族消歧，非 bug。
    // 此处固定该重叠为已知现状，B0.1 若拆分名空间应显式更新此断言。
    const overlap = effNames.filter((n) => styleNames.includes(n));
    expect(overlap).toEqual(['gray']);
    // 重叠名的两者分类应不同（否则真撞了）。
    expect(EFFECT_TABLE.gray).not.toEqual(STYLE_TABLE.gray);
  });
});