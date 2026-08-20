import { describe, expect, it } from "vitest";
import { LiteralParser, parseLiteral } from "@kmd/core/parser/chainSyntax/LiteralParser";
import { ParserCursor } from "@kmd/core/parser/chainSyntax/ParserCursor";
import type {
  ChainDiagnostic,
  LiteralAst,
  RangeLiteralAst,
  SyntaxNodeBase,
} from "@kmd/core/parser/chainSyntax/types";

function parseOk(source: string, baseOffset = 0): LiteralAst {
  const result = parseLiteral(source, baseOffset);
  expect(result.diagnostics).toEqual([]);
  expect(result.value.type).not.toBe("invalid-value");
  return result.value as LiteralAst;
}

function expectRawInvariant(line: string, node: SyntaxNodeBase): void {
  expect(node.raw).toBe(line.slice(node.range.start, node.range.end));
}

describe("parser-chain-literals: ParserCursor", () => {
  it("tracks local positions and absolute source ranges", () => {
    const cursor = new ParserCursor("  abc", 11);
    cursor.skipInlineWhitespace();
    const mark = cursor.mark();
    expect(cursor.peek()).toBe("a");
    expect(cursor.consume()).toBe("a");
    expect(cursor.consumeIf("bc")).toBe(true);
    expect(cursor.rawFrom(mark)).toBe("abc");
    expect(cursor.rangeFrom(mark)).toEqual({ start: 13, end: 16 });
    expect(cursor.eof).toBe(true);
  });

  it("reads nested balanced slices without treating quoted delimiters as structure", () => {
    const cursor = new ParserCursor("(fn(1, ')'), \"(\"))tail", 4);
    const balanced = cursor.readBalanced("(", ")");
    expect(balanced).toEqual({
      raw: "(fn(1, ')'), \"(\")",
      inner: "fn(1, ')'), \"(\"",
      range: { start: 4, end: 21 },
      closed: true,
    });
    expect(cursor.source.slice(cursor.position)).toBe(")tail");
  });

  it("records expect failures without throwing author-input errors", () => {
    const diagnostics: ChainDiagnostic[] = [];
    const cursor = new ParserCursor("value", 8, diagnostics);
    expect(cursor.expect("(", "chain-unclosed-argument-list")).toBe(false);
    expect(diagnostics).toEqual([
      {
        code: "chain-unclosed-argument-list",
        severity: "error",
        message: "Expected \"(\".",
        range: { start: 8, end: 8 },
      },
    ]);
  });

  it("allows LiteralParser to append diagnostics to a shared collection", () => {
    const diagnostics: ChainDiagnostic[] = [];
    const cursor = new ParserCursor("1ss", 20, diagnostics);
    const value = new LiteralParser(cursor, diagnostics).parse();
    expect(value.type).toBe("invalid-value");
    expect(diagnostics[0]?.range).toEqual({ start: 20, end: 23 });
  });
});

