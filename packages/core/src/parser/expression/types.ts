import type { DiagnosticSeverity, SourceRange } from "../../types/diagnostics";
import type { SpatialSelector } from "../scope/types";
import type {
  StateDomainValue,
  StateKey,
  StatePointValue,
  StateValue,
} from "../../state/StateStore";

export interface ExpressionNodeBase {
  raw: string;
  range: SourceRange;
}

export type ExpressionDiagnosticCode =
  | "expression-empty"
  | "expression-invalid-token"
  | "expression-unclosed-string"
  | "expression-expected-expression"
  | "expression-expected-closing-paren"
  | "expression-expected-conditional-colon"
  | "expression-call-not-supported"
  | "expression-trailing-input"
  | "expression-unknown-name"
  | "expression-non-value-symbol"
  | "expression-invalid-accessor"
  | "expression-unbound-node"
  | "expression-uninitialized-state"
  | "expression-type-mismatch"
  | "expression-division-by-zero"
  | "expression-non-finite-result"
  | "expression-spatial-value-unavailable";

export interface ExpressionDiagnostic {
  code: ExpressionDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: SourceRange;
}

export type ExpressionLiteralValue = number | string | boolean;

export interface LiteralExpression extends ExpressionNodeBase {
  type: "literal-expression";
  value: ExpressionLiteralValue;
}

export interface NameExpression extends ExpressionNodeBase {
  type: "name-expression";
  path: string[];
}

export type UnaryExpressionOperator = "!" | "+" | "-";

export interface UnaryExpression extends ExpressionNodeBase {
  type: "unary-expression";
  operator: UnaryExpressionOperator;
  operand: ExpressionAst;
}

export type BinaryExpressionOperator =
  | "*"
  | "/"
  | "+"
  | "-"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

export interface BinaryExpression extends ExpressionNodeBase {
  type: "binary-expression";
  operator: BinaryExpressionOperator;
  left: ExpressionAst;
  right: ExpressionAst;
}

export interface ConditionalExpression extends ExpressionNodeBase {
  type: "conditional-expression";
  condition: ExpressionAst;
  whenTrue: ExpressionAst;
  whenFalse: ExpressionAst;
}

export interface GroupExpression extends ExpressionNodeBase {
  type: "group-expression";
  expression: ExpressionAst;
}

export interface ErrorExpression extends ExpressionNodeBase {
  type: "error-expression";
}

export type ExpressionAst =
  | LiteralExpression
  | NameExpression
  | UnaryExpression
  | BinaryExpression
  | ConditionalExpression
  | GroupExpression
  | ErrorExpression;

export interface ExpressionParseResult {
  expression: ExpressionAst;
  diagnostics: ExpressionDiagnostic[];
}

export interface BoundLiteralExpression extends ExpressionNodeBase {
  type: "bound-literal-expression";
  value: ExpressionLiteralValue;
}

export interface BoundStateRefExpression extends ExpressionNodeBase {
  type: "bound-state-ref-expression";
  key: StateKey;
}

export interface BoundSpatialRefExpression extends ExpressionNodeBase {
  type: "bound-spatial-ref-expression";
  selector: SpatialSelector;
}

export interface BoundAccessorExpression extends ExpressionNodeBase {
  type: "bound-accessor-expression";
  target: BoundExpression;
  accessor: "line" | "start" | "end";
}

export interface BoundUnaryExpression extends ExpressionNodeBase {
  type: "bound-unary-expression";
  operator: UnaryExpressionOperator;
  operand: BoundExpression;
}

export interface BoundBinaryExpression extends ExpressionNodeBase {
  type: "bound-binary-expression";
  operator: BinaryExpressionOperator;
  left: BoundExpression;
  right: BoundExpression;
}

export interface BoundConditionalExpression extends ExpressionNodeBase {
  type: "bound-conditional-expression";
  condition: BoundExpression;
  whenTrue: BoundExpression;
  whenFalse: BoundExpression;
}

export interface BoundErrorExpression extends ExpressionNodeBase {
  type: "bound-error-expression";
}

export type BoundExpression =
  | BoundLiteralExpression
  | BoundStateRefExpression
  | BoundSpatialRefExpression
  | BoundAccessorExpression
  | BoundUnaryExpression
  | BoundBinaryExpression
  | BoundConditionalExpression
  | BoundErrorExpression;

export interface ExpressionBindingResult {
  expression: BoundExpression;
  diagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export interface SpatialValueProvider {
  materialize(selector: SpatialSelector): StateValue | undefined;
  lineForPoint(point: StatePointValue): StateDomainValue | undefined;
}

export interface ExpressionEvaluationResult {
  value: StateValue | null;
  diagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export type ExpressionHost =
  | "macro-expansion"
  | "inline-text"
  | "paragraph-presence"
  | "control-edge"
  | "command-argument"
  | "assignment";

export type ExpressionEvaluationTiming =
  | "scene-build"
  | "scene-bake"
  | "edge-arrival"
  | "trigger-record"
  | "assignment-arrival";
