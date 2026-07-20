// Parser 黄金规范化序列化器（支柱 2a）。
//
// 目标（docs/planning/test-net-design-2026-07.md §3 支柱 2a）：把 parser 输出冻结成**稳定规范化**
// 序列化，键序稳定、位置 range 保留，B0.1 行为中性 ⟺ 黄金零变化。
//
// 为什么不直接 JSON.stringify(result)：JSON.stringify 按对象自有可枚举属性的**插入顺序**输出，
// 这取决于 parser 构造对象的字面顺序。历史代码（上帝对象 + 多处写入）在重构时可能改变插入顺序
// 而非语义——那会让黄金假性抖动。本序列化器**递归按字母序排键**，但保留**数组顺序**（tokens、
// effects、lines、commands 的顺序是有语义的，不能排），从而把"键序噪声"从黄金里剥掉，只留
// 语义信号。range 字段（{start,end}）作为普通对象一并按字母序排（e→s），其数值保留。
//
// 字段保留规则（显式，因 B0.1 也应保持）：
// - KMDParseResult 顶层：metadata / paragraphs / rawParagraphs / diagnostics 全保留。
// - KMDParagraphData：blockOptions / tokens / globalEffects / lineOffset / estimatedDuration /
//   absStartTime / ast / ir / diagnostics 全保留（含 ast + ir，因 §3 支柱 2a 明确要求三者都进黄金）。
// - KMDToken：content / effects / commands / params / layoutInstructions / isSceneClear / isSugar /
//   isPipe / isBraced / braceGroupId / range / line / sugar / startTime / duration 全保留。
// - EffectConfig：name / params / level / blocking / line / range 全保留。
// - LayoutInstruction：type / params / blocking / level / lineScope / line / range 全保留。
// undefined 值按 JSON 约定省略（JSON.stringify 行为）；false / 0 / "" 保留。
//
// 这套规则是"现状特征"不是"正确性裁判"（§1.4）：发现现状 bug 单独记录，不在本任务顺手改行为。

import type { KMDParseResult } from '../core/parser/types';

/**
 * 递归规范化：对象键按字母序排，数组顺序保留，undefined 被剔除。
 * 数字、字符串、布尔、null 原样返回。
 */
export function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    out[key] = normalize(obj[key]);
  }
  return out;
}

/**
 * 把 KMDParseResult 序列化成稳定的黄金字符串（2 空格缩进 + 尾随换行）。
 * 两次 parse 等价输入 → 字节一致输出（前提：用 fresh KMDParser 实例，避免 braceIdCounter 跨调用累加）。
 */
export function serializeParseResult(result: KMDParseResult): string {
  return JSON.stringify(normalize(result), null, 2) + '\n';
}