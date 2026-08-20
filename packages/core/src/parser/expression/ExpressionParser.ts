import type {
  BinaryExpressionOperator,
  ErrorExpression,
  ExpressionAst,
  ExpressionDiagnostic,
  ExpressionNodeBase,
  ExpressionParseResult,
  UnaryExpressionOperator,
} from "./types";

type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "identifier"
  | "operator"
  | "dot"
  | "left-paren"
  | "right-paren"
  | "question"
  | "colon"
  | "invalid"
  | "eof";

interface Token {
  type: TokenType;
  raw: string;
  start: number;
  end: number;
  value?: number | string | boolean;
}

const BINARY_BINDING_POWER: Readonly<Record<BinaryExpressionOperator, readonly [number, number]>> = {
  "||": [2, 3],
  "&&": [4, 5],
  "==": [6, 7],
  "!=": [6, 7],
  "<": [8, 9],
  "<=": [8, 9],
  ">": [8, 9],
  ">=": [8, 9],
  "+": [10, 11],
  "-": [10, 11],
  "*": [12, 13],
  "/": [12, 13],
};

const UNARY_BINDING_POWER = 14;
const CONDITIONAL_BINDING_POWER = 1;

export class ExpressionParser {
  private readonly source: string;
  private readonly baseOffset: number;
  private readonly diagnostics: ExpressionDiagnostic[] = [];
  private readonly tokens: Token[];
  private tokenIndex = 0;

  public constructor(source: string, baseOffset = 0) {
    this.source = source;
    this.baseOffset = baseOffset;
    this.tokens = tokenize(source, this.diagnostics, baseOffset);
  }

  public parse(): ExpressionParseResult {
    if (this.current().type === "eof") {
      const at = this.current().start;
      this.diagnostics.push({
        code: "expression-empty",
        severity: "error",
        message: "Expected an expression.",
        range: this.absoluteRange(at, at),
      });
      return {
        expression: this.errorNode(at, at),
        diagnostics: this.diagnostics,
      };
    }

    const expression = this.parseExpression(0);
    if (this.current().type !== "eof") {
      const start = this.current().start;
      const end = this.tokens.at(-1)?.start ?? this.source.length;
      const callLike = this.current().type === "left-paren";
      this.diagnostics.push({
        code: callLike ? "expression-call-not-supported" : "expression-trailing-input",
        severity: "error",
        message: callLike
          ? "Function calls are not part of the Phase B expression grammar."
          : "Unexpected trailing input after the expression.",
        range: this.absoluteRange(start, end),
      });
    }
    return { expression, diagnostics: this.diagnostics };
  }

  private parseExpression(minimumBindingPower: number): ExpressionAst {
    let left = this.parsePrefix();

    while (true) {
      const token = this.current();
      if (token.type === "question") {
        if (CONDITIONAL_BINDING_POWER < minimumBindingPower) break;
        this.advance();
        const whenTrue = this.parseExpression(0);
        if (this.current().type !== "colon") {
          this.diagnostics.push({
            code: "expression-expected-conditional-colon",
            severity: "error",
            message: "Conditional expression requires ':' before the false branch.",
            range: this.absoluteRange(this.current().start, this.current().end),
          });
        } else {
          this.advance();
        }
        const whenFalse = this.parseExpression(CONDITIONAL_BINDING_POWER);
        left = {
          ...this.nodeBase(left.range.start - this.baseOffset, whenFalse.range.end - this.baseOffset),
          type: "conditional-expression",
          condition: left,
          whenTrue,
          whenFalse,
        };
        continue;
      }

      if (token.type !== "operator" || !isBinaryOperator(token.raw)) break;
      const [leftPower, rightPower] = BINARY_BINDING_POWER[token.raw];
      if (leftPower < minimumBindingPower) break;
      this.advance();
      const right = this.parseExpression(rightPower);
      left = {
        ...this.nodeBase(left.range.start - this.baseOffset, right.range.end - this.baseOffset),
        type: "binary-expression",
        operator: token.raw,
        left,
        right,
      };
    }
    return left;
  }

  private parsePrefix(): ExpressionAst {
    const token = this.current();
    if (token.type === "operator" && isUnaryOperator(token.raw)) {
      this.advance();
      const operand = this.parseExpression(UNARY_BINDING_POWER);
      return {
        ...this.nodeBase(token.start, operand.range.end - this.baseOffset),
        type: "unary-expression",
        operator: token.raw,
        operand,
      };
    }

    if (token.type === "number" || token.type === "string" || token.type === "boolean") {
      this.advance();
      return {
        ...this.nodeBase(token.start, token.end),
        type: "literal-expression",
        value: token.value as number | string | boolean,
      };
    }

    if (token.type === "identifier") return this.parseName();

    if (token.type === "left-paren") {
      const open = token;
      this.advance();
      const expression = this.parseExpression(0);
      let end = expression.range.end - this.baseOffset;
      if (this.current().type === "right-paren") {
        end = this.current().end;
        this.advance();
      } else {
        this.diagnostics.push({
          code: "expression-expected-closing-paren",
          severity: "error",
          message: "Parenthesized expression is missing ')'.",
          range: this.absoluteRange(open.start, end),
        });
      }
      return {
        ...this.nodeBase(open.start, end),
        type: "group-expression",
        expression,
      };
    }

    const start = token.start;
    if (token.type !== "eof") this.advance();
    this.diagnostics.push({
      code: "expression-expected-expression",
      severity: "error",
      message: "Expected a literal, name, unary operator, or parenthesized expression.",
      range: this.absoluteRange(start, token.end),
    });
    return this.errorNode(start, token.end);
  }

