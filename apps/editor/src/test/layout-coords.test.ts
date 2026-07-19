// 布局坐标稳定性快照套件（支柱 2b / docs/planning/test-net-design-2026-07.md §3）。
//
// 用 setup.ts 的确定性合成度量（width = 字符数 × fontSize × 0.5），解析语料 → 跑 layout
// → 快照每字符 x/y/inFlow/stepDistance/displayOffsetX/displayOffsetY/text。测布局数学：
// 垂直堆叠 / align / 断行 / goto-flow-up-down 偏移 / marker 同步。
//
// 与 playback 共用 setup.ts 同一度量 stub（§3 支柱 1：单一真相源），避免 shim 漂移。
// §1.4 诚实盲区：合成度量测的是**布局逻辑**非真实渲染几何——真实渲染靠 Playwright e2e。
//
// 黄金更新必须人工审（同 parser golden）：不用 vitest toMatchFileSnapshot（--update 会自动重写），
// 改显式读文件 + toEqual，vitest --update 不触碰布局黄金。

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TextStyle } from 'pixi.js';
import { parser } from '../core/parser/Parser';
import { LayoutPlanner } from '../core/layout/LayoutPlanner';
import { TextLayoutEngine } from '../core/layout/TextLayoutEngine';
import { normalize } from './golden-serializer';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const GOLDEN_DIR = join(import.meta.dirname, '__golden__', 'layout');
const FIXTURE = join(PUBLIC_DIR, 'tests', 'layout-coords.kmd');

// 固定 layout options（合成度量模型下，坐标完全确定）。
// maxWidth=200 触发断行；lineHeight=30 让行间距可辨；fontSize=24 → 字符宽 12。
const BASE_STYLE = new TextStyle({ fontSize: 24, fontFamily: 'sans-serif' });
const LAYOUT_OPTIONS = {
  maxWidth: 200,
  lineHeight: 30,
  fontSize: 24,
  indent: 0,
  align: 'left' as const,
  letterSpacing: 0,
  externalMarkers: new Map<string, { x: number; y: number }>(),
  baseOffset: { x: 0, y: 0 },
};

interface GlyphCoord {
  text: string;
  x: number;
  y: number;
  inFlow: boolean;
  stepDistance?: number;
  displayOffsetX?: number;
  displayOffsetY?: number;
}

/** 解析 fixture → 逐段 plan + calculate → 每段输出 glyph 坐标数组。 */
function computeLayoutSnapshot(): GlyphCoord[][] {
  const source = readFileSync(FIXTURE, 'utf-8');
  const result = parser.parse(source);
  const snapshots: GlyphCoord[][] = [];
  for (const para of result.paragraphs) {
    if (!para.ir) continue;
    const plan = LayoutPlanner.plan(para.ir, BASE_STYLE);
    const opts = { ...LAYOUT_OPTIONS, align: (para.blockOptions.align || 'left') as 'left' | 'center' | 'right' };
    const results = TextLayoutEngine.calculate(plan.stream, opts);
    // results[i] ↔ allGlyphPlans[i]（LayoutPlanner 保证非命令项一对一；命令项不进 results）。
    const coords: GlyphCoord[] = [];
    let gi = 0;
    for (const r of results) {
      const g = plan.allGlyphPlans[gi];
      gi += 1;
      coords.push({
        text: g?.text ?? '',
        x: r.x,
        y: r.y,
        inFlow: r.inFlow,
        stepDistance: r.stepDistance,
        displayOffsetX: r.displayOffsetX,
        displayOffsetY: r.displayOffsetY,
      });
    }
    snapshots.push(coords);
  }
  return snapshots;
}

/** 序列化（复用 parser golden 的 normalize 保证键序稳定）。 */
function serializeLayoutSnapshot(snapshots: GlyphCoord[][]): string {
  return JSON.stringify(normalize(snapshots), null, 2) + '\n';
}

