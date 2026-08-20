import type { SourceRange } from "../../types/diagnostics";
import type {
  StateEntry,
  StateKey,
  StateSnapshot,
} from "../../state/StateStore";
import type { SentenceAst } from "../chainSyntax/types";
import type {
  BoundExpression,
  ExpressionDiagnostic,
  ExpressionEvaluationTiming,
} from "../expression/types";
import type { ScopeDefinition, ScopeDiagnostic } from "../scope/types";

export interface FrontmatterVariableInput {
  name: string;
  value: unknown;
  range: SourceRange;
}

export interface StateSentenceInput {
  sentence: SentenceAst;
  sceneVisibleUntil: { offset: number };
}

export interface StateLoweringInput {
  documentVisibleUntil: { offset: number };
  frontmatterVariables?: readonly FrontmatterVariableInput[];
  sentences: readonly StateSentenceInput[];
}

export type StateLoweringDiagnosticCode =
  | "state-lowering-invalid-frontmatter-name"
  | "state-lowering-invalid-frontmatter-value"
  | "state-lowering-invalid-assignment-target"
  | "state-lowering-target-conflict"
  | "state-lowering-invalid-scene-interval";

export interface StateLoweringDiagnostic {
  code: StateLoweringDiagnosticCode;
  severity: "error";
  message: string;
  range: SourceRange;
}

export interface AssignmentSeed {
  id: string;
  sequence: number;
  scriptOffset: number;
  target: StateKey;
  expression: BoundExpression;
  evaluationTiming: Extract<ExpressionEvaluationTiming, "assignment-arrival">;
  range: SourceRange;
}

export interface DeferredStateDefinition {
  sentence: SentenceAst;
  sceneVisibleUntil: { offset: number };
  reason: "macro-or-object" | "invalid-non-state-syntax";
}

export interface StateLoweringResult {
  definitions: readonly ScopeDefinition[];
  storeInitials: StateEntry[];
  assignments: AssignmentSeed[];
  deferredDefinitions: DeferredStateDefinition[];
  diagnostics: StateLoweringDiagnostic[];
  expressionDiagnostics: ExpressionDiagnostic[];
  scopeDiagnostics: readonly ScopeDiagnostic[];
  complete: boolean;
}

export interface AssignmentFoldResult {
  appliedAssignmentIds: string[];
  diagnostics: ExpressionDiagnostic[];
  checkpoint: StateSnapshot;
  complete: boolean;
}
