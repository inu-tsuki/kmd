import { ParserCursor } from "./ParserCursor";
import type {
  AngleQuantityAst,
  ChainDiagnostic,
  ChainDiagnosticCode,
  EventLiteralAst,
  ExpressionSliceAst,
  IdentifierAst,
  InvalidValueAst,
  LiteralAst,
  LiteralParseResult,
  NameRefAst,
  NumberLiteralAst,
  RangeEndpointAst,
  RangeLiteralAst,
  RateQuantityAst,
  RelativeQuantityAst,
  SourceRange,
  SpaceQuantityAst,
  SpaceUnit,
  StringLiteralAst,
  SyntaxNodeBase,
  TimeQuantityAst,
} from "./types";

type ScalarAst =
  | NumberLiteralAst
  | TimeQuantityAst
  | SpaceQuantityAst
  | AngleQuantityAst;

interface Segment {
  start: number;
  end: number;
}

const SPACE_UNITS: readonly SpaceUnit[] = ["char", "line", "self", "px"];
const QUANTITY_UNITS = ["char", "line", "self", "deg", "ms", "px", "s"] as const;

export class LiteralParser {
  private readonly cursor: ParserCursor;
  private readonly diagnostics: ChainDiagnostic[];
  private tokenStart = 0;
  private tokenRaw = "";

  constructor(
    cursor: ParserCursor,
    diagnostics: ChainDiagnostic[] = cursor.diagnostics,
  ) {
    this.cursor = cursor;
    this.diagnostics = diagnostics;
  }

  /** Parses the cursor's remaining slice as one literal and consumes trailing inline whitespace. */
  parse(): LiteralAst | InvalidValueAst {
    this.cursor.skipInlineWhitespace();
    this.tokenStart = this.cursor.mark();

    let tokenEnd = this.cursor.source.length;
    while (
      tokenEnd > this.tokenStart
      && isInlineWhitespace(this.cursor.source[tokenEnd - 1])
    ) {
      tokenEnd -= 1;
    }

    this.cursor.advanceTo(tokenEnd);
    this.tokenRaw = this.cursor.source.slice(this.tokenStart, tokenEnd);
    const value = this.parseToken();
    this.cursor.skipInlineWhitespace();
    return value;
  }

  private parseToken(): LiteralAst | InvalidValueAst {
    if (this.tokenRaw.length === 0) {
      return this.invalid(
        "invalid-quantity",
        "chain-invalid-quantity",
        "Expected a literal value.",
      );
    }

    const first = this.tokenRaw[0];
    if (first === "\"" || first === "'") {
      return this.parseString(first);
    }

    if (this.tokenRaw === "true" || this.tokenRaw === "false") {
      return {
        ...this.nodeBase(),
        type: "bool-literal",
        value: this.tokenRaw === "true",
      };
    }

    if (this.tokenRaw === "click") {
      const event: EventLiteralAst = {
        ...this.nodeBase(),
        type: "event-literal",
        event: "click",
      };
      return event;
    }

    if (this.tokenRaw.startsWith("signal:")) {
      const signal = this.tokenRaw.slice("signal:".length);
      if (isIdentifier(signal)) {
        const event: EventLiteralAst = {
          ...this.nodeBase(),
          type: "event-literal",
          event: "signal",
          signal,
        };
        return event;
      }
    }

    if (this.tokenRaw.includes("~")) {
      return this.parseRange() ?? this.invalidQuantity();
    }

    if (this.tokenRaw.includes("/")) {
      return this.parseRate() ?? this.invalidQuantity();
    }

    const relative = this.parseRelative(0, this.tokenRaw.length);
    if (relative !== null) {
      return relative;
    }

    const scalar = this.parseScalar(0, this.tokenRaw.length);
    if (scalar !== null) {
      return scalar;
    }

    return this.invalidQuantity();
  }

  private parseString(quote: "\"" | "'"): StringLiteralAst | InvalidValueAst {
    let value = "";
    let index = 1;
    let closingIndex = -1;

    while (index < this.tokenRaw.length) {
      const char = this.tokenRaw[index]!;
      if (char === quote) {
        closingIndex = index;
        break;
      }

      if (char !== "\\") {
        value += char;
        index += 1;
        continue;
      }

      index += 1;
      if (index >= this.tokenRaw.length) {
        break;
      }

      const escaped = this.tokenRaw[index]!;
      if (escaped === "u") {
        const digits = this.tokenRaw.slice(index + 1, index + 5);
        if (digits.length === 4 && [...digits].every(isHexDigit)) {
          value += String.fromCharCode(Number.parseInt(digits, 16));
          index += 5;
          continue;
        }
      }

      value += decodeSimpleEscape(escaped);
      index += 1;
    }

    if (closingIndex < 0) {
      return this.invalid(
        "unclosed-string",
        "chain-unclosed-string",
        "String literal is missing its closing quote.",
      );
    }

    if (closingIndex !== this.tokenRaw.length - 1) {
      return this.invalid(
        "unexpected-token",
        "chain-unexpected-token",
        "Unexpected input after the string literal.",
        closingIndex + 1,
        this.tokenRaw.length,
      );
    }

    return {
      ...this.nodeBase(),
      type: "string-literal",
      value,
      quote,
    };
  }

