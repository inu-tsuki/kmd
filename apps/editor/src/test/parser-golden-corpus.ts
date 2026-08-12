import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ParserGoldenCorpusEntry {
  name: string;
  path: string;
}

/** 收集 parser 特征语料：tests/*.kmd + 顶层 *.kmd；展示作品物理位于 examples/。 */
export function collectParserGoldenCorpus(publicDir: string): ParserGoldenCorpusEntry[] {
  const out: ParserGoldenCorpusEntry[] = [];
  const testsDir = join(publicDir, 'tests');

  for (const name of readdirSync(testsDir).sort()) {
    if (name.endsWith('.kmd')) {
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
