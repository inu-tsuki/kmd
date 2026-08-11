import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ParserGoldenCorpusEntry {
  name: string;
  path: string;
}

// 叙事/展示作品由 playback 与真实 Chromium E2E 覆盖，不把体量巨大的完整 AST
// 固化为 parser 特征快照。这里显式列名，避免用宽泛命名规则误排真正的语法 fixture。
export const PARSER_GOLDEN_EXCLUDED_TEST_FILES = new Set([
  'cyber-crt-blacksite.kmd',
  'cyber-hologram-transmission.kmd',
  'cyber-neon-breach.kmd',
  'fx-cyberpunk-presets.kmd',
]);

/** 收集 parser 特征语料：tests/*.kmd（排除展示作品）+ 顶层 *.kmd。 */
export function collectParserGoldenCorpus(publicDir: string): ParserGoldenCorpusEntry[] {
  const out: ParserGoldenCorpusEntry[] = [];
  const testsDir = join(publicDir, 'tests');

  for (const name of readdirSync(testsDir).sort()) {
    if (name.endsWith('.kmd') && !PARSER_GOLDEN_EXCLUDED_TEST_FILES.has(name)) {
      out.push({ name: `tests/${name}`, path: join(testsDir, name) });
    }
  }

  for (const name of readdirSync(publicDir).sort()) {
    if (!name.endsWith('.kmd')) continue;
    if (existsSync(join(publicDir, name))) {
      out.push({ name: `top/${name}`, path: join(publicDir, name) });
    }
  }

  return out;
}
