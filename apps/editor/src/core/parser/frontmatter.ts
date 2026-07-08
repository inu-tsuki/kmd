// Frontmatter 行级解析/合并/序列化 —— 规范依据 docs/knowledge/language/frontmatter-schema.md
// §3 解析规则:首行 `---` 定界;行级 `key: value`;注释符是 `//`(非 YAML `#`);
// 值经 KMDCommandParser.autoConvert;`var:` 独占行开块,其下 ≥2 空格缩进进 variables。
//
// §5 写回规则 W1–W4 要求往返保真:未涉及内容恒等。因此本模块刻意采用**行级保真模型**——
// 保留每行原文(raw),写回时未动行原样输出,而非「解析成对象再重新序列化」。这是 W1(未知字段/
// 顺序/注释保留)与 W3(未改字段写法不变)的最稳实现。

import { KMDCommandParser } from "./KMDCommandParser";

/** 单行 frontmatter 的结构化记录。未改行原样写回靠 raw;解析出的值仅供读取/比较。 */
export interface FrontMatterLine {
  /** 行类型划分,影响合并逻辑 */
  type: "blank" | "comment" | "var-open" | "var-entry" | "key";
  /** 原始整行(含缩进/注释/引号),序列化默认原样输出 */
  raw: string;
  /** key 行 / var-entry 行解析出的键名;其余为 undefined */
  key?: string;
  /** 行首缩进空格数(仅 key/var-entry 有意义) */
  indent?: number;
  /** 经 autoConvert 的解析值,仅供读取/比较用,不参与写回(W3:未改字段写法不变) */
  parsedValue?: any;
}

/**
 * 行级解析 frontmatter 文本(分隔符之间的内容,不含 `---` 行)。
 * 语义与 Parser.parseMetadata 逐行一致(§3 现状即规范 v1):
 *  - 空行 / `//` 注释行:记录原文,不产出值;
 *  - `var:` 独占行(trim 后严格相等):开启变量块,后续 ≥2 空格缩进行进入 variables;
 *  - `key: value` 行:trim 后经 autoConvert;
 *  - 未知 key 一律保留(§3.4 扩展缓冲)。
 * 注释/空行同样进数组,以保留顺序与原文,供序列化原样回写。
 */
export function parseFrontMatter(fmStr: string): FrontMatterLine[] {
  const lines: FrontMatterLine[] = [];
  let inVar = false;

  for (const line of fmStr.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      lines.push({ type: "blank", raw: line });
      continue;
    }
    if (trimmed.startsWith("//")) {
      lines.push({ type: "comment", raw: line });
      continue;
    }
    if (trimmed === "var:") {
      inVar = true;
      lines.push({ type: "var-open", raw: line, key: "var" });
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      // 无冒号的非注释行:parseMetadata 静默跳过,这里仍记录原文以保往返(W1)。
      lines.push({ type: "comment", raw: line });
      continue;
    }

    const key = line.substring(0, colonIdx).trim();
    const val = line.substring(colonIdx + 1).trim();
    const parsed = KMDCommandParser.autoConvert(val);
    const indentMatch = line.match(/^\s*/);
    const indent = indentMatch ? indentMatch[0].length : 0;

    if (inVar && indent >= 2) {
      lines.push({ type: "var-entry", raw: line, key, indent, parsedValue: parsed });
    } else {
      inVar = false;
      lines.push({ type: "key", raw: line, key, indent, parsedValue: parsed });
    }
  }

  return lines;
}

/** 定界结果:frontmatter 块定位 + 正文。与 Parser.ts:49-61 定界规则一致。 */
export interface FrontMatterBlock {
  /** 开分隔符所在行号(0-based) */
  startIdx: number;
  /** 闭分隔符所在行号(0-based) */
  endIdx: number;
  /** 解析出的行模型(分隔符之间) */
  lines: FrontMatterLine[];
  /** 闭分隔符之后的正文(原文,含末尾换行处理) */
  body: string;
}

/**
 * 从完整文档文本中提取 frontmatter 块。复刻 Parser.parse 的定界逻辑(§3.1):
 * 首行 trim === `---` 时,至下一个独占行 `---` 之间为 frontmatter;否则无 frontmatter。
 * 返回 null 表示文档无 frontmatter。返回的 body 是闭分隔符行之后的原文。
 */
