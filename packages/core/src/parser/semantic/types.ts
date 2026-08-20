import type {
  ArgAst,
  BeatAst,
  CommandMemberAst,
  ConnectorAst,
  EasingAst,
  ErrorNodeAst,
  GranularityUnit,
  IdentifierAst,
  InvalidValueAst,
  ReferenceMemberAst,
  SentenceAst,
  StringLiteralAst,
  EventLiteralAst,
} from "../chainSyntax/types";
import type {
  MacroExpansionOrigin,
  ResolvedSubject,
  ScopeCommandFamily,
  ScopeDiagnostic,
} from "../scope/types";
import type { CommandArgumentUnit } from "../../types/command";
import type { BoundExpression, ExpressionEvaluationTiming } from "../expression/types";
import type { StateDomainValue, StatePointValue } from "../../state/StateStore";
import type {
  DiagnosticSeverity,
  SourceRange,
} from "../../types/diagnostics";

export type SemanticDiagnosticCode =
  | "semantic-unresolved-command"
  | "semantic-invalid-command-metadata"
  | "semantic-invalid-connector-duration"
  | "semantic-negative-connector-duration"
  | "semantic-legacy-timing-command"
  | "semantic-reference-deferred"
  | "semantic-value-deferred"
  | "semantic-invalid-value"
  | "semantic-syntax-member-invalid"
  | "semantic-sentence-kind-deferred";

export interface SemanticDiagnostic {
  code: SemanticDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: SourceRange;
}

export interface SemanticNumberValue {
  type: "number";
  value: number;
}

export interface SemanticTimeValue {
  type: "time";
  seconds: number;
  sourceUnit: "s" | "ms";
  defaultUnitApplied?: true;
}

export interface SemanticSpaceValue {
  type: "space";
  value: number;
  unit: "char" | "line" | "self" | "px";
  defaultUnitApplied?: true;
}

export interface SemanticAngleValue {
  type: "angle";
  value: number;
  unit: "deg";
  defaultUnitApplied?: true;
}

export interface SemanticRateValue {
  type: "rate";
  value: number;
  numeratorUnit?: "deg";
  denominatorUnit: "char" | "line" | "self" | "px";
}

export interface SemanticRelativeValue {
  type: "relative";
  operator: "+=" | "-=";
  value: number;
  unit?: CommandArgumentUnit;
  defaultUnitApplied?: true;
}

export interface SemanticStringValue {
  type: "string";
  value: string;
  quote: StringLiteralAst["quote"];
}

export interface SemanticBoolValue {
  type: "bool";
  value: boolean;
}

export interface SemanticEventValue {
  type: "event";
  event: EventLiteralAst["event"];
  signal?: string;
}

export interface SemanticDeferredValue {
  type: "deferred-value";
  reason: "name-ref" | "expression-slice";
  raw: string;
  expectedUnit: CommandArgumentUnit | null;
  sourceRange: SourceRange;
}

export interface SemanticStateExpressionValue {
  type: "state-expression";
  expression: BoundExpression;
  expectedUnit: CommandArgumentUnit | null;
  evaluationTiming: Extract<ExpressionEvaluationTiming, "trigger-record">;
  sourceRange: SourceRange;
}

export interface SemanticSpatialValue {
  type: "spatial";
  value: StatePointValue | StateDomainValue;
}

export interface SemanticInvalidValue {
  type: "invalid-value";
  reason: InvalidValueAst["reason"];
  raw: string;
}

export type SemanticRangeEndpoint =
  | SemanticNumberValue
  | SemanticTimeValue
  | SemanticSpaceValue
  | SemanticAngleValue
  | SemanticRelativeValue
  | SemanticStateExpressionValue
  | SemanticDeferredValue;

export interface SemanticRangeValue {
  type: "range";
  from: SemanticRangeEndpoint;
  durationSeconds: number | null;
  to: SemanticRangeEndpoint;
}

