// Parser 黄金 fixture 套件（支柱 2a / docs/planning/test-net-design-2026-07.md §3）。
//
// 这是 B0.1 parser 重写的安全网核心：解析全语料 → 稳定规范化序列化 → 对比提交的黄金文件。
// B0.1 行为中性 ⟺ 黄金零变化。任何 diff 必须人工审查，**禁止无脑 --update**。
//
// 为什么不用 vitest toMatchFileSnapshot：那个 API 配 `vitest --update` 会自动重写黄金，
// 违背设计文档"黄金更新必须人工审"的约束。本套件改用**显式读文件 + toEqual 比对**：
// - 黄金缺失 → 测试报错并提示运行生成脚本（pnpm --filter @kmd/editor test:golden:write）。
// - 黄金存在但有 diff → 测试报错展示 diff，提示运行生成脚本重写**并人工审**。
// - vitest --update 不会触碰本套件的黄金文件（它们是普通 .json，不是 vitest snapshot）。
//
// 语料覆盖（§3 支柱 2a）：public/tests/*.kmd（32）+ 顶层 public/*.kmd（6，排除 final-test copy 重复）。
// B0.1 触及语法覆盖审计见 src/test/__fixtures__/b0-1-coverage.kmd 与下方专用断言。
//
// 确定性：每个用例 new KMDParser()，避免单例 braceIdCounter 跨调用累加导致 braceGroupId 抖动
//（已在 golden-serializer.ts 验证 fresh-instance 字节确定）。这是测试侧决策，不改被测代码语义。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KMDParser } from '../core/parser/Parser';
import { serializeParseResult } from './golden-serializer';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const GOLDEN_DIR = join(import.meta.dirname, '__golden__', 'parser');

/** 收集全部语料：tests/*.kmd + 顶层 *.kmd（排除 'final-test copy.kmd' 字节重复）。 */
function collectCorpus(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  // tests/ 子目录
  const testsDir = join(PUBLIC_DIR, 'tests');
  for (const name of readdirSync(testsDir).sort()) {
    if (name.endsWith('.kmd')) out.push({ name: `tests/${name}`, path: join(testsDir, name) });
  }
  // 顶层
  for (const name of readdirSync(PUBLIC_DIR).sort()) {
    if (!name.endsWith('.kmd')) continue;
    if (name === 'final-test copy.kmd') continue; // 字节重复 final-test.kmd
    const st = existsSync(join(PUBLIC_DIR, name));
    if (st) out.push({ name: `top/${name}`, path: join(PUBLIC_DIR, name) });
  }
  return out;
}

const corpus = collectCorpus();

/** 单次解析 + 序列化（fresh parser 实例，确定性）。 */
function goldenFor(path: string): string {
  const source = readFileSync(path, 'utf-8');
  const result = new KMDParser().parse(source);
  return serializeParseResult(result);
}

describe('parser golden fixtures (full corpus)', () => {
  // 用 it.each 把每个语料展开成独立用例，diff 定位到具体文件。
  it.each(corpus.map((c) => [c.name, c.path] as const))(
    '%s parses to committed golden',
    (name, path) => {
      const goldenPath = join(GOLDEN_DIR, `${name}.json`);
      const actual = goldenFor(path);
      if (!existsSync(goldenPath)) {
        // 缺失：报错并提示生成脚本，不自动写。
        expect.fail(
          `黄金文件缺失: ${goldenPath}\n` +
            `运行生成脚本重写并人工审阅:\n` +
            `  pnpm --filter @kmd/editor test:golden:write\n` +
            `（生成后 git diff 审阅，确认 diff 仅来自预期改动，勿无脑提交。）`,
        );
      }
      const expected = readFileSync(goldenPath, 'utf-8');
      // 用 toEqual 给出结构化 diff（比字符串比对更可读）。
      // 实际是 JSON 字符串；解析回对象比对，避免行尾/缩进噪声。
      expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
    },
    30_000,
  );

  it('corpus is non-empty and covers tests/ + top-level', () => {
    expect(corpus.length).toBeGreaterThan(30);
    expect(corpus.some((c) => c.name.startsWith('tests/'))).toBe(true);
    expect(corpus.some((c) => c.name.startsWith('top/'))).toBe(true);
  });
});

// ─── B0.1 触及语法覆盖审计（§3 支柱 2a：缺则补 fixture） ──────────────────
//
// 下列断言把"黄金网罩住了 B0.1 哪些重写面"显式化，而非让审查者从 1.4M JSON 里猜。
// 每条断言固定**当前退化行为**（现状特征），B0.1 重写后这些断言会红——正是安全网的目的。
// 现状 bug（如 line/ms 退化为字符串）单独记录在 docs/knowledge/language/migration.md，不顺手改。
//
// 依据：docs/knowledge/language/chain-model.md（量词表 L98-104）、migration.md（ease/hold 废弃 L15）、
// docs/planning/roadmap/phase-b/1.6-phase-b-plan.md（B0.1 D24 量词类型化）。

