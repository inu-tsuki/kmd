import { parseExpression } from "../expression/ExpressionParser";
import type { ExpressionDiagnostic } from "../expression/types";
import type {
  BraceGroupAst,
  ContentDiagnostic,
  ContentMark,
  ContentNodeAst,
  ContentScanResult,
  ExprSpanAst,
  InlineCaseValue,
  InlineTextBranch,
  InlineTextCase,
  InlineTextExpressionAst,
  PauseCueAst,
  SugarCueAst,
  TextRunAst,
} from "./types";

interface ScanSectionResult {
  nodes: ContentNodeAst[];
  closed: boolean;
}

interface SlicePart {
  text: string;
  start: number;
  end: number;
}

/**
 * 扫描正文内容并在扫描期完成 `{=}` 门禁。裸 `{...}` 始终保留为文字分组，
 * 表达式只从 `{=` 进入，避免后续阶段根据文字内容重新猜测语义。
 */
export class ContentScanner {
  private readonly source: string;
  private readonly baseOffset: number;
  private readonly diagnostics: ContentDiagnostic[] = [];
  private readonly expressionDiagnostics: ExpressionDiagnostic[] = [];
  private readonly marks = new Set<ContentMark>();
  private position = 0;

  public constructor(source: string, baseOffset = 0) {
    this.source = source;
    this.baseOffset = baseOffset;
  }