describe("parser-chain-literals: scalar literals", () => {
  it.each([
    ["0", 0],
    ["+1", 1],
    ["-1", -1],
    [".5", 0.5],
    ["-.5", -0.5],
    ["1.25", 1.25],
    ["1e3", 1000],
    ["1E-2", 0.01],
  ])("parses NUMBER %s while preserving its spelling", (source, expected) => {
    const value = parseOk(source);
    expect(value).toMatchObject({
      type: "number-literal",
      raw: source,
      range: { start: 0, end: source.length },
      value: expected,
    });
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("parses BOOLEAN %s", (source, expected) => {
    expect(parseOk(source)).toMatchObject({
      type: "bool-literal",
      value: expected,
    });
  });

  it("decodes escapes while retaining the quoted raw string", () => {
    const source = String.raw`"line\n\t\"quote\"\u4E2D\\end"`;
    expect(parseOk(source)).toEqual({
      type: "string-literal",
      raw: source,
      range: { start: 0, end: source.length },
      quote: "\"",
      value: "line\n\t\"quote\"中\\end",
    });
  });

  it("supports apostrophe strings and escaped apostrophes", () => {
    const source = String.raw`'it\'s'`;
    expect(parseOk(source)).toMatchObject({
      type: "string-literal",
      raw: source,
      quote: "'",
      value: "it's",
    });
  });
});

describe("parser-chain-literals: typed quantities", () => {
  it.each([
    ["1s", "time-quantity", 1, "s"],
    ["250ms", "time-quantity", 250, "ms"],
    ["-1s", "time-quantity", -1, "s"],
    ["2char", "space-quantity", 2, "char"],
    ["-0.5line", "space-quantity", -0.5, "line"],
    ["1self", "space-quantity", 1, "self"],
    ["24px", "space-quantity", 24, "px"],
    ["90deg", "angle-quantity", 90, "deg"],
  ])("parses %s as %s", (source, type, expectedValue, unit) => {
    expect(parseOk(source)).toMatchObject({
      type,
      raw: source,
      value: expectedValue,
      unit,
    });
  });

  it.each([
    ["15deg/char", 15, "deg", "char"],
    ["0.98/char", 0.98, undefined, "char"],
    ["-2/line", -2, undefined, "line"],
    ["1deg/self", 1, "deg", "self"],
    ["4/px", 4, undefined, "px"],
  ])("parses rate quantity %s", (source, expectedValue, numeratorUnit, denominatorUnit) => {
    const value = parseOk(source);
    expect(value).toMatchObject({
      type: "rate-quantity",
      raw: source,
      value: expectedValue,
      denominatorUnit,
    });
    if (numeratorUnit === undefined) {
      expect(value).not.toHaveProperty("numeratorUnit");
    } else {
      expect(value).toHaveProperty("numeratorUnit", numeratorUnit);
    }
  });

  it.each([
    ["+=0.1", "+=", 0.1],
    ["-=2", "-=", 2],
  ])("parses relative quantity %s", (source, operator, expectedValue) => {
    expect(parseOk(source)).toMatchObject({
      type: "relative-quantity",
      raw: source,
      operator,
      value: expectedValue,
    });
  });

  it("keeps a leading plus without equals as a positive number", () => {
    expect(parseOk("+0.1")).toMatchObject({
      type: "number-literal",
      value: 0.1,
    });
  });

  it("parses the click event literal", () => {
    expect(parseOk("click")).toEqual({
      type: "event-literal",
      raw: "click",
      range: { start: 0, end: 5 },
      event: "click",
    });
  });

  it("parses a named signal event literal", () => {
    expect(parseOk("signal:doorOpened")).toEqual({
      type: "event-literal",
      raw: "signal:doorOpened",
      range: { start: 0, end: 17 },
      event: "signal",
      signal: "doorOpened",
    });
  });

  it.each(["signal:", "signal:bad name", "signal:1ready"])(
    "rejects malformed signal event literal %s",
    (source) => {
      const result = parseLiteral(source);
      expect(result.value.type).toBe("invalid-value");
      expect(result.diagnostics).toMatchObject([{ code: "chain-invalid-quantity" }]);
    },
  );
});

describe("parser-chain-literals: range quantities", () => {
  it("parses a two-endpoint range", () => {
    const value = parseOk("0~>1") as RangeLiteralAst;
    expect(value).toMatchObject({
      type: "range-literal",
      from: { type: "number-literal", raw: "0", value: 0 },
      to: { type: "number-literal", raw: "1", value: 1 },
    });
    expect(value.duration).toBeUndefined();
  });

  it("parses a range with a typed duration", () => {
    expect(parseOk("-1line~250ms~>+=2")).toMatchObject({
      type: "range-literal",
      from: { type: "space-quantity", value: -1, unit: "line" },
      duration: { type: "time-quantity", value: 250, unit: "ms" },
      to: { type: "relative-quantity", operator: "+=", value: 2 },
    });
  });

  it("preserves name references as typed range endpoints", () => {
    expect(parseOk("var.start~2s~>目标.end")).toMatchObject({
      type: "range-literal",
      from: {
        type: "name-ref",
        path: [{ name: "var" }, { name: "start" }],
      },
      to: {
        type: "name-ref",
        path: [{ name: "目标" }, { name: "end" }],
      },
    });
  });

  it("folds baseOffset into parent and child ranges", () => {
    const prefix = "@fx(";
    const source = "  1~2s~>3  ";
    const line = prefix + source;
    const value = parseOk(source, prefix.length) as RangeLiteralAst;

    expect(value.range).toEqual({ start: 6, end: 13 });
    expect(value.from.range).toEqual({ start: 6, end: 7 });
    expect(value.duration?.range).toEqual({ start: 8, end: 10 });
    expect(value.to.range).toEqual({ start: 12, end: 13 });
    expectRawInvariant(line, value);
    expectRawInvariant(line, value.from);
    expectRawInvariant(line, value.duration!);
    expectRawInvariant(line, value.to);
  });
});

describe("parser-chain-literals: malformed intentional tightening", () => {
  it.each([
    "1ss",
    "1mss",
    "ms",
    "1/",
    "~>1",
    "1~x~>2",
    "1e",
    "1.",
  ])("rejects %s without accepting a valid prefix", (source) => {
    const result = parseLiteral(source, 9);
    expect(result.value).toEqual({
      type: "invalid-value",
      reason: "invalid-quantity",
      raw: source,
      range: { start: 9, end: 9 + source.length },
    });
    expect(result.diagnostics).toEqual([
      {
        code: "chain-invalid-quantity",
        severity: "error",
        message: "Malformed or unsupported quantity literal.",
        range: { start: 9, end: 9 + source.length },
      },
    ]);
  });

  it("returns an invalid recovery node for an unclosed string", () => {
    const source = String.raw`"unterminated\"`;
    const result = parseLiteral(source);
    expect(result.value).toMatchObject({
      type: "invalid-value",
      reason: "unclosed-string",
      raw: source,
    });
    expect(result.diagnostics[0]).toMatchObject({
      code: "chain-unclosed-string",
      severity: "error",
      range: { start: 0, end: source.length },
    });
  });

  it("diagnoses trailing input after a complete string", () => {
    const result = parseLiteral('"ok"tail', 3);
    expect(result.value.type).toBe("invalid-value");
    expect(result.diagnostics[0]).toMatchObject({
      code: "chain-unexpected-token",
      range: { start: 7, end: 11 },
    });
  });
});
