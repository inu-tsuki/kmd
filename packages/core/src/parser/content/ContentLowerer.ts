import { ExpressionBinder } from "../expression/ExpressionBinder";
import { ExpressionEvaluator } from "../expression/ExpressionEvaluator";
import type { ScriptPosition } from "../scope/types";
import type {
  BakedContentNode,
  BoundContentNode,
  BoundExprSpan,
  ContentBakeContext,
  ContentBakeResult,
  ContentBindingResult,
  ContentDiagnostic,
  ContentNodeAst,
  ExprSpanAst,
  TextRunAst,
} from "./types";

/** 构建期只绑定表达式引用，正文选择仍保留到每次场景进入的烘焙阶段。 */
export class ContentLowerer {
  private readonly binder: ExpressionBinder | null;
  private readonly evaluator = new ExpressionEvaluator();

  public constructor(binder: ExpressionBinder | null = null) {
    this.binder = binder;
  }

  public bind(nodes: readonly ContentNodeAst[], at: ScriptPosition): ContentBindingResult {
    if (this.binder === null) {
      throw new TypeError('ContentLowerer.bind requires an ExpressionBinder.');
    }
    const diagnostics: ContentBindingResult["diagnostics"] = [];
    const bound = nodes.map((node) => this.bindNode(node, at, diagnostics));
    return {
      nodes: bound,
      diagnostics,
      complete: diagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  public bake(nodes: readonly BoundContentNode[], context: ContentBakeContext): ContentBakeResult {
    const diagnostics: ContentBakeResult["diagnostics"] = [];
    const baked = nodes.map((node) => this.bakeNode(node, context, diagnostics));
    return {
      nodes: baked,
      text: baked.map(bakedText).join(""),
      diagnostics,
      complete: diagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  private bindNode(
    node: ContentNodeAst,
    at: ScriptPosition,
    diagnostics: ContentBindingResult["diagnostics"],
  ): BoundContentNode {
    if (node.type === "brace-group") {
      return {
        type: "bound-brace-group",
        raw: node.raw,
        range: { ...node.range },
        children: node.children.map((child) => this.bindNode(child, at, diagnostics)),
        closed: node.closed,
      };
    }
    if (node.type !== "expr-span") return cloneStaticNode(node);

    diagnostics.push(...node.expressionDiagnostics);
    const bound = this.bindExpressionSpan(node, at);
    diagnostics.push(...bound.diagnostics);
    return bound.node;
  }

  private bindExpressionSpan(
    node: ExprSpanAst,
    at: ScriptPosition,
  ): { node: BoundExprSpan; diagnostics: ContentBindingResult["diagnostics"] } {
    const diagnostics: ContentBindingResult["diagnostics"] = [];
    if (node.expression.type === "inline-interpolation") {
      const bound = this.binder!.bind(node.expression.expression, at);
      diagnostics.push(...bound.diagnostics);
      return {
        node: {
          type: "bound-expr-span",
          raw: node.raw,
          range: { ...node.range },
          marks: [...node.marks],
          expression: { type: "bound-inline-interpolation", expression: bound.expression },
        },
        diagnostics,
      };
    }
    if (node.expression.type === "inline-conditional") {
      const bound = this.binder!.bind(node.expression.condition, at);
      diagnostics.push(...bound.diagnostics);
      return {
        node: {
          type: "bound-expr-span",
          raw: node.raw,
          range: { ...node.range },
          marks: [...node.marks],
          expression: {
            type: "bound-inline-conditional",
            condition: bound.expression,
            whenTrue: { ...node.expression.whenTrue, range: { ...node.expression.whenTrue.range } },
            whenFalse: { ...node.expression.whenFalse, range: { ...node.expression.whenFalse.range } },
          },
        },
        diagnostics,
      };
    }

    const bound = this.binder!.bind(node.expression.discriminant, at);
    diagnostics.push(...bound.diagnostics);
    return {
      node: {
        type: "bound-expr-span",
        raw: node.raw,
        range: { ...node.range },
        marks: [...node.marks],
        expression: {
          type: "bound-inline-match",
          discriminant: bound.expression,
          cases: node.expression.cases.map((entry) => ({
            ...entry,
            range: { ...entry.range },
            labelRange: { ...entry.labelRange },
          })),
          fallback: node.expression.fallback === null
            ? null
            : { ...node.expression.fallback, range: { ...node.expression.fallback.range } },
        },
      },
      diagnostics,
    };
  }

  private bakeNode(
    node: BoundContentNode,
    context: ContentBakeContext,
    diagnostics: ContentBakeResult["diagnostics"],
  ): BakedContentNode {
    if (node.type === "bound-brace-group") {
      return {
        type: "baked-brace-group",
        raw: node.raw,
        range: { ...node.range },
        children: node.children.map((child) => this.bakeNode(child, context, diagnostics)),
        closed: node.closed,
      };
    }
    if (node.type !== "bound-expr-span") return cloneStaticNode(node);

    const selected = this.evaluateSpan(node, context, diagnostics);
    return {
      type: "text-run",
      raw: node.raw,
      content: selected,
      marks: [...node.marks],
      range: { ...node.range },
    };
  }

  private evaluateSpan(
    node: BoundExprSpan,
    context: ContentBakeContext,
    diagnostics: ContentBakeResult["diagnostics"],
  ): string {
    const expression = node.expression;
    const target = expression.type === "bound-inline-interpolation"
      ? expression.expression
      : expression.type === "bound-inline-conditional"
        ? expression.condition
        : expression.discriminant;
    const evaluated = this.evaluator.evaluate(target, context.state, context.spatial);
    diagnostics.push(...evaluated.diagnostics);
    if (!evaluated.complete || evaluated.value === null) return "";

    if (expression.type === "bound-inline-interpolation") {
      if (typeof evaluated.value === "object") {
        diagnostics.push(contentFailure(
          "content-interpolation-non-scalar",
          "Inline interpolation requires a scalar value.",
          node.range,
        ));
        return "";
      }
      return String(evaluated.value);
    }
    if (expression.type === "bound-inline-conditional") {
      if (typeof evaluated.value !== "boolean") {
        diagnostics.push(contentFailure(
          "content-condition-non-boolean",
          "Inline conditional requires a boolean condition.",
          node.range,
        ));
        return "";
      }
      return evaluated.value ? expression.whenTrue.text : expression.whenFalse.text;
    }
    if (typeof evaluated.value === "object") {
      diagnostics.push(contentFailure(
        "content-match-non-scalar",
        "Inline match requires a scalar discriminant.",
        node.range,
      ));
      return "";
    }
    return expression.cases.find((entry) => entry.label === evaluated.value)?.text
      ?? expression.fallback?.text
      ?? "";
  }
}

function cloneStaticNode<T extends Exclude<ContentNodeAst, ExprSpanAst | { type: "brace-group" }>>(node: T): T;
function cloneStaticNode<T extends Exclude<BoundContentNode, BoundExprSpan | { type: "bound-brace-group" }>>(node: T): T;
function cloneStaticNode(node: TextRunAst | BoundContentNode): TextRunAst | BoundContentNode {
  if (node.type === "text-run") return { ...node, marks: [...node.marks], range: { ...node.range } };
  if (node.type === "pause-cue") {
    return {
      ...node,
      range: { ...node.range },
      parameterRange: node.parameterRange === null ? null : { ...node.parameterRange },
    };
  }
  if (node.type === "sugar-cue") return { ...node, range: { ...node.range } };
  return node;
}

function bakedText(node: BakedContentNode): string {
  if (node.type === "text-run") return node.content;
  if (node.type === "baked-brace-group") return node.children.map(bakedText).join("");
  return "";
}

function contentFailure(
  code: ContentDiagnostic["code"],
  message: string,
  range: { start: number; end: number },
): ContentDiagnostic {
  return { code, severity: "error", message, range: { ...range } };
}