export function extractFrontMatterBlock(text: string): FrontMatterBlock | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const allLines = normalized.split("\n");

  if (allLines.length === 0 || allLines[0]!.trim() !== "---") return null;

  let endIdx = -1;
  for (let idx = 1; idx < allLines.length; idx++) {
    if (allLines[idx]!.trim() === "---") {
      endIdx = idx;
      break;
    }
  }
  if (endIdx === -1) return null; // 未闭合:parseMetadata 同样静默跳过整块

  const fmStr = allLines.slice(1, endIdx).join("\n");
  const lines = parseFrontMatter(fmStr);
  const body = allLines.slice(endIdx + 1).join("\n");
  return { startIdx: 0, endIdx, lines, body };
}

/**
 * 序列化行模型为 frontmatter 文本(不含分隔符 `---`)。
 * W1/W3:未改行原样输出 raw;改写过的行(由 setField 替换 raw)同样输出其新 raw。
 */
export function serializeFrontMatter(lines: FrontMatterLine[]): string {
  return lines.map((l) => l.raw).join("\n");
}

/** UI 负责的 6 个 frontmatter 键 → canvasConfig 字段名。 */
export const UI_FRONTMATTER_KEYS = [
  "mode",
  "designWidth",
  "designHeight",
  "bgColor",
  "fontColor",
  "fontFamily",
] as const;

/**
 * 把一个 UI 值按字段序列化成写回用的 value 文本。单一来源(W3)。
 *  - mode: 无引号枚举;
 *  - designWidth/designHeight: 数字无引号;
 *  - bgColor/fontColor: 含 `#` 须双引号(否则 `#` 被当作注释起符);
 *  - fontFamily: 无引号(沿用现状写法)。
 */
export function serializeUIValue(key: string, value: any): string {
  if (key === "mode") return String(value);
  if (key === "designWidth" || key === "designHeight") return String(value);
  if (key === "bgColor" || key === "fontColor") return `"${value}"`;
  if (key === "fontFamily") return String(value);
  // 非声明的 UI 键不应走到这里;保守返回字符串形式。
  return String(value);
}

/**
 * 就地合并式写回单个字段(W2:UI 只写声明的字段,禁止整块替换)。
 *  - 已存在该 key 的顶层 key 行:就地改写 `: ` 之后的值,保留行首缩进与写法;
 *  - 不存在:在 var: 块之前(若有)或最末追加新行;
 *  - 返回新数组,不原地变更入参(便于回归断言)。
 * 仅处理顶层 key 行(type === 'key'),不动 var-entry 行(var 块由作者维护)。
 */
export function setField(
  lines: FrontMatterLine[],
  key: string,
  value: any,
): FrontMatterLine[] {
  const valueText = serializeUIValue(key, value);
  const next = lines.map((l) => ({ ...l }));

  const idx = next.findIndex((l) => l.type === "key" && l.key === key);
  if (idx !== -1) {
    // 就地改写:保留 key 原文前缀(到冒号为止),替换冒号后的值。
    const target = next[idx]!;
    const colonIdx = target.raw.indexOf(":");
    const prefix = target.raw.substring(0, colonIdx + 1);
    next[idx] = { ...target, raw: `${prefix} ${valueText}`, parsedValue: value };
    return next;
  }

  // 新增行:插入 var: 块之前(若已存在 var-open),否则末尾。
  const newRaw = `${key}: ${valueText}`;
  const newLine: FrontMatterLine = {
    type: "key",
    raw: newRaw,
    key,
    indent: 0,
    parsedValue: value,
  };
  const varOpenIdx = next.findIndex((l) => l.type === "var-open");
  if (varOpenIdx !== -1) {
    next.splice(varOpenIdx, 0, newLine);
  } else {
    next.push(newLine);
  }
  return next;
}

/**
 * 从行模型读出顶层 key 的解析值(经 autoConvert)。找不到返回 undefined。
 * 仅供 UI 同步用:取解析值而非原文,与 core parseMetadata 行为一致(回归项 c)。
 */
export function getField(lines: FrontMatterLine[], key: string): any {
  const hit = lines.find((l) => l.type === "key" && l.key === key);
  return hit?.parsedValue;
}

/**
 * 把行模型展平为 metadata 对象(metadata[key] / metadata.variables[key]),
 * 与 Parser.parseMetadata 写入的对象形状一致。供 core 复用同一解析。
 */
export function linesToMetadata(lines: FrontMatterLine[], metadata: any): void {
  for (const l of lines) {
    if (l.type === "var-entry") {
      metadata.variables ??= {};
      metadata.variables[l.key!] = l.parsedValue;
    } else if (l.type === "key") {
      metadata[l.key!] = l.parsedValue;
    }
    // blank/comment/var-open 不写入对象(parseMetadata 同样不写)。
  }
}