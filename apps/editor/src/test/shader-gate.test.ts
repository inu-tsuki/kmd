// Shader 编译门禁套件（支柱 3 / 收编 final-shader-test.ts）。
//
// 从每个 *Filter.ts 提取 /* glsl */ `...` fragment shader，用 glslangValidator 编译验证
// GLSL ES 3.00 语法。捕获 vue-tsc 无法触及的 GLSL 语法/作用域错（如函数嵌套定义、未声明
// uniform、类型不匹配），防止"pnpm build 绿灯但 shader 不编译"。
//
// 收编自 final-shader-test.ts，**去除 SKIP_SHADER_GATE 逃生门**（§3 支柱 4：CI 装 glslang 后
// shader 门禁必跑，无 opt-out）。若 glslangValidator 缺失，本套件直接 fail（不假绿）。
//
// 运行：pnpm --filter @kmd/editor test（vitest） 或 pnpm test:shaders（旧 tsx 脚本，迁移期并存）。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const FILTERS_DIR = join(import.meta.dirname, '..', 'core', 'filters');

function collectFilterFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return collectFilterFiles(p);
    return entry.name.endsWith('Filter.ts') ? [p] : [];
  });
}

function glslangAvailable(): boolean {
  try {
    execSync('glslangValidator --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function extractShaders(source: string): { shader: string }[] {
  const out: { shader: string }[] = [];
  const re = /\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/g;
  for (const m of source.matchAll(re)) {
    const shader = m[1]!.trim();
    if (shader.startsWith('#version')) out.push({ shader });
  }
  return out;
}

const files = collectFilterFiles(FILTERS_DIR).sort();

describe('shader compile gate (glslangValidator)', () => {
  it('glslangValidator is available (no SKIP escape hatch)', () => {
    // §3 支柱 4：去 SKIP_SHADER_GATE 逃生门——glslang 缺失即 fail，不假绿。
    expect(glslangAvailable(), 'glslangValidator 未安装；brew install glslang / pacman -S glslang').toBe(true);
  });

  it('there is at least one *Filter.ts file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // 动态生成每文件每 shader 的用例——但 vitest 静态收集，故用 it.each。
  // 预先展开文件×shader 索引列表。
  const cases: { label: string; file: string; shader: string }[] = [];
  for (const file of files) {
    const display = relative(FILTERS_DIR, file);
    const source = readFileSync(file, 'utf-8');
    const shaders = extractShaders(source);
    shaders.forEach((s, idx) => {
      cases.push({ label: `${display} #${idx + 1}`, file: display, shader: s.shader });
    });
  }

  it.each(cases)('%s compiles', ({ label, shader }) => {
    const tmpName = label.replace(/[^a-zA-Z0-9_-]/g, '-');
    const tmpFile = `/tmp/kmd-shader-${tmpName}.frag`;
    mkdirSync('/tmp', { recursive: true });
    writeFileSync(tmpFile, shader);
    try {
      execSync(`glslangValidator "${tmpFile}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      expect(true).toBe(true);
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      expect.fail(`${label} GLSL 编译失败:\n${stderr.split('\n').slice(0, 10).join('\n')}`);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });
});