  private parseRange(): RangeLiteralAst | null {
    const arrowPositions = findAll(this.tokenRaw, "~>");
    if (arrowPositions.length !== 1) {
      return null;
    }

    const arrow = arrowPositions[0]!;
    const prefix = this.tokenRaw.slice(0, arrow);
    const durationSeparators = findAll(prefix, "~");
    if (durationSeparators.length > 1) {
      return null;
    }

    const toSegment = trimSegment(this.tokenRaw, arrow + 2, this.tokenRaw.length);
    if (toSegment.start === toSegment.end) {
      return null;
    }

    let fromSegment: Segment;
    let durationSegment: Segment | null = null;
    if (durationSeparators.length === 1) {
      const separator = durationSeparators[0]!;
      fromSegment = trimSegment(this.tokenRaw, 0, separator);
      durationSegment = trimSegment(this.tokenRaw, separator + 1, arrow);
    } else {
      fromSegment = trimSegment(this.tokenRaw, 0, arrow);
    }

    if (fromSegment.start === fromSegment.end) {
      return null;
    }

    const from = this.parseRangeEndpoint(fromSegment.start, fromSegment.end);
    const to = this.parseRangeEndpoint(toSegment.start, toSegment.end);
    if (from === null || to === null) {
      return null;
    }

    let duration: TimeQuantityAst | undefined;
    if (durationSegment !== null) {
      if (durationSegment.start === durationSegment.end) {
        return null;
      }
      const candidate = this.parseScalar(durationSegment.start, durationSegment.end);
      if (candidate?.type !== "time-quantity") {
        return null;
      }
      duration = candidate;
    }

    return {
      ...this.nodeBase(),
      type: "range-literal",
      from,
      ...(duration === undefined ? {} : { duration }),
      to,
    };
  }

  private parseRate(): RateQuantityAst | null {
    const slashPositions = findAll(this.tokenRaw, "/");
    if (slashPositions.length !== 1) {
      return null;
    }

    const slash = slashPositions[0]!;
    const numeratorRaw = this.tokenRaw.slice(0, slash);
    const denominatorRaw = this.tokenRaw.slice(slash + 1);
    if (!SPACE_UNITS.includes(denominatorRaw as SpaceUnit)) {
      return null;
    }

    let numberRaw = numeratorRaw;
    let numeratorUnit: "deg" | undefined;
    if (numberRaw.endsWith("deg")) {
      numeratorUnit = "deg";
      numberRaw = numberRaw.slice(0, -3);
    }

    const value = parseNumber(numberRaw);
    if (value === null) {
      return null;
    }

    return {
      ...this.nodeBase(),
      type: "rate-quantity",
      value,
      ...(numeratorUnit === undefined ? {} : { numeratorUnit }),
      denominatorUnit: denominatorRaw as SpaceUnit,
    };
  }

  private parseRangeEndpoint(start: number, end: number): RangeEndpointAst | null {
    const relative = this.parseRelative(start, end);
    if (relative !== null) {
      return relative;
    }

    const scalar = this.parseScalar(start, end);
    if (
      scalar !== null
      && scalar.type !== "angle-quantity"
    ) {
      return scalar;
    }

    return this.parseNameRef(start, end) ?? this.parseExpressionSlice(start, end);
  }

  private parseRelative(start: number, end: number): RelativeQuantityAst | null {
    const raw = this.tokenRaw.slice(start, end);
    const operator = raw.startsWith("+=")
      ? "+="
      : raw.startsWith("-=")
        ? "-="
        : null;
    if (operator === null) {
      return null;
    }

    const value = parseNumber(raw.slice(2));
    if (value === null) {
      return null;
    }

    return {
      ...this.nodeBase(start, end),
      type: "relative-quantity",
      operator,
      value,
    };
  }

  private parseScalar(start: number, end: number): ScalarAst | null {
    const raw = this.tokenRaw.slice(start, end);
    const number = parseNumber(raw);
    if (number !== null) {
      return {
        ...this.nodeBase(start, end),
        type: "number-literal",
        value: number,
      };
    }

    for (const unit of QUANTITY_UNITS) {
      if (!raw.endsWith(unit)) {
        continue;
      }
      const value = parseNumber(raw.slice(0, -unit.length));
      if (value === null) {
        continue;
      }

      if (unit === "s" || unit === "ms") {
        return {
          ...this.nodeBase(start, end),
          type: "time-quantity",
          value,
          unit,
        };
      }
      if (unit === "deg") {
        return {
          ...this.nodeBase(start, end),
          type: "angle-quantity",
          value,
          unit,
        };
      }
      return {
        ...this.nodeBase(start, end),
        type: "space-quantity",
        value,
        unit,
      };
    }

    return null;
  }

