import type {
  StateDomainValue,
  StatePointValue,
  StateReadView,
  StateValue,
} from "../../state/StateStore";
import type {
  BinaryExpressionOperator,
  BoundExpression,
  ExpressionDiagnostic,
  ExpressionEvaluationResult,
  SpatialValueProvider,
  UnaryExpressionOperator,
} from "./types";

interface NodeEvaluation {
  value: StateValue | null;
  diagnostics: ExpressionDiagnostic[];
}

export class ExpressionEvaluator {
  public evaluate(
    expression: BoundExpression,
    state: StateReadView,
    spatial?: SpatialValueProvider,
  ): ExpressionEvaluationResult {
    const result = this.evaluateNode(expression, state, spatial);
    return {
      value: result.value,
      diagnostics: result.diagnostics,
      complete: result.value !== null
        && result.diagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  private evaluateNode(
    expression: BoundExpression,
    state: StateReadView,
    spatial: SpatialValueProvider | undefined,
  ): NodeEvaluation {
    switch (expression.type) {
      case "bound-literal-expression":
        return { value: expression.value, diagnostics: [] };
      case "bound-state-ref-expression": {
        const value = state.get(expression.key);
        if (value !== undefined) return { value, diagnostics: [] };
        return failure(
          "expression-uninitialized-state",
          `State "${expression.key.qualifiedName}" has no value at this position.`,
          expression.range,
        );
      }
      case "bound-spatial-ref-expression": {
        const value = spatial?.materialize(expression.selector);
        if (value !== undefined) return { value, diagnostics: [] };
        return failure(
          "expression-spatial-value-unavailable",
          "Spatial value is unavailable before layout materialization.",
          expression.range,
        );
      }
      case "bound-accessor-expression": {
        const target = this.evaluateNode(expression.target, state, spatial);
        if (target.value === null) return target;
        const accessed = applyAccessor(target.value, expression.accessor, spatial);
        if (accessed !== null) return { value: accessed, diagnostics: target.diagnostics };
        if (expression.accessor === "line" && isPoint(target.value)) {
          return {
            value: null,
            diagnostics: [
              ...target.diagnostics,
              {
                code: "expression-spatial-value-unavailable",
                severity: "error",
                message: "Line geometry is unavailable before layout materialization.",
                range: { ...expression.range },
              },
            ],
          };
        }
        return {
          value: null,
          diagnostics: [
            ...target.diagnostics,
            typeMismatch(
              `Accessor ".${expression.accessor}" cannot be applied to ${valueType(target.value)}.`,
              expression.range,
            ),
          ],
        };
      }
      case "bound-unary-expression": {
        const operand = this.evaluateNode(expression.operand, state, spatial);
        if (operand.value === null) return operand;
        const value = evaluateUnary(expression.operator, operand.value);
        if (value === null) {
          return {
            value: null,
            diagnostics: [
              ...operand.diagnostics,
              typeMismatch(
                `Unary operator "${expression.operator}" cannot consume ${valueType(operand.value)}.`,
                expression.range,
              ),
            ],
          };
        }
        return finiteResult(value, operand.diagnostics, expression.range);
      }
      case "bound-binary-expression":
        return this.evaluateBinary(expression, state, spatial);
      case "bound-conditional-expression": {
        const condition = this.evaluateNode(expression.condition, state, spatial);
        if (condition.value === null) return condition;
        if (typeof condition.value !== "boolean") {
          return {
            value: null,
            diagnostics: [
              ...condition.diagnostics,
              typeMismatch("Conditional expression requires a boolean condition.", expression.condition.range),
            ],
          };
        }
        const branch = condition.value ? expression.whenTrue : expression.whenFalse;
        const selected = this.evaluateNode(branch, state, spatial);
        return {
          value: selected.value,
          diagnostics: [...condition.diagnostics, ...selected.diagnostics],
        };
      }
      case "bound-error-expression":
        return failure(
          "expression-unbound-node",
          "Expression contains an unbound recovery node.",
          expression.range,
        );
    }
  }

  private evaluateBinary(
    expression: Extract<BoundExpression, { type: "bound-binary-expression" }>,
    state: StateReadView,
    spatial: SpatialValueProvider | undefined,
  ): NodeEvaluation {
    const left = this.evaluateNode(expression.left, state, spatial);
    if (left.value === null) return left;

    if (expression.operator === "&&" || expression.operator === "||") {
      if (typeof left.value !== "boolean") {
        return {
          value: null,
          diagnostics: [
            ...left.diagnostics,
            typeMismatch(`Operator "${expression.operator}" requires boolean operands.`, expression.left.range),
          ],
        };
      }
      if (expression.operator === "&&" && !left.value) return { value: false, diagnostics: left.diagnostics };
      if (expression.operator === "||" && left.value) return { value: true, diagnostics: left.diagnostics };
    }

    const right = this.evaluateNode(expression.right, state, spatial);
    if (right.value === null) {
      return { value: null, diagnostics: [...left.diagnostics, ...right.diagnostics] };
    }
    const diagnostics = [...left.diagnostics, ...right.diagnostics];

    if (expression.operator === "/" && right.value === 0) {
      return {
        value: null,
        diagnostics: [{
          code: "expression-division-by-zero",
          severity: "error",
          message: "Division by zero is not a finite state value.",
          range: { ...expression.right.range },
        }],
      };
    }

    const value = evaluateBinaryOperator(expression.operator, left.value, right.value);
    if (value === null) {
      return {
        value: null,
        diagnostics: [
          ...diagnostics,
          typeMismatch(
            `Operator "${expression.operator}" cannot consume ${valueType(left.value)} and ${valueType(right.value)}.`,
            expression.range,
          ),
        ],
      };
    }
    return finiteResult(value, diagnostics, expression.range);
  }
}

function evaluateUnary(operator: UnaryExpressionOperator, value: StateValue): StateValue | null {
  if (operator === "!") return typeof value === "boolean" ? !value : null;
  if (typeof value !== "number") return null;
  return operator === "+" ? value : -value;
}

function evaluateBinaryOperator(
  operator: BinaryExpressionOperator,
  left: StateValue,
  right: StateValue,
): StateValue | null {
  if (operator === "==" || operator === "!=") {
    if (!isScalar(left) || !isScalar(right) || typeof left !== typeof right) return null;
    const equal = left === right;
    return operator === "==" ? equal : !equal;
  }
  if (operator === "&&" || operator === "||") {
    if (typeof left !== "boolean" || typeof right !== "boolean") return null;
    return operator === "&&" ? left && right : left || right;
  }
  if (typeof left !== "number" || typeof right !== "number") return null;
  switch (operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return left / right;
    case "<": return left < right;
    case "<=": return left <= right;
    case ">": return left > right;
    case ">=": return left >= right;
    default: return null;
  }
}

function applyAccessor(
  value: StateValue,
  accessor: "line" | "start" | "end",
  spatial: SpatialValueProvider | undefined,
): StatePointValue | StateDomainValue | null {
  if (accessor === "line") {
    return isPoint(value) ? spatial?.lineForPoint(value) ?? null : null;
  }
  if (!isDomain(value)) return null;
  return accessor === "start" ? { ...value.start } : { ...value.end };
}

function finiteResult(
  value: StateValue,
  diagnostics: ExpressionDiagnostic[],
  range: { start: number; end: number },
): NodeEvaluation {
  if (typeof value !== "number" || Number.isFinite(value)) return { value, diagnostics };
  return {
    value: null,
    diagnostics: [
      ...diagnostics,
      {
        code: "expression-non-finite-result",
        severity: "error",
        message: "Expression result must be finite for checkpoint serialization.",
        range: { ...range },
      },
    ],
  };
}

function failure(
  code: ExpressionDiagnostic["code"],
  message: string,
  range: { start: number; end: number },
): NodeEvaluation {
  return {
    value: null,
    diagnostics: [{ code, severity: "error", message, range: { ...range } }],
  };
}

function typeMismatch(message: string, range: { start: number; end: number }): ExpressionDiagnostic {
  return {
    code: "expression-type-mismatch",
    severity: "error",
    message,
    range: { ...range },
  };
}

function valueType(value: StateValue): string {
  return typeof value === "object" ? value.type : typeof value;
}

function isScalar(value: StateValue): value is number | string | boolean {
  return typeof value !== "object";
}

function isPoint(value: StateValue): value is StatePointValue {
  return typeof value === "object" && value.type === "point";
}

function isDomain(value: StateValue): value is StateDomainValue {
  return typeof value === "object" && value.type === "domain";
}
