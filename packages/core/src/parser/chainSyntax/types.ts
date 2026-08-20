import type {
  DiagnosticSeverity,
  SourceRange,
} from "../../types/diagnostics";

export type { SourceRange };

export interface SyntaxNodeBase {
  raw: string;
  range: SourceRange;
}

export type ChainDiagnosticCode =
  | "chain-unclosed-argument-list"
  | "chain-unclosed-subclause"
  | "chain-unclosed-reference"
  | "chain-unclosed-string"
  | "chain-empty-member"
  | "chain-missing-beat"
  | "chain-invalid-granularity"
  | "chain-invalid-quantity"
  | "chain-invalid-argument"
  | "chain-unexpected-token"
  | "chain-easing-out-of-range"
  | "chain-parallel-not-enabled";

export interface ChainDiagnostic {
  code: ChainDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: SourceRange;
}

export interface IdentifierAst extends SyntaxNodeBase {
  type: "identifier";
  name: string;
}

export interface NameRefAst extends SyntaxNodeBase {
  type: "name-ref";
  path: IdentifierAst[];
}

export interface ExpressionSliceAst extends SyntaxNodeBase {
  type: "expression-slice";
  delimited: string;
}

export interface NumberLiteralAst extends SyntaxNodeBase {
  type: "number-literal";
  value: number;
}

export interface StringLiteralAst extends SyntaxNodeBase {
  type: "string-literal";
  value: string;
  quote: "\"" | "'";
}

export interface BoolLiteralAst extends SyntaxNodeBase {
  type: "bool-literal";
  value: boolean;
}

export type TimeUnit = "s" | "ms";

export interface TimeQuantityAst extends SyntaxNodeBase {
  type: "time-quantity";
  value: number;
  unit: TimeUnit;
}

export type SpaceUnit = "char" | "line" | "self" | "px";

export interface SpaceQuantityAst extends SyntaxNodeBase {
  type: "space-quantity";
  value: number;
  unit: SpaceUnit;
}

export interface AngleQuantityAst extends SyntaxNodeBase {
  type: "angle-quantity";
  value: number;
  unit: "deg";
}

export interface RateQuantityAst extends SyntaxNodeBase {
  type: "rate-quantity";
  value: number;
  numeratorUnit?: "deg";
  denominatorUnit: SpaceUnit;
}

export interface RelativeQuantityAst extends SyntaxNodeBase {
  type: "relative-quantity";
  operator: "+=" | "-=";
  value: number;
}

export type RangeEndpointAst =
  | NumberLiteralAst
  | TimeQuantityAst
  | SpaceQuantityAst
  | RelativeQuantityAst
  | NameRefAst
  | ExpressionSliceAst;

export interface RangeLiteralAst extends SyntaxNodeBase {
  type: "range-literal";
  from: RangeEndpointAst;
  duration?: TimeQuantityAst;
  to: RangeEndpointAst;
}

export interface EventLiteralAst extends SyntaxNodeBase {
  type: "event-literal";
  event: "click" | "signal";
  signal?: string;
}

export type LiteralAst =
  | NumberLiteralAst
  | StringLiteralAst
  | BoolLiteralAst
  | TimeQuantityAst
  | SpaceQuantityAst
  | AngleQuantityAst
  | RateQuantityAst
  | RelativeQuantityAst
  | RangeLiteralAst
  | EventLiteralAst;

export interface InvalidValueAst extends SyntaxNodeBase {
  type: "invalid-value";
  reason: "invalid-quantity" | "unclosed-string" | "unexpected-token";
}

export interface LiteralParseResult {
  value: LiteralAst | InvalidValueAst;
  diagnostics: ChainDiagnostic[];
}

export interface SelectorSubjectAst extends SyntaxNodeBase {
  type: "selector-subject";
  content: string;
}

export interface IdentifierSubjectAst extends SyntaxNodeBase {
  type: "identifier-subject";
  name: IdentifierAst;
}

export interface DotSubjectAst extends SyntaxNodeBase {
  type: "dot-subject";
}

export type SubjectAst = SelectorSubjectAst | IdentifierSubjectAst | DotSubjectAst;

export type GranularityUnit = "char" | "group" | "block";

export interface GranularityAst extends SyntaxNodeBase {
  type: "granularity";
  unit: GranularityUnit;
}

export interface NamedEasingAst extends SyntaxNodeBase {
  type: "named-easing";
  name: IdentifierAst;
}

export interface BezierEasingAst extends SyntaxNodeBase {
  type: "bezier-easing";
  x1: NumberLiteralAst;
  y1: NumberLiteralAst;
  x2: NumberLiteralAst;
  y2: NumberLiteralAst;
}

export type EasingAst = NamedEasingAst | BezierEasingAst;

export interface ConnectorAst extends SyntaxNodeBase {
  type: "connector";
  kind: "hold" | "ease";
  duration: TimeQuantityAst | InvalidValueAst;
  easing: EasingAst | null;
}

export type ValueAst =
  | LiteralAst
  | NameRefAst
  | ExpressionSliceAst
  | InvalidValueAst;

export interface ArgAst extends SyntaxNodeBase {
  type: "arg";
  name: IdentifierAst | null;
  value: ValueAst;
}

export interface CommandMemberAst extends SyntaxNodeBase {
  type: "command-member";
  op: "+" | "-" | null;
  name: IdentifierAst;
  granularity: GranularityAst | null;
  args: ArgAst[];
  blocking: boolean;
}

export interface ClauseMemberAst extends SyntaxNodeBase {
  type: "clause-member";
  sentence: SentenceAst;
  granularity: GranularityAst | null;
  blocking: boolean;
}

export interface ReferenceMemberAst extends SyntaxNodeBase {
  type: "reference-member";
  form: "name" | "expr";
  delimited: string;
}

export interface ErrorNodeAst extends SyntaxNodeBase {
  type: "error-node";
  context: "member" | "beat";
}

export type MemberAst =
  | CommandMemberAst
  | ClauseMemberAst
  | ReferenceMemberAst
  | ErrorNodeAst;

export interface BeatAst extends SyntaxNodeBase {
  type: "beat";
  connectorBefore: ConnectorAst | null;
  members: MemberAst[];
}

export interface SentencePayload {
  name?: IdentifierAst;
  path?: IdentifierAst[];
  slice?: ExpressionSliceAst;
}

export interface SentenceAst extends SyntaxNodeBase {
  type: "sentence";
  kind: "predicate" | "definition" | "assignment" | "member-op";
  subject: SubjectAst | null;
  beats: BeatAst[];
  payload?: SentencePayload;
}

export interface SentenceSeparatorAst extends SyntaxNodeBase {
  type: "sentence-separator";
  kind: "slot" | "parallel";
}

export interface ChainExpressionAst extends SyntaxNodeBase {
  type: "chain-expression";
  sentences: SentenceAst[];
  separators: SentenceSeparatorAst[];
}

export interface ChainSyntaxParseResult {
  expression: ChainExpressionAst;
  diagnostics: ChainDiagnostic[];
}
