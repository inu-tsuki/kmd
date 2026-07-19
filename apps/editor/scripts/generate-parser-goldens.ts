// Parser 黄金文件生成脚本（支柱 2a / 测试网）。
//
// 用法：pnpm --filter @kmd/editor test:golden:write
//
// **黄金更新必须人工审阅**（docs/planning/test-net-design-2026-07.md §3 支柱 2a）：
// 本脚本会重写 src/test/__golden__/parser/*.json。运行后务必 `git diff` 审阅每一处变化，
// 确认 diff 仅来自预期的 parser 改动，勿无脑提交。vitest --update 不会触碰这些文件
//（它们是普通 .json，非 vitest snapshot），故无脑更新路径不存在。
//
// 本脚本与 parser-golden.test.ts 共用同一 serializeParseResult 与 fresh-KMDParser 策略，
// 保证生成与断言同源（单一真相源）。

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { KMDParser } from '../src/core/parser/Parser';
import { serializeParseResult } from '../src/test/golden-serializer';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const GOLDEN_DIR = join(ROOT, 'src', 'test', '__golden__', 'parser');

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

const corpus = collectCorpus();
let written = 0;
let unchanged = 0;

for (const { name, path } of corpus) {
  const source = readFileSync(path, 'utf-8');
  const result = new KMDParser().parse(source);
  const serialized = serializeParseResult(result);
  const goldenPath = join(GOLDEN_DIR, `${name}.json`);
  mkdirSync(dirname(goldenPath), { recursive: true });
  if (existsSync(goldenPath) && readFileSync(goldenPath, 'utf-8') === serialized) {
    unchanged += 1;
  } else {
    writeFileSync(goldenPath, serialized, 'utf-8');
    written += 1;
    console.log(`  ${written > 0 ? '✎' : '✎'} ${name}.json`);
  }
}

console.log(`\n[golden] ${corpus.length} corpus files → ${written} written, ${unchanged} unchanged`);
console.log('[golden] 审阅步骤: git diff src/test/__golden__/parser/ — 确认每处 diff 仅来自预期改动。');