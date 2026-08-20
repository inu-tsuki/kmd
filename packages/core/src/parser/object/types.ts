import type { SourceRange } from "../../types/diagnostics";
import type {
  SemanticDiagnostic,
  SemanticExecutableMember,
  SemanticSentence,
} from "../semantic/types";
import type {
  ResolvedSentence,
  ScopeDefinition,
  ScopeDiagnostic,
} from "../scope/types";

export type ObjectMutationOperation = "replace" | "upsert" | "remove";
export type ObjectMutationMemberPolicy =
  | "replace-chain"
  | "merge-arguments"
  | "remove-by-name";

export type ObjectMutationDiagnosticCode =
  | "object-mutation-target-required"
  | "object-mutation-invalid-operator"
  | "object-mutation-command-required"
  | "object-mutation-remove-arguments"
  | "object-mutation-semantic-incomplete";

export interface ObjectMutationDiagnostic {
  code: ObjectMutationDiagnosticCode;
  severity: "error";
  message: string;
  range: SourceRange;
}

export interface ObjectMutationSeed {
  id: string;
  sequence: number;
  scriptOffset: number;
  target: ScopeDefinition;
  operation: ObjectMutationOperation;
  memberPolicy: ObjectMutationMemberPolicy;
  semanticMembers: SemanticExecutableMember[];
  semanticSentence: SemanticSentence;
  source: ResolvedSentence;
  range: SourceRange;
}

export interface ObjectMutationLoweringResult {
  mutations: ObjectMutationSeed[];
  diagnostics: ObjectMutationDiagnostic[];
  semanticDiagnostics: SemanticDiagnostic[];
  scopeDiagnostics: ScopeDiagnostic[];
  complete: boolean;
}