  public scan(): ContentScanResult {
    const section = this.scanSection(false);
    return {
      nodes: section.nodes,
      diagnostics: this.diagnostics,
      expressionDiagnostics: this.expressionDiagnostics,
      complete: section.closed
        && this.diagnostics.length === 0
        && this.expressionDiagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  private scanSection(expectClosingBrace: boolean): ScanSectionResult {
    const nodes: ContentNodeAst[] = [];
    let buffer = "";
    let bufferStart = this.position;

    const flushText = (): void => {
      if (buffer.length === 0) return;
      const node: TextRunAst = {
        type: "text-run",
        raw: this.source.slice(bufferStart, this.position),
        content: buffer,
        marks: [...this.marks],
        range: this.range(bufferStart, this.position),
      };
      nodes.push(node);
      buffer = "";
      bufferStart = this.position;
    };

    while (this.position < this.source.length) {
      const char = this.source[this.position]!;
      if (expectClosingBrace && char === "}") {
        flushText();
        this.position += 1;
        return { nodes, closed: true };
      }

      if (char === "\\") {
        const escapeStart = this.position;
        this.position += 1;
        if (this.position < this.source.length) {
          buffer += this.source[this.position]!;
          this.position += 1;
        } else {
          buffer += this.source.slice(escapeStart, this.position);
        }
        continue;
      }

      if (char === "*" && this.source[this.position + 1] === "*") {
        flushText();
        toggle(this.marks, "bold");
        this.position += 2;
        bufferStart = this.position;
        continue;
      }

      if (char === "*" && !this.marks.has("bold")) {
        flushText();
        toggle(this.marks, "italic");
        this.position += 1;
        bufferStart = this.position;
        continue;
      }

      if (char === "{" && this.source[this.position + 1] === "=") {
        flushText();
        nodes.push(this.scanExpressionSpan());
        bufferStart = this.position;
        continue;
      }

      if (char === "{") {
        flushText();
        nodes.push(this.scanBraceGroup());
        bufferStart = this.position;
        continue;
      }

      if (char === "|") {
        flushText();
        nodes.push(this.scanPause());
        bufferStart = this.position;
        continue;
      }

      if (char === "~" || char === "^" || char === ">") {
        flushText();
        nodes.push(this.scanSugar());
        bufferStart = this.position;
        continue;
      }

      buffer += char;
      this.position += 1;
    }

    flushText();
    if (expectClosingBrace) {
      this.diagnostics.push({
        code: "content-unclosed-brace-group",
        severity: "error",
        message: "Brace group is missing its closing '}'.",
        range: this.range(Math.max(0, this.position - 1), this.position),
      });
      return { nodes, closed: false };
    }
    return { nodes, closed: true };
  }

  private scanBraceGroup(): BraceGroupAst {
    const start = this.position;
    this.position += 1;
    const section = this.scanSection(true);
    return {
      type: "brace-group",
      raw: this.source.slice(start, this.position),
      range: this.range(start, this.position),
      children: section.nodes,
      closed: section.closed,
    };
  }

  private scanExpressionSpan(): ExprSpanAst {
    const start = this.position;
    this.position += 2;
    const payloadStart = this.position;
    const close = findExpressionSpanClose(this.source, this.position);
    const payloadEnd = close < 0 ? this.source.length : close;
    const payload = this.source.slice(payloadStart, payloadEnd);
    this.position = close < 0 ? this.source.length : close + 1;

    if (close < 0) {
      this.diagnostics.push({
        code: "content-unclosed-expression-span",
        severity: "error",
        message: "Inline expression span is missing its closing '}'.",
        range: this.range(start, this.position),
      });
    }

    const expression = this.parseInlineExpression(payload, payloadStart);
    return {
      type: "expr-span",
      raw: this.source.slice(start, this.position),
      range: this.range(start, this.position),
      marks: [...this.marks],
      expression: expression.expression,
      expressionDiagnostics: expression.diagnostics,
    };
  }

  private parseInlineExpression(
    payload: string,
    payloadStart: number,
  ): { expression: InlineTextExpressionAst; diagnostics: ExpressionDiagnostic[] } {
    const trimmed = trimSlice(payload, 0, payload.length);
    if (trimmed.text.length === 0) {
      this.diagnostics.push({
        code: "content-empty-expression-span",
        severity: "error",
        message: "Inline expression span requires an expression.",
        range: this.range(payloadStart, payloadStart + payload.length),
      });
    }

    const question = findTopLevelCharacter(trimmed.text, "?");
    if (question < 0) {
      const parsed = parseExpression(
        trimmed.text,
        this.baseOffset + payloadStart + trimmed.start,
      );
      this.expressionDiagnostics.push(...parsed.diagnostics);
      return {
        expression: { type: "inline-interpolation", expression: parsed.expression },
        diagnostics: parsed.diagnostics,
      };
    }

    const conditionPart = trimSlice(trimmed.text, 0, question);
    const parsedCondition = parseExpression(
      conditionPart.text,
      this.baseOffset + payloadStart + trimmed.start + conditionPart.start,
    );
    this.expressionDiagnostics.push(...parsedCondition.diagnostics);
    const branchBase = payloadStart + trimmed.start + question + 1;
    const branchSource = trimmed.text.slice(question + 1);
    const parts = splitTopLevel(branchSource, "|");
    const firstColon = parts[0] === undefined
      ? -1
      : findTopLevelCharacter(parts[0].text, ":");

    if (firstColon < 0) {
      const branches = parts.map((part) => textBranch(part, this.baseOffset + branchBase));
      if (branches.length !== 2) {
        this.diagnostics.push({
          code: "content-conditional-branch-count",
          severity: "error",
          message: "Boolean inline condition requires exactly two text branches.",
          range: this.range(branchBase, branchBase + branchSource.length),
        });
      }
      const whenTrue = branches[0] ?? emptyBranch(this.baseOffset + branchBase);
      const whenFalse = branches[1] ?? emptyBranch(this.baseOffset + branchBase + branchSource.length);
      this.reportEmptyBranch(whenTrue);
      this.reportEmptyBranch(whenFalse);
      return {
        expression: {
          type: "inline-conditional",
          condition: parsedCondition.expression,
          whenTrue,
          whenFalse,
        },
        diagnostics: parsedCondition.diagnostics,
      };
    }

    const cases: InlineTextCase[] = [];
    let fallback: InlineTextBranch | null = null;
    for (const [index, part] of parts.entries()) {
      const colon = findTopLevelCharacter(part.text, ":");
      if (colon < 0) {
        if (index !== parts.length - 1 || fallback !== null) {
          this.diagnostics.push({
            code: "content-match-missing-fallback",
            severity: "error",
            message: "Inline match fallback must be the final branch.",
            range: this.range(branchBase + part.start, branchBase + part.end),
          });
        }
        fallback = textBranch(part, this.baseOffset + branchBase);
        this.reportEmptyBranch(fallback);
        continue;
      }

      const labelPart = trimSlice(part.text, 0, colon);
      const valuePart = trimSlice(part.text, colon + 1, part.text.length);
      const labelRange = {
        start: this.baseOffset + branchBase + part.start + labelPart.start,
        end: this.baseOffset + branchBase + part.start + labelPart.end,
      };
      const label = parseCaseValue(labelPart.text);
      if (label === null) {
        this.diagnostics.push({
          code: "content-match-empty-label",
          severity: "error",
          message: "Inline match branch requires a scalar label before ':'.",
          range: labelRange,
        });
      }
      const branch: InlineTextCase = {
        label: label ?? "",
        labelRange,
        text: valuePart.text,
        range: {
          start: this.baseOffset + branchBase + part.start + valuePart.start,
          end: this.baseOffset + branchBase + part.start + valuePart.end,
        },
      };
      this.reportEmptyBranch(branch);
      cases.push(branch);
    }

    if (fallback === null) {
      this.diagnostics.push({
        code: "content-match-missing-fallback",
        severity: "error",
        message: "Inline match requires a final fallback text branch.",
        range: this.range(branchBase, branchBase + branchSource.length),
      });
    }
    return {
      expression: {
        type: "inline-match",
        discriminant: parsedCondition.expression,
        cases,
        fallback,
      },
      diagnostics: parsedCondition.diagnostics,
    };
  }

  private reportEmptyBranch(branch: InlineTextBranch): void {
    if (branch.text.length > 0) return;
    this.diagnostics.push({
      code: "content-conditional-empty-text",
      severity: "error",
      message: "Inline conditional branch requires literal text.",
      range: { ...branch.range },
    });
  }

  private scanPause(): PauseCueAst {
    const start = this.position;
    this.position += 1;
    if (this.source[this.position] !== "(") {
      return {
        type: "pause-cue",
        raw: this.source.slice(start, this.position),
        range: this.range(start, this.position),
        parameter: null,
        parameterRange: null,
        closed: true,
      };
    }

    const parameterStart = this.position + 1;
    const close = findClosingParen(this.source, this.position);
    if (close < 0) {
      this.position = this.source.length;
      this.diagnostics.push({
        code: "content-unclosed-pause",
        severity: "error",
        message: "Pause cue is missing its closing ')'.",
        range: this.range(start, this.position),
      });
      return {
        type: "pause-cue",
        raw: this.source.slice(start, this.position),
        range: this.range(start, this.position),
        parameter: this.source.slice(parameterStart),
        parameterRange: this.range(parameterStart, this.position),
        closed: false,
      };
    }

    this.position = close + 1;
    return {
      type: "pause-cue",
      raw: this.source.slice(start, this.position),
      range: this.range(start, this.position),
      parameter: this.source.slice(parameterStart, close).trim(),
      parameterRange: this.range(parameterStart, close),
      closed: true,
    };
  }

  private scanSugar(): SugarCueAst {
    const start = this.position;
    const char = this.source[this.position]!;
    if (char === ">") {
      while (this.source[this.position] === ">") this.position += 1;
      const width = this.position - start;
      return {
        type: "sugar-cue",
        raw: this.source.slice(start, this.position),
        range: this.range(start, this.position),
        sugar: "go",
        level: width >= 3 ? "block" : width === 2 ? "group" : "char",
      };
    }
    this.position += 1;
    return {
      type: "sugar-cue",
      raw: this.source.slice(start, this.position),
      range: this.range(start, this.position),
      sugar: char === "~" ? "slow" : "fast",
      level: "char",
    };
  }

  private range(start: number, end: number): { start: number; end: number } {
    return { start: this.baseOffset + start, end: this.baseOffset + end };
  }
}

export function scanContent(source: string, baseOffset = 0): ContentScanResult {
  return new ContentScanner(source, baseOffset).scan();
}

function toggle(marks: Set<ContentMark>, mark: ContentMark): void {
  if (marks.has(mark)) marks.delete(mark);
  else marks.add(mark);
}

function findExpressionSpanClose(source: string, start: number): number {
  let braceDepth = 1;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) return index;
    }
  }
  return -1;
}

function findClosingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findTopLevelCharacter(source: string, expected: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === expected && parenDepth === 0 && braceDepth === 0) {
      if (expected === "|" && (source[index - 1] === "|" || source[index + 1] === "|")) {
        continue;
      }
      return index;
    }
  }
  return -1;
}

function splitTopLevel(source: string, separator: string): SlicePart[] {
  const parts: SlicePart[] = [];
  let start = 0;
  while (start <= source.length) {
    const relative = findTopLevelCharacter(source.slice(start), separator);
    const end = relative < 0 ? source.length : start + relative;
    parts.push(trimSlice(source, start, end));
    if (relative < 0) break;
    start = end + 1;
  }
  return parts;
}

function trimSlice(source: string, start: number, end: number): SlicePart {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(source[trimmedStart]!)) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(source[trimmedEnd - 1]!)) trimmedEnd -= 1;
  return {
    text: source.slice(trimmedStart, trimmedEnd),
    start: trimmedStart,
    end: trimmedEnd,
  };
}

function textBranch(part: SlicePart, absoluteBase: number): InlineTextBranch {
  return {
    text: part.text,
    range: { start: absoluteBase + part.start, end: absoluteBase + part.end },
  };
}

function emptyBranch(at: number): InlineTextBranch {
  return { text: "", range: { start: at, end: at } };
}

function parseCaseValue(source: string): InlineCaseValue | null {
  if (source.length === 0) return null;
  if ((source.startsWith('"') && source.endsWith('"'))
    || (source.startsWith("'") && source.endsWith("'"))) {
    return source.slice(1, -1);
  }
  if (source === "true") return true;
  if (source === "false") return false;
  const numeric = Number(source);
  if (Number.isFinite(numeric) && source.trim().length > 0) return numeric;
  return source;
}