export type SemanticBoundValue =
  | SemanticNumberValue
  | SemanticTimeValue
  | SemanticSpaceValue
  | SemanticAngleValue
  | SemanticRateValue
  | SemanticRelativeValue
  | SemanticStringValue
  | SemanticBoolValue
  | SemanticEventValue
  | SemanticRangeValue
  | SemanticStateExpressionValue
  | SemanticSpatialValue
  | SemanticDeferredValue
  | SemanticInvalidValue;

export interface SemanticBoundArgument {
  source: ArgAst;
  name: string | null;
  sourceIndex: number;
  expectedUnit: CommandArgumentUnit | null;
  value: SemanticBoundValue;
}

export interface SemanticConnector {
  source: ConnectorAst;
  kind: "hold" | "ease";
  durationSeconds: number | null;
  easing: EasingAst | null;
}

export interface SemanticCommandMember {
  type: "semantic-command-member";
  source: CommandMemberAst | IdentifierAst;
  origin: "command-head" | "predicate";
  name: string;
  family: ScopeCommandFamily;
  metadata?: Readonly<Record<string, unknown>>;
  operator: "+" | "-" | null;
  args: SemanticBoundArgument[];
  granularity: GranularityUnit | null;
  blocking: boolean;
  blockingOrigin: "explicit" | "metadata" | "none";
}

export interface SemanticClauseMember {
  type: "semantic-clause-member";
  sourceRange: SourceRange;
  sentence: SemanticSentence;
  granularity: GranularityUnit | null;
  blocking: boolean;
  canonicalization: "inner-terminal-blocking-to-clause" | null;
  /** Expansion provenance is absent for ordinary source clauses. */
  origin?: MacroExpansionOrigin;
}

export interface SemanticDeferredMember {
  type: "semantic-deferred-member";
  source: ReferenceMemberAst | ErrorNodeAst | CommandMemberAst | IdentifierAst;
  reason:
    | "reference"
    | "syntax-error"
    | "unresolved-command"
    | "legacy-timing-command";
}

export type SemanticExecutableMember = SemanticCommandMember | SemanticClauseMember;
export type SemanticMember = SemanticExecutableMember | SemanticDeferredMember;

export interface SemanticBeat {
  source: BeatAst | null;
  connectorBefore: SemanticConnector | null;
  members: SemanticMember[];
}

export interface SemanticSentence {
  source: SentenceAst;
  subject: ResolvedSubject | null;
  commandHeadInserted: boolean;
  beats: SemanticBeat[];
  diagnostics: SemanticDiagnostic[];
  complete: boolean;
}

export interface SemanticLoweringResult {
  sentences: SemanticSentence[];
  diagnostics: SemanticDiagnostic[];
  upstreamDiagnostics: ScopeDiagnostic[];
  complete: boolean;
}

export interface SemanticSentenceLoweringOptions {
  /** ObjectMutationLowerer owns member-op sentences and opts into their command lowering. */
  allowMemberOperation?: boolean;
}

export interface RevealUnit {
  id: string;
  revealAtSeconds: number;
}

export interface UnitRevealPlan {
  char: readonly RevealUnit[];
  group: readonly RevealUnit[];
  block: readonly RevealUnit[];
}

export type TimingDiagnosticCode =
  | "timing-invalid-connector"
  | "timing-deferred-member"
  | "timing-missing-reveal-plan"
  | "timing-invalid-reveal-unit"
  | "timing-duplicate-reveal-unit";

export interface TimingDiagnostic {
  code: TimingDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: SourceRange;
}

export interface TimedMemberInstance {
  id: string;
  beatIndex: number;
  memberIndex: number;
  member: SemanticExecutableMember;
  unitKind: GranularityUnit | null;
  unitId: string | null;
  nominalStartSeconds: number;
  dependencyMode: "none" | "unit" | "beat";
  dependsOnInstanceIds: string[];
}

export interface TimedBeat {
  beatIndex: number;
  source: BeatAst | null;
  connectorBefore: SemanticConnector | null;
  nominalOffsetSeconds: number;
  instances: TimedMemberInstance[];
}

export interface TimedSentence {
  source: SentenceAst;
  beats: TimedBeat[];
  diagnostics: TimingDiagnostic[];
}
