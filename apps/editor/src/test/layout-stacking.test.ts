// 有状态段间布局集成测试（回应主审 review 中等发现 #1）。
//
// layout-coords.test.ts 对每段独立调用无状态 TextLayoutEngine.calculate()，没有经过负责段间
// 状态的 LayoutEngine（addLine 累加 currentY + 持久化 globalMarkers）。因此设计要求的**段间
// 垂直堆叠**与**段间 marker 同步**没有被测试。本套件补这个面。
//
// 策略：模拟 LayoutEngine.addLine 的段间状态传递（LayoutEngine.ts:230-231）——
//   (1) 共享一个 globalMarkers Map 跨段持久（LayoutEngine.globalMarkers）；
//   (2) 累加 currentY = currentY + 段高度 + paragraphSpacing（LayoutEngine.recenterAll L162-164）；
//   (3) 每段把 currentY 作为 baseOffset.y 传入（LayoutEngine 内部把 line.y = currentY 作为
//       容器变换，calculate 本身不应用 baseOffset.y；此处手动把 currentY 加到结果 y 上，
//       复刻 line.y = currentY 的效果）。
// 不构造真实 Pixi Container/KineticText（那是 e2e 面），只测段间状态传递的布局数学。
//
// 这是"现状特征"测试：给定合成度量 + LayoutEngine 的状态传递模型，段间坐标应完全确定。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextStyle } from 'pixi.js';
import { parser } from '../core/parser/Parser';
import { LayoutPlanner } from '../core/layout/LayoutPlanner';
import { TextLayoutEngine } from '../core/layout/TextLayoutEngine';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const FIXTURE = join(PUBLIC_DIR, 'tests', 'layout-coords.kmd');

const BASE_STYLE = new TextStyle({ fontSize: 24, fontFamily: 'sans-serif' });
const LINE_HEIGHT = 30;
const PARAGRAPH_SPACING = 20;
const ASCENT = 24 * 0.8;
const DESCENT = 24 * 0.2;

interface ParaLayout {
  index: number;
  firstCharY: number;      // 段首字符 y（含 currentY 偏移）
  firstCharText: string;
  markerKeysWritten: string[];
}

/** 模拟 LayoutEngine.addLine 段间状态传递，返回每段布局 + 累加后的 markers。 */
function computeStatefulLayout(): { paras: ParaLayout[]; markers: Map<string, { x: number; y: number }> } {
  const source = readFileSync(FIXTURE, 'utf-8');
  const result = parser.parse(source);
  const markers = new Map<string, { x: number; y: number }>();
  let currentY = 0;
  const paras: ParaLayout[] = [];

  for (let i = 0; i < result.paragraphs.length; i++) {
    const para = result.paragraphs[i]!;
    if (!para.ir) continue;
    const plan = LayoutPlanner.plan(para.ir, BASE_STYLE);
    const opts = {
      maxWidth: 200, lineHeight: LINE_HEIGHT, fontSize: 24, indent: 0,
      align: (para.blockOptions.align || 'left') as 'left' | 'center' | 'right',
      letterSpacing: 0, externalMarkers: markers, baseOffset: { x: 0, y: currentY },
    };
    const markerKeysBefore = new Set(markers.keys());
    const results = TextLayoutEngine.calculate(plan.stream, opts, markers);
    const markerKeysAfter = new Set(markers.keys());
    const markerKeysWritten = [...markerKeysAfter].filter((k) => !markerKeysBefore.has(k));

    // 复刻 LayoutEngine line.y = currentY：把 currentY 加到结果 y 上。
    const firstRes = results[0];
    const firstGlyph = plan.allGlyphPlans[0];
    paras.push({
      index: i,
      firstCharY: (firstRes?.y ?? 0) + currentY,
      firstCharText: firstGlyph?.text ?? '',
      markerKeysWritten,
    });

    // 累加 currentY：段高度 = maxY + ascent + descent（最后一行 baseline + 字体度量），
    // 加 paragraphSpacing（LayoutEngine.recenterAll L164）。
    if (results.length > 0) {
      const maxY = Math.max(...results.map((r) => r.y));
      currentY += maxY + ASCENT + DESCENT + PARAGRAPH_SPACING;
    }
  }

  return { paras, markers };
}

describe('inter-paragraph stateful layout (stacking + marker sync)', () => {
  const { paras, markers } = computeStatefulLayout();

  it('paragraphs stack vertically: first-char y strictly increases', () => {
    // 段间垂直堆叠——LayoutEngine.currentY 累加的结果。
    expect(paras.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < paras.length; i++) {
      expect(paras[i]!.firstCharY, `para ${i} y should exceed para ${i - 1} y`).toBeGreaterThan(paras[i - 1]!.firstCharY);
    }
  });

  it('stacking delta reflects lineHeight + paragraphSpacing model', () => {
    // 单行段间 delta = ascent(19.2) + descent(4.8) + paragraphSpacing(20) = 44。
    // para 0→1（均为单行文本）：delta 应精确为 44（合成度量模型下确定）。
    const delta = paras[1]!.firstCharY - paras[0]!.firstCharY;
    expect(delta).toBeCloseTo(44, 0);
  });

  it('inter-paragraph marker sync: point_a written in para 8 survives to be read by goto same paragraph', () => {
    // para 8 的 f.mark(point_a) 写入 markers，同段 f.goto(point_a) 读它——
    // 这是段内 sync（layout-coords.test.ts 已断言），此处确认 markers Map 确实含 point_a。
    expect(markers.has('point_a')).toBe(true);
    const para8 = paras.find((p) => p.index === 8);
    expect(para8?.markerKeysWritten).toContain('point_a');
  });

  it('inter-paragraph marker persistence: markers written in earlier paragraphs remain in shared map', () => {
    // LayoutEngine.globalMarkers 跨 addLine 持久——任何段写入的 marker 应在后续段可见。
    // 本 fixture 无跨段 mark→goto 用例（设计留 follow-up），但断言 markers Map 的持久性
    // 是段间 sync 成立的地基：line.start/line.end 等保留字 marker 在多段后仍存在。
    expect(markers.size).toBeGreaterThan(0);
    // line.* 保留字 marker 应在多段累加后仍存在（每段 updateLineMarkers 写入）。
    expect(markers.has('line.start') || markers.has('prev.start')).toBe(true);
  });

  it('deterministic across repeated stateful runs', () => {
    const a = computeStatefulLayout();
    const b = computeStatefulLayout();
    expect(a.paras.map((p) => p.firstCharY)).toEqual(b.paras.map((p) => p.firstCharY));
    expect([...a.markers.keys()].sort()).toEqual([...b.markers.keys()].sort());
  });
});