// 黄金文件生成脚本（支柱 2a/2b / 测试网）。
//
// 用法：pnpm --filter @kmd/editor test:golden:write
//
// 生成 parser 黄金（__golden__/parser/）与 layout 黄金（__golden__/layout/）。
// **黄金更新必须人工审阅**（docs/planning/test-net-design-2026-07.md §3）：
// 运行后务必 `git diff` 审阅每一处变化，确认 diff 仅来自预期改动，勿无脑提交。
// vitest --update 不会触碰这些文件（普通 .json，非 vitest snapshot）。
//
// 与 parser-golden.test.ts / layout-coords.test.ts 共用同一序列化与计算逻辑（单一真相源）。

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { TextStyle } from 'pixi.js';
import { KMDParser } from '../src/core/parser/Parser';
import { parser } from '../src/core/parser/Parser';
import { LayoutPlanner } from '../src/core/layout/LayoutPlanner';
import { TextLayoutEngine } from '../src/core/layout/TextLayoutEngine';
import { serializeParseResult } from '../src/test/golden-serializer';
import { normalize } from '../src/test/golden-serializer';
import '../src/test/setup'; // 引入 headless shim（DOMAdapter 合成度量），与 layout 测试同源。

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const PARSER_GOLDEN = join(ROOT, 'src', 'test', '__golden__', 'parser');
const LAYOUT_GOLDEN = join(ROOT, 'src', 'test', '__golden__', 'layout');

// ─── parser goldens ─────────────────────────────────────────────────
function collectCorpus(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const testsDir = join(PUBLIC_DIR, 'tests');
  for (const name of readdirSync(testsDir).sort()) {
    if (name.endsWith('.kmd')) out.push({ name: `tests/${name}`, path: join(testsDir, name) });
  }
  for (const name of readdirSync(PUBLIC_DIR).sort()) {
    if (!name.endsWith('.kmd')) continue;
    if (name === 'final-test copy.kmd') continue;
    if (existsSync(join(PUBLIC_DIR, name))) out.push({ name: `top/${name}`, path: join(PUBLIC_DIR, name) });
  }
  return out;
}

function writeIfChanged(path: string, content: string): 'written' | 'unchanged' {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, 'utf-8') === content) return 'unchanged';
  writeFileSync(path, content, 'utf-8');
  return 'written';
}

let parserWritten = 0;
let parserUnchanged = 0;
for (const { name, path } of collectCorpus()) {
  const source = readFileSync(path, 'utf-8');
  const result = new KMDParser().parse(source);
  const serialized = serializeParseResult(result);
  const status = writeIfChanged(join(PARSER_GOLDEN, `${name}.json`), serialized);
  if (status === 'written') { parserWritten += 1; console.log(`  ✎ parser/${name}.json`); }
  else parserUnchanged += 1;
}

// ─── layout goldens ─────────────────────────────────────────────────
const BASE_STYLE = new TextStyle({ fontSize: 24, fontFamily: 'sans-serif' });
const LAYOUT_OPTIONS = {
  maxWidth: 200, lineHeight: 30, fontSize: 24, indent: 0, align: 'left' as const,
  letterSpacing: 0, externalMarkers: new Map<string, { x: number; y: number }>(),
  baseOffset: { x: 0, y: 0 },
};

function computeLayoutSnapshot(fixturePath: string): unknown[] {
  const source = readFileSync(fixturePath, 'utf-8');
  const result = parser.parse(source);
  const snapshots: unknown[] = [];
  for (const para of result.paragraphs) {
    if (!para.ir) continue;
    const plan = LayoutPlanner.plan(para.ir, BASE_STYLE);
    const opts = { ...LAYOUT_OPTIONS, align: (para.blockOptions.align || 'left') as 'left' | 'center' | 'right' };
    const results = TextLayoutEngine.calculate(plan.stream, opts);
    const coords: unknown[] = [];
    let gi = 0;
    for (const r of results) {
      const g = plan.allGlyphPlans[gi];
      gi += 1;
      coords.push({
        text: g?.text ?? '',
        x: r.x, y: r.y, inFlow: r.inFlow,
        stepDistance: r.stepDistance,
        displayOffsetX: r.displayOffsetX,
        displayOffsetY: r.displayOffsetY,
      });
    }
    snapshots.push(coords);
  }
  return snapshots;
}

let layoutWritten = 0;
let layoutUnchanged = 0;
const layoutFixture = join(PUBLIC_DIR, 'tests', 'layout-coords.kmd');
if (existsSync(layoutFixture)) {
  const snap = computeLayoutSnapshot(layoutFixture);
  const serialized = JSON.stringify(normalize(snap), null, 2) + '\n';
  const status = writeIfChanged(join(LAYOUT_GOLDEN, 'layout-coords.kmd.json'), serialized);
  if (status === 'written') { layoutWritten += 1; console.log(`  ✎ layout/layout-coords.kmd.json`); }
  else layoutUnchanged += 1;
}

console.log(`\n[golden] parser: ${parserWritten} written, ${parserUnchanged} unchanged`);
console.log(`[golden] layout: ${layoutWritten} written, ${layoutUnchanged} unchanged`);
console.log('[golden] 审阅步骤: git diff src/test/__golden__/ — 确认每处 diff 仅来自预期改动。');