describe('parser golden: B0.1 coverage audit', () => {
  const fixturePath = join(PUBLIC_DIR, 'tests', 'b0-1-coverage.kmd');
  const result = new KMDParser().parse(readFileSync(fixturePath, 'utf-8'));

  /** 收集所有 token 的所有 effect 名。 */
  const allEffectNames = result.paragraphs.flatMap((p) => p.tokens.flatMap((t) => t.effects.map((e) => e.name)));

  it('covers 3+ element member chains (f.red.bold.blur)', () => {
    // 当前 parser 接受 3 元素链；B0.1 递归下降应保持形状。
    const chain = result.paragraphs.find((p) => p.tokens.some((t) => t.effects.some((e) => e.name === 'bold')));
    expect(chain).toBeDefined();
    const token = chain!.tokens.find((t) => t.effects.some((e) => e.name === 'bold'));
    const names = token!.effects.map((e) => e.name);
    expect(names).toContain('red');
    expect(names).toContain('bold');
    expect(names).toContain('blur');
  });

  it('covers line unit (0.5line) — currently degrades to string', () => {
    // D24 债务：autoConvert 仅处理 s/ms，line 退化为字符串。B0.1 应类型化为空间量词。
    const holdLine = result.paragraphs.flatMap((p) => p.tokens.flatMap((t) => t.effects))
      .find((e) => e.name === 'hold' && e.params[0] === '0.5line');
    expect(holdLine).toBeDefined();
  });

  it('covers ms unit (500ms) — currently silently converted to seconds', () => {
    // ms → 0.5（秒），单位信息丢失。B0.1 应保留单位。
    const holdMs = result.paragraphs.flatMap((p) => p.tokens.flatMap((t) => t.effects))
      .find((e) => e.name === 'hold' && e.params[0] === 0.5);
    expect(holdMs).toBeDefined();
  });

  it('covers self unit (1self) — currently degrades to string in AST commandChain', () => {
    // left(1self) 在 AST 层作为 commandChain 的 command.params[0]="1self"（字符串，未类型化）。
    // lowering 不把它落到 token.layoutInstructions（裸行无 {…} 主语），故需查 ast.lines.commandChains。
    const chains = result.paragraphs.flatMap((p) => p.ast?.lines ?? []).flatMap((l) => l.commandChains ?? []);
    const leftSelf = chains
      .flatMap((c) => c.commands ?? [])
      .find((cmd) => cmd.name === 'left' && cmd.params[0] === '1self');
    expect(leftSelf).toBeDefined();
  });

  it('covers deg unit (15deg) — currently degrades to string', () => {
    const chains = result.paragraphs.flatMap((p) => p.ast?.lines ?? []).flatMap((l) => l.commandChains ?? []);
    const rotateDeg = chains
      .flatMap((c) => c.commands ?? [])
      .find((cmd) => cmd.name === 'rotate' && cmd.params[0] === '15deg');
    expect(rotateDeg).toBeDefined();
  });

  it('covers ease word form — currently unknown-command diagnostic', () => {
    // ease 词形从未实现；spec 规划为 ~time~> 语法糖（chain-model.md:52），Phase B 将引入。
    // 当前 parser 对 ease 发 unknown-command 诊断。黄金冻结此现状。
    expect(allEffectNames).toContain('ease');
    const easeDiag = result.diagnostics?.find((d) => d.message.includes('ease'));
    expect(easeDiag).toBeDefined();
  });

  it('covers :bg scope (gray:bg) — char-only command forced to bg warns', () => {
    // 处方 11/12：:bg 为过渡期兼容写法，char-only 命令被 :bg 强转时 warn。
    const bgDiag = result.diagnostics?.find((d) => d.message.includes('gray') && d.message.includes(':bg'));
    expect(bgDiag).toBeDefined();
  });

  it('covers brace groups (braceGroupId assigned)', () => {
    const braced = result.paragraphs.flatMap((p) => p.tokens).find((t) => t.isBraced && t.braceGroupId !== undefined);
    expect(braced).toBeDefined();
  });

  it('covers hold level suffixes (:char / :group) — currently bare-line f. with level suffix parses as plain text (parser bug)', () => {
    // 当前 parser：`f.hold:char(1s).red` / `f.wave.hold:group(2s)` 这类裸行（无 {…} 主语 token）
    // 不被识别为命令链，整行降为纯文本 token，零 effect、零诊断、静默吞掉。
    // 这是错误写法，parser 应解析报错（unknown / syntax 诊断）而非静默降级——真实 parser bug，
    // 独立修复，非本任务顺手改（见 docs/planning/test-net-pr-summary-2026-07.md 现状 bug #1）。
    // B0.1 递归下降重写时应明确报错路径；届时此断言会红——正是安全网目的。
    const holdCharPara = result.paragraphs.find((p) =>
      p.tokens.some((t) => t.content.includes('f.hold:char')));
    expect(holdCharPara).toBeDefined();
    const holdCharToken = holdCharPara!.tokens.find((t) => t.content.includes('f.hold:char'));
    // 现状特征（bug）：裸行命令链未解析，content 保留原始文本，effects 为空，零诊断。
    expect(holdCharToken!.effects).toHaveLength(0);
    expect(holdCharToken!.content).toContain('f.hold:char(1s).red');

    const holdGroupPara = result.paragraphs.find((p) =>
      p.tokens.some((t) => t.content.includes('f.wave.hold:group')));
    const holdGroupToken = holdGroupPara!.tokens.find((t) => t.content.includes('f.wave.hold:group'));
    expect(holdGroupToken!.effects).toHaveLength(0);
  });
});