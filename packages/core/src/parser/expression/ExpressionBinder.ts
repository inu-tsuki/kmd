import type { StateKey } from "../../state/StateStore";
import type { ScopeResolver } from "../scope/ScopeResolver";
import type {
  ScopeDefinition,
  ScriptPosition,
  SpatialValueType,
} from "../scope/types";
import type {
  BoundExpression,
  ExpressionAst,
  ExpressionBindingResult,
  ExpressionDiagnostic,
  NameExpression,
} from "./types";

interface BoundNameResult {
  expression: BoundExpression;
  diagnostics: ExpressionDiagnostic[];
}

interface AccessTarget {
  expression: BoundExpression;
  valueType: SpatialValueType | "unknown" | "scalar";
}

export class ExpressionBinder {
  private readonly scopes: ScopeResolver;

  public constructor(scopes: ScopeResolver) {
    this.scopes = scopes;
  }

  public bind(expression: ExpressionAst, at: ScriptPosition): ExpressionBindingResult {
    const diagnostics: ExpressionDiagnostic[] = [];
    const bound = this.bindNode(expression, at, diagnostics);
    const complete = diagnostics.every((entry) => entry.severity !== "error")
      && !containsBoundError(bound);
    return { expression: bound, diagnostics, complete };
  }

  private bindNode(
    expression: ExpressionAst,
    at: ScriptPosition,
    diagnostics: ExpressionDiagnostic[],
  ): BoundExpression {
    switch (expression.type) {
      case "literal-expression":
        return { ...expression, type: "bound-literal-expression" };
      case "name-expression": {
        const result = this.bindName(expression, at);
        diagnostics.push(...result.diagnostics);
        return result.expression;
      }
      case "unary-expression":
        return {
          ...expression,
          type: "bound-unary-expression",
          operand: this.bindNode(expression.operand, at, diagnostics),
        };
      case "binary-expression":
        return {
          ...expression,
          type: "bound-binary-expression",
          left: this.bindNode(expression.left, at, diagnostics),
          right: this.bindNode(expression.right, at, diagnostics),
        };
      case "conditional-expression":
        return {
          ...expression,
          type: "bound-conditional-expression",
          condition: this.bindNode(expression.condition, at, diagnostics),
          whenTrue: this.bindNode(expression.whenTrue, at, diagnostics),
          whenFalse: this.bindNode(expression.whenFalse, at, diagnostics),
        };
      case "group-expression":
        return this.bindNode(expression.expression, at, diagnostics);
      case "error-expression":
        return { ...expression, type: "bound-error-expression" };
    }
  }

  private bindName(expression: NameExpression, at: ScriptPosition): BoundNameResult {
    const { baseName, accessors } = splitBaseAndAccessors(expression.path);
    const resolution = this.scopes.resolve(baseName, at, expression.range);
    if (resolution.status === "unresolved") {
      return {
        expression: boundError(expression),
        diagnostics: [{
          code: "expression-unknown-name",
          severity: "error",
          message: `Expression name "${baseName}" cannot be resolved at this script position.`,
          range: { ...expression.range },
        }],
      };
    }

    if (resolution.entity.kind !== "definition") {
      return {
        expression: boundError(expression),
        diagnostics: [{
          code: "expression-non-value-symbol",
          severity: "error",
          message: `Expression name "${baseName}" resolves to a ${resolution.entity.kind}, which is not a value.`,
          range: { ...expression.range },
        }],
      };
    }

    const definition = resolution.entity.definition;
    let target = targetFromDefinition(definition, expression);
    if (target === null) {
      return {
        expression: boundError(expression),
        diagnostics: [{
          code: "expression-non-value-symbol",
          severity: "error",
          message: `Definition "${definition.name}" is a ${definition.kind} and cannot be read as a state value.`,
          range: { ...expression.range },
        }],
      };
    }

    const diagnostics: ExpressionDiagnostic[] = [];
    for (const accessor of accessors) {
      if (accessor !== "line" && accessor !== "start" && accessor !== "end") {
        diagnostics.push({
          code: "expression-invalid-accessor",
          severity: "error",
          message: `Unknown spatial accessor ".${accessor}".`,
          range: { ...expression.range },
        });
        return { expression: boundError(expression), diagnostics };
      }
      if (
        target.valueType !== "unknown"
        && target.valueType !== requiredAccessorInput(accessor)
      ) {
        diagnostics.push({
          code: "expression-invalid-accessor",
          severity: "error",
          message: `Accessor ".${accessor}" requires ${requiredAccessorInput(accessor)} input.`,
          range: { ...expression.range },
        });
        return { expression: boundError(expression), diagnostics };
      }
      target = {
        expression: {
          raw: expression.raw,
          range: { ...expression.range },
          type: "bound-accessor-expression",
          target: target.expression,
          accessor,
        },
        valueType: accessor === "line" ? "domain" : "point",
      };
    }
    return { expression: target.expression, diagnostics };
  }
}

function splitBaseAndAccessors(path: readonly string[]): {
  baseName: string;
  accessors: string[];
} {
  if (path[0] === "var" && path.length >= 2) {
    return { baseName: `var.${path[1]}`, accessors: path.slice(2) };
  }
  return { baseName: path[0] ?? "", accessors: path.slice(1) };
}

function targetFromDefinition(
  definition: ScopeDefinition,
  expression: NameExpression,
): AccessTarget | null {
  if (definition.kind === "var" || definition.kind === "state") {
    const key = stateKeyFromDefinition(definition);
    return {
      expression: {
        raw: expression.raw,
        range: { ...expression.range },
        type: "bound-state-ref-expression",
        key,
      },
      valueType: "unknown",
    };
  }
  if (definition.kind === "object") {
    return {
      expression: {
        raw: expression.raw,
        range: { ...expression.range },
        type: "bound-spatial-ref-expression",
        selector: {
          kind: "definition",
          valueType: "domain",
          definition,
          range: { ...expression.range },
        },
      },
      valueType: "domain",
    };
  }
  return null;
}

export function stateKeyFromDefinition(definition: ScopeDefinition): StateKey {
  const level = definition.kind === "var" ? "document" : "scene";
  return {
    level,
    name: definition.name,
    qualifiedName: level === "document"
      ? `var.${definition.name}`
      : `scene:${definition.visibleFrom.offset}:${definition.name}`,
    declarationRange: { ...definition.declarationRange },
  };
}

function requiredAccessorInput(accessor: "line" | "start" | "end"): SpatialValueType {
  return accessor === "line" ? "point" : "domain";
}

function boundError(expression: NameExpression): BoundExpression {
  return { raw: expression.raw, range: { ...expression.range }, type: "bound-error-expression" };
}

function containsBoundError(expression: BoundExpression): boolean {
  switch (expression.type) {
    case "bound-error-expression":
      return true;
    case "bound-unary-expression":
      return containsBoundError(expression.operand);
    case "bound-binary-expression":
      return containsBoundError(expression.left) || containsBoundError(expression.right);
    case "bound-conditional-expression":
      return containsBoundError(expression.condition)
        || containsBoundError(expression.whenTrue)
        || containsBoundError(expression.whenFalse);
    case "bound-accessor-expression":
      return containsBoundError(expression.target);
    default:
      return false;
  }
}
