import { describe, expect, it } from "vitest";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { ExpressionBinder } from "@kmd/core/parser/expression/ExpressionBinder";
import { ExpressionEvaluator } from "@kmd/core/parser/expression/ExpressionEvaluator";
import { parseExpression } from "@kmd/core/parser/expression/ExpressionParser";
import { StateStore } from "@kmd/core/state/StateStore";

function expressionHarness() {
  const definitions = new DefinitionIndex();
  const scopes = new ScopeResolver(
    definitions,
    createStaticScopeCommandRegistryView([]),
  );
  return { definitions, scopes };
}

function addVar(definitions: DefinitionIndex, name: string) {
  return definitions.add({
    name,
    kind: "var",
    level: "document",
    visibleFrom: { offset: 0 },
    visibleUntil: { offset: 10_000 },
    payload: null,
    declarationRange: { start: 0, end: name.length },
    source: "frontmatter",
  });
}

describe("parser-expression: syntax and recovery", () => {
  it("applies the explicit precedence table", () => {
    const result = parseExpression("1 + 2 * 3 >= 7 && false || true", 40);

    expect(result.diagnostics).toEqual([]);
    expect(result.expression).toMatchObject({
      type: "binary-expression",
      operator: "||",
      left: {
        type: "binary-expression",
        operator: "&&",
        left: {
          type: "binary-expression",
          operator: ">=",
          left: {
            type: "binary-expression",
            operator: "+",
            right: { type: "binary-expression", operator: "*" },
          },
        },
      },
      right: { type: "literal-expression", value: true },
      range: { start: 40, end: 71 },
    });
  });

  it("parses conditional expressions right-associatively", () => {
    const result = parseExpression("false ? 1 : true ? 2 : 3");

    expect(result.diagnostics).toEqual([]);
    expect(result.expression).toMatchObject({
      type: "conditional-expression",
      condition: { value: false },
      whenTrue: { value: 1 },
      whenFalse: {
        type: "conditional-expression",
        condition: { value: true },
        whenTrue: { value: 2 },
        whenFalse: { value: 3 },
      },
    });
  });

  it("preserves Unicode names, decoded strings, and absolute recovery ranges", () => {
    const unicode = parseExpression("var.信任值 == '高\\n级'", 100);
    expect(unicode.diagnostics).toEqual([]);
    expect(unicode.expression).toMatchObject({
      type: "binary-expression",
      left: { type: "name-expression", path: ["var", "信任值"] },
      right: { type: "literal-expression", value: "高\n级" },
      range: { start: 100, end: 117 },
    });

    const recovered = parseExpression("(1 + 2", 500);
    expect(recovered.diagnostics).toMatchObject([{
      code: "expression-expected-closing-paren",
      range: { start: 500, end: 506 },
    }]);
    expect(recovered.expression.range).toEqual({ start: 500, end: 506 });
  });

  it("rejects function-call syntax with a dedicated diagnostic", () => {
    const result = parseExpression("max(var.x, 5)", 20);
    expect(result.diagnostics).toMatchObject([{
      code: "expression-invalid-token",
      range: { start: 29, end: 30 },
    }, {
      code: "expression-call-not-supported",
      range: { start: 23, end: 33 },
    }]);
  });
});

describe("parser-expression: binding and evaluation", () => {
  it("binds names once and short-circuits unreachable state reads", () => {
    const { definitions, scopes } = expressionHarness();
    const missing = addVar(definitions, "missing");
    const parsed = parseExpression("false && var.missing > 0");
    const bound = new ExpressionBinder(scopes).bind(parsed.expression, { offset: 10 });
    const evaluated = new ExpressionEvaluator().evaluate(bound.expression, new StateStore());

    expect(bound.complete).toBe(true);
    expect(bound.expression).toMatchObject({
      right: { left: { key: { qualifiedName: missing.qualifiedName } } },
    });
    expect(evaluated).toEqual({ value: false, diagnostics: [], complete: true });
  });

  it("evaluates state arithmetic and reports deterministic type and finite-value errors", () => {
    const { definitions, scopes } = expressionHarness();
    const count = addVar(definitions, "count");
    const label = addVar(definitions, "label");
    const state = new StateStore([
      {
        key: {
          level: "document",
          name: count.name,
          qualifiedName: count.qualifiedName,
          declarationRange: count.declarationRange,
        },
        value: 4,
      },
      {
        key: {
          level: "document",
          name: label.name,
          qualifiedName: label.qualifiedName,
          declarationRange: label.declarationRange,
        },
        value: "ready",
      },
    ]);
    const binder = new ExpressionBinder(scopes);
    const evaluator = new ExpressionEvaluator();

    const arithmetic = binder.bind(parseExpression("var.count * 2 + 1").expression, { offset: 10 });
    expect(evaluator.evaluate(arithmetic.expression, state)).toEqual({
      value: 9,
      diagnostics: [],
      complete: true,
    });

    const mismatch = binder.bind(parseExpression("var.label - 1").expression, { offset: 10 });
    expect(evaluator.evaluate(mismatch.expression, state).diagnostics[0]?.code)
      .toBe("expression-type-mismatch");

    const division = binder.bind(parseExpression("1 / 0").expression, { offset: 10 });
    expect(evaluator.evaluate(division.expression, state).diagnostics[0]?.code)
      .toBe("expression-division-by-zero");
  });

  it("distinguishes unavailable line geometry from an invalid accessor input", () => {
    const { definitions, scopes } = expressionHarness();
    const cursor = addVar(definitions, "cursor");
    const state = new StateStore([{
      key: {
        level: "document",
        name: cursor.name,
        qualifiedName: cursor.qualifiedName,
        declarationRange: cursor.declarationRange,
      },
      value: { type: "point", x: 10, y: 20 },
    }]);
    const bound = new ExpressionBinder(scopes).bind(
      parseExpression("var.cursor.line").expression,
      { offset: 10 },
    );
    const evaluator = new ExpressionEvaluator();

    expect(evaluator.evaluate(bound.expression, state).diagnostics[0]?.code)
      .toBe("expression-spatial-value-unavailable");
    expect(evaluator.evaluate(bound.expression, state, {
      materialize: () => undefined,
      lineForPoint: (point) => ({
        type: "domain",
        start: { type: "point", x: 0, y: point.y },
        end: { type: "point", x: 100, y: point.y },
      }),
    })).toMatchObject({
      complete: true,
      value: { type: "domain", start: { x: 0, y: 20 }, end: { x: 100, y: 20 } },
    });
  });
});