  private parseNameRef(start: number, end: number): NameRefAst | null {
    const raw = this.tokenRaw.slice(start, end);
    const path: IdentifierAst[] = [];
    let segmentStart = 0;

    for (let index = 0; index <= raw.length; index += 1) {
      if (index !== raw.length && raw[index] !== ".") {
        continue;
      }

      const name = raw.slice(segmentStart, index);
      if (!isIdentifier(name)) {
        return null;
      }
      path.push({
        ...this.nodeBase(start + segmentStart, start + index),
        type: "identifier",
        name,
      });
      segmentStart = index + 1;
    }

    return path.length === 0
      ? null
      : {
          ...this.nodeBase(start, end),
          type: "name-ref",
          path,
        };
  }

  private parseExpressionSlice(start: number, end: number): ExpressionSliceAst | null {
    const raw = this.tokenRaw.slice(start, end);
    if (!raw.startsWith("$(") || !raw.endsWith(")")) {
      return null;
    }

    const diagnostics: ChainDiagnostic[] = [];
    const cursor = new ParserCursor(raw.slice(1), 0, diagnostics);
    const balanced = cursor.readBalanced("(", ")");
    if (balanced === null || !balanced.closed || !cursor.eof) {
      return null;
    }

    return {
      ...this.nodeBase(start, end),
      type: "expression-slice",
      delimited: balanced.inner,
    };
  }

  private invalidQuantity(): InvalidValueAst {
    return this.invalid(
      "invalid-quantity",
      "chain-invalid-quantity",
      "Malformed or unsupported quantity literal.",
    );
  }

  private invalid(
    reason: InvalidValueAst["reason"],
    code: ChainDiagnosticCode,
    message: string,
    errorStart = 0,
    errorEnd = this.tokenRaw.length,
  ): InvalidValueAst {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      range: this.range(errorStart, errorEnd),
    });
    return {
      ...this.nodeBase(),
      type: "invalid-value",
      reason,
    };
  }

  private nodeBase(start = 0, end = this.tokenRaw.length): SyntaxNodeBase {
    return {
      raw: this.tokenRaw.slice(start, end),
      range: this.range(start, end),
    };
  }

  private range(start: number, end: number): SourceRange {
    return {
      start: this.cursor.baseOffset + this.tokenStart + start,
      end: this.cursor.baseOffset + this.tokenStart + end,
    };
  }
}

export function parseLiteral(source: string, baseOffset = 0): LiteralParseResult {
  const diagnostics: ChainDiagnostic[] = [];
  const cursor = new ParserCursor(source, baseOffset, diagnostics);
  const value = new LiteralParser(cursor, diagnostics).parse();
  return { value, diagnostics };
}

function parseNumber(raw: string): number | null {
  let index = 0;
  if (raw[index] === "+" || raw[index] === "-") {
    index += 1;
  }

  let integerDigits = 0;
  while (isDigit(raw[index])) {
    integerDigits += 1;
    index += 1;
  }

  let fractionDigits = 0;
  if (raw[index] === ".") {
    index += 1;
    while (isDigit(raw[index])) {
      fractionDigits += 1;
      index += 1;
    }
    if (fractionDigits === 0) {
      return null;
    }
  }

  if (integerDigits === 0 && fractionDigits === 0) {
    return null;
  }

  if (raw[index] === "e" || raw[index] === "E") {
    index += 1;
    if (raw[index] === "+" || raw[index] === "-") {
      index += 1;
    }
    let exponentDigits = 0;
    while (isDigit(raw[index])) {
      exponentDigits += 1;
      index += 1;
    }
    if (exponentDigits === 0) {
      return null;
    }
  }

  return index === raw.length ? Number(raw) : null;
}

function trimSegment(source: string, start: number, end: number): Segment {
  while (start < end && isInlineWhitespace(source[start])) {
    start += 1;
  }
  while (end > start && isInlineWhitespace(source[end - 1])) {
    end -= 1;
  }
  return { start, end };
}

function findAll(source: string, needle: string): number[] {
  const positions: number[] = [];
  let index = 0;
  while (index <= source.length - needle.length) {
    if (source.startsWith(needle, index)) {
      positions.push(index);
      index += needle.length;
    } else {
      index += 1;
    }
  }
  return positions;
}

function isIdentifier(raw: string): boolean {
  if (raw.length === 0 || !isIdentifierStart(raw[0]!)) {
    return false;
  }
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (!isIdentifierStart(char) && !isDigit(char) && char !== "-") {
      return false;
    }
  }
  return true;
}

function isIdentifierStart(char: string): boolean {
  return char === "_" || /[A-Za-z\p{L}]/u.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isInlineWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function isHexDigit(char: string): boolean {
  return (char >= "0" && char <= "9")
    || (char >= "a" && char <= "f")
    || (char >= "A" && char <= "F");
}

function decodeSimpleEscape(char: string): string {
  const escapes: Readonly<Record<string, string>> = {
    "0": "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "\\": "\\",
    "\"": "\"",
    "'": "'",
  };
  return escapes[char] ?? char;
}