  private parseName(): ExpressionAst {
    const start = this.current().start;
    const path: string[] = [this.current().raw];
    let end = this.current().end;
    this.advance();
    while (this.current().type === "dot") {
      const dot = this.current();
      this.advance();
      if (this.current().type !== "identifier") {
        this.diagnostics.push({
          code: "expression-invalid-token",
          severity: "error",
          message: "A name path dot must be followed by an identifier.",
          range: this.absoluteRange(dot.start, dot.end),
        });
        break;
      }
      path.push(this.current().raw);
      end = this.current().end;
      this.advance();
    }
    return { ...this.nodeBase(start, end), type: "name-expression", path };
  }

  private current(): Token {
    return this.tokens[this.tokenIndex] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): void {
    if (this.tokenIndex < this.tokens.length - 1) this.tokenIndex += 1;
  }

  private nodeBase(start: number, end: number): ExpressionNodeBase {
    return {
      raw: this.source.slice(start, end),
      range: this.absoluteRange(start, end),
    };
  }

  private errorNode(start: number, end: number): ErrorExpression {
    return { ...this.nodeBase(start, end), type: "error-expression" };
  }

  private absoluteRange(start: number, end: number): { start: number; end: number } {
    return { start: this.baseOffset + start, end: this.baseOffset + end };
  }
}

export function parseExpression(source: string, baseOffset = 0): ExpressionParseResult {
  return new ExpressionParser(source, baseOffset).parse();
}

function tokenize(
  source: string,
  diagnostics: ExpressionDiagnostic[],
  baseOffset: number,
): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    const char = source[position]!;
    if (/\s/u.test(char)) {
      position += 1;
      continue;
    }

    const numberEnd = scanNumber(source, position);
    if (numberEnd > position) {
      const raw = source.slice(position, numberEnd);
      tokens.push({ type: "number", raw, start: position, end: numberEnd, value: Number(raw) });
      position = numberEnd;
      continue;
    }

    if (char === "\"" || char === "'") {
      const string = scanString(source, position, char);
      tokens.push({
        type: "string",
        raw: source.slice(position, string.end),
        start: position,
        end: string.end,
        value: string.value,
      });
      if (!string.closed) {
        diagnostics.push({
          code: "expression-unclosed-string",
          severity: "error",
          message: "String literal is missing its closing quote.",
          range: { start: baseOffset + position, end: baseOffset + string.end },
        });
      }
      position = string.end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const end = scanIdentifier(source, position);
      const raw = source.slice(position, end);
      if (raw === "true" || raw === "false") {
        tokens.push({ type: "boolean", raw, start: position, end, value: raw === "true" });
      } else {
        tokens.push({ type: "identifier", raw, start: position, end });
      }
      position = end;
      continue;
    }

    const two = source.slice(position, position + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
      tokens.push({ type: "operator", raw: two, start: position, end: position + 2 });
      position += 2;
      continue;
    }

    const singleType = singleCharacterToken(char);
    if (singleType !== null) {
      tokens.push({ type: singleType, raw: char, start: position, end: position + 1 });
      position += 1;
      continue;
    }

    tokens.push({ type: "invalid", raw: char, start: position, end: position + 1 });
    diagnostics.push({
      code: "expression-invalid-token",
      severity: "error",
      message: `Unsupported expression token ${JSON.stringify(char)}.`,
      range: { start: baseOffset + position, end: baseOffset + position + 1 },
    });
    position += 1;
  }
  tokens.push({ type: "eof", raw: "", start: source.length, end: source.length });
  return tokens;
}

function scanNumber(source: string, start: number): number {
  const match = source.slice(start).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u);
  if (match === null) return start;
  const raw = match[0];
  if (raw.endsWith(".")) return start;
  return start + raw.length;
}

function scanString(
  source: string,
  start: number,
  quote: "\"" | "'",
): { end: number; value: string; closed: boolean } {
  let position = start + 1;
  let value = "";
  while (position < source.length) {
    const char = source[position]!;
    if (char === quote) return { end: position + 1, value, closed: true };
    if (char !== "\\") {
      value += char;
      position += 1;
      continue;
    }
    if (position + 1 >= source.length) {
      value += "\\";
      position += 1;
      break;
    }
    const escaped = source[position + 1]!;
    const simple: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      "\\": "\\",
      "\"": "\"",
      "'": "'",
    };
    value += simple[escaped] ?? escaped;
    position += 2;
  }
  return { end: position, value, closed: false };
}

function scanIdentifier(source: string, start: number): number {
  let position = start + 1;
  while (position < source.length && isIdentifierContinue(source[position]!)) position += 1;
  return position;
}

function isIdentifierStart(char: string): boolean {
  return char === "_" || /[A-Za-z\p{L}]/u.test(char);
}

function isIdentifierContinue(char: string): boolean {
  return char === "_" || char === "-" || /[A-Za-z0-9\p{L}\p{N}]/u.test(char);
}

function singleCharacterToken(char: string): TokenType | null {
  if (["+", "-", "*", "/", "!", "<", ">"].includes(char)) return "operator";
  if (char === ".") return "dot";
  if (char === "(") return "left-paren";
  if (char === ")") return "right-paren";
  if (char === "?") return "question";
  if (char === ":") return "colon";
  return null;
}

function isUnaryOperator(value: string): value is UnaryExpressionOperator {
  return value === "!" || value === "+" || value === "-";
}

function isBinaryOperator(value: string): value is BinaryExpressionOperator {
  return value in BINARY_BINDING_POWER;
}