describe('layout coordinate stability', () => {
  it('layout-coords.kmd snapshot matches committed golden', () => {
    const goldenPath = join(GOLDEN_DIR, 'layout-coords.kmd.json');
    const actual = serializeLayoutSnapshot(computeLayoutSnapshot());
    if (!existsSync(goldenPath)) {
      expect.fail(
        `布局黄金缺失: ${goldenPath}\n` +
          `运行: pnpm --filter @kmd/editor test:golden:write\n` +
          `（生成后 git diff 审阅，勿无脑提交。）`,
      );
    }
    const expected = readFileSync(goldenPath, 'utf-8');
    expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
  });

  // ─── 显式断言把布局数学"测的是什么"显式化（不只靠快照） ──────────────
  // 这些断言固定**布局逻辑的不变量**，B0.1/B1 改布局时这些会红——正是安全网目的。
  //
  // 段落索引（layout-coords.kmd 解析后，注释行/空行分隔符被 parser 剔除）：
  //   [0] "第一段第一行"  [1] "第二段第一行"  [2] "[align=center] 居中文本"
  //   [3] "[align=right] 右对齐文本"  [4] "长长长..."  [5] "上方 / 下方" (up/down)
  //   [6] "左移 / 右移" (left/right)  [7] "跳跃" (goto)  [8] "锚点 / 跳到锚点" (mark/goto)

  it('line wrapping: long line (idx 4) produces multiple distinct y rows', () => {
    const snap = computeLayoutSnapshot();
    const longPara = snap[4];
    expect(longPara).toBeDefined();
    const ys = new Set(longPara!.map((c) => c.y));
    // maxWidth=200, char width 12 → ~16 chars/line；fixture 行有 34 个字符 → 应 ≥2 行。
    // 多行的 y 递增即"段内垂直堆叠"——TextLayoutEngine 无状态，段间堆叠在有状态 LayoutEngine 层（耦合 Pixi，本套件不测）。
    expect(ys.size).toBeGreaterThanOrEqual(2);
    const sortedYs = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sortedYs.length; i++) {
      expect(sortedYs[i]).toBeGreaterThan(sortedYs[i - 1]);
    }
  });

  it('up/down layout instructions (idx 5) produce displayOffsetY', () => {
    const snap = computeLayoutSnapshot();
    const upDown = snap[5];
    expect(upDown).toBeDefined();
    expect(upDown!.some((c) => c.displayOffsetY === -20)).toBe(true);
    expect(upDown!.some((c) => c.displayOffsetY === 15)).toBe(true);
  });

  it('left/right layout instructions (idx 6) produce displayOffsetX', () => {
    const snap = computeLayoutSnapshot();
    const leftRight = snap[6];
    expect(leftRight).toBeDefined();
    expect(leftRight!.some((c) => c.displayOffsetX === -10)).toBe(true);
    expect(leftRight!.some((c) => c.displayOffsetX === 10)).toBe(true);
  });

  it('align=center (idx 2): x0 is shifted right vs left-aligned x0', () => {
    const snap = computeLayoutSnapshot();
    const centered = snap[2];
    expect(centered).toBeDefined();
    // 左对齐首字符 x0 = 6 = width/2；居中应把整行右移（maxWidth=200，文本宽 4×12=48 → 偏移 (200-48)/2=76 → x0=76+6=82）。
    expect(centered![0]!.x).toBeGreaterThan(6);
  });

  it('align=right (idx 3): x0 is shifted further right than align=center', () => {
    const snap = computeLayoutSnapshot();
    const right = snap[3];
    const centered = snap[2];
    expect(right![0]!.x).toBeGreaterThan(centered![0]!.x);
  });

  it('goto (idx 7): cursor jumps to specified coordinates', () => {
    const snap = computeLayoutSnapshot();
    const jumped = snap[7];
    expect(jumped).toBeDefined();
    // f.goto(100,200) → 首字符 x/y 应反映跳转后的坐标（非默认 0,0 起点）。
    expect(jumped![0]!.x).toBeGreaterThan(100);
    expect(jumped![0]!.y).toBeGreaterThan(200);
  });

  it('snapshot is deterministic across repeated computations', () => {
    const a = serializeLayoutSnapshot(computeLayoutSnapshot());
    const b = serializeLayoutSnapshot(computeLayoutSnapshot());
    expect(a).toBe(b);
  });
});