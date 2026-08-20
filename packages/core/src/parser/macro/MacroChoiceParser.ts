import { parseExpression } from "../expression/ExpressionParser";
import type {
  MacroChoiceNode,
  MacroChoiceParseResult,
  MacroDiagnostic,
} from "./types";

interface Segment {
  start: number;
  end: number;
}

export class MacroChoiceParser {
  private readonly source: string;
  private readonly baseOffset: number;
  private readonly diagnostics: MacroDiagnostic[] = [];
  private readonly expressionDiagnostics: MacroChoiceParseResult["expressionDiagnostics"] = [];

  public constructor(source: string, baseOffset = 0) {
    this.source = source;
    this.baseOffset = baseOffset;
  }

  public parse(): MacroChoiceParseResult {
    const choice = this.parseSegment(trimSegment(this.source, 0, this.source.length), false);
    return {
      choice,
      diagnostics: this.diagnostics,
      expressionDiagnostics: this.expressionDiagnostics,
      complete: this.diagnostics.length === 0
        && this.expressionDiagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  private parseSegment(segment: Segment, implicitEmpty: boolean): MacroChoiceNode {
    const question = findTopLevelQuestion(this.source, segment.start, segment.end);
    if (question < 0) {
      if (segment.start === segment.end && !implicitEmpty) {
        this.diagnostics.push({
          code: "macro-empty-reference",
          severity: "error",
          message: "Macro expansion requires a macro name or chain fragment.",
          range: this.absoluteRange(segment.start, segment.end),
        });
      }
      return {
        type: "macro-choice-leaf",
        raw: this.source.slice(segment.start, segment.end),
        range: this.absoluteRange(segment.start, segment.end),
        implicitEmpty,
      };
    }

    const conditionSegment = trimSegment(this.source, segment.start, question);
    if (conditionSegment.start === conditionSegment.end) {
      this.diagnostics.push({
        code: "macro-empty-choice-condition",
        severity: "error",
        message: "Macro choice requires a condition before '?'.",
        range: this.absoluteRange(conditionSegment.start, conditionSegment.end),
      });
    }
    const condition = parseExpression(
      this.source.slice(conditionSegment.start, conditionSegment.end),
      this.baseOffset + conditionSegment.start,
    );
    this.expressionDiagnostics.push(...condition.diagnostics);

    const colon = findMatchingChoiceColon(this.source, question + 1, segment.end);
    const trueSegment = trimSegment(
      this.source,
      question + 1,
      colon < 0 ? segment.end : colon,
    );
    if (trueSegment.start === trueSegment.end) {
      this.diagnostics.push({
        code: "macro-empty-choice-true-branch",
        severity: "error",
        message: "Macro choice requires a non-empty true branch.",
        range: this.absoluteRange(trueSegment.start, trueSegment.end),
      });
    }
    const falseSegment = colon < 0
      ? { start: segment.end, end: segment.end }
      : trimSegment(this.source, colon + 1, segment.end);

    return {
      type: "macro-choice-conditional",
      range: this.absoluteRange(segment.start, segment.end),
      condition: condition.expression,
      whenTrue: this.parseSegment(trueSegment, false),
      whenFalse: this.parseSegment(falseSegment, colon < 0),
    };
  }

  private absoluteRange(start: number, end: number): { start: number; end: number } {
    return { start: this.baseOffset + start, end: this.baseOffset + end };
  }
}

export function parseMacroChoice(source: string, baseOffset = 0): MacroChoiceParseResult {
  return new MacroChoiceParser(source, baseOffset).parse();
}

function findTopLevelQuestion(source: string, start: number, end: number): number {
  return scanTopLevel(source, start, end, (char) => char === "?");
}

function findMatchingChoiceColon(source: string, start: number, end: number): number {
  let nestedChoices = 0;
  return scanTopLevel(source, start, end, (char, position) => {
    if (char === "?") {
      nestedChoices += 1;
      return false;
    }
    if (char !== ":" || isGranularityColon(source, position, end)) return false;
    if (nestedChoices > 0) {
      nestedChoices -= 1;
      return false;
    }
    return true;
  });
}

function scanTopLevel(
  source: string,
  start: number,
  end: number,
  accept: (char: string, position: number) => boolean,
): number {
  const stack: string[] = [];
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  for (let position = start; position < end; position += 1) {
    const char = source[position]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    if (stack.length === 0 && accept(char, position)) return position;
  }
  return -1;
}

function isGranularityColon(source: string, position: number, end: number): boolean {
  const tail = source.slice(position + 1, end);
  return /^(?:char|group|block)(?=$|[.\s!~\-])/u.test(tail);
}

function trimSegment(source: string, start: number, end: number): Segment {
  while (start < end && /\s/u.test(source[start]!)) start += 1;
  while (end > start && /\s/u.test(source[end - 1]!)) end -= 1;
  return { start, end };
}
