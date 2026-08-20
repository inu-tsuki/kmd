import type { StateReadView } from "../../state/StateStore";
import type { SourceRange } from "../../types/diagnostics";
import type {
  ChainDiagnostic,
  SentenceAst,
} from "../chainSyntax/types";
import type {
  ExpressionAst,
  ExpressionDiagnostic,
} from "../expression/types";
import type {
  MacroExpansionOrigin,
  ResolvedExpression,
  ScopeDefinition,
  ScopeDiagnostic,
  SubjectResolutionContext,
} from "../scope/types";

export type MacroDiagnosticCode =
  | "macro-invalid-definition"
  | "macro-invalid-definition-body"
  | "macro-multiple-definition-sentences"
  | "macro-empty-reference"
  | "macro-empty-choice-condition"
  | "macro-empty-choice-true-branch"
  | "macro-unknown-reference"
  | "macro-reference-out-of-scope"
  | "macro-reference-kind-mismatch"
  | "macro-definition-unusable"
  | "macro-expansion-multiple-sentences"
  | "macro-expansion-invalid-sentence"
  | "macro-choice-condition-not-boolean"
  | "macro-expansion-cycle"
  | "macro-expansion-depth-exceeded";

export interface MacroDiagnostic {
  code: MacroDiagnosticCode;
  severity: "error";
  message: string;
  range: SourceRange;
}

export interface MacroDefinition {
  type: "macro-definition";
  id: string;
  name: string;
  sentence: SentenceAst;
  definitionRange: SourceRange;
  bodyRange: SourceRange;
  localTimelineTemplateId: string;
  complete: boolean;
}

export interface MacroDefinitionLoweringResult {
  definitions: ScopeDefinition<MacroDefinition>[];
  diagnostics: MacroDiagnostic[];
  syntaxDiagnostics: ChainDiagnostic[];
  scopeDiagnostics: readonly ScopeDiagnostic[];
  complete: boolean;
}

export interface MacroChoiceLeaf {
  type: "macro-choice-leaf";
  raw: string;
  range: SourceRange;
  implicitEmpty: boolean;
}

export interface MacroChoiceConditional {
  type: "macro-choice-conditional";
  range: SourceRange;
  condition: ExpressionAst;
  whenTrue: MacroChoiceNode;
  whenFalse: MacroChoiceNode;
}

export type MacroChoiceNode = MacroChoiceLeaf | MacroChoiceConditional;

export interface MacroChoiceParseResult {
  choice: MacroChoiceNode;
  diagnostics: MacroDiagnostic[];
  expressionDiagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export interface MacroExpansionInput {
  expression: ResolvedExpression;
  state: StateReadView;
  context?: SubjectResolutionContext;
}

export interface MacroExpansionResult {
  expression: ResolvedExpression;
  diagnostics: MacroDiagnostic[];
  syntaxDiagnostics: ChainDiagnostic[];
  expressionDiagnostics: ExpressionDiagnostic[];
  scopeDiagnostics: ScopeDiagnostic[];
  origins: MacroExpansionOrigin[];
  complete: boolean;
}
