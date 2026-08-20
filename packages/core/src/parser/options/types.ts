import type { DiagnosticSeverity, SourceRange } from "../../types/diagnostics";

export type OptionValue = number | string | boolean;
export type OptionScope = "document-only" | "cascading";

export interface OptionPatchEntry {
  key: string;
  value: unknown;
  range: SourceRange;
}

export interface OptionDefinition {
  scope: OptionScope;
  validate(value: unknown): value is OptionValue;
}

export type OptionSchema = Readonly<Record<string, OptionDefinition>>;

export type OptionDiagnosticCode =
  | "option-invalid-value"
  | "option-document-only"
  | "option-unknown-paragraph-key"
  | "option-normalized-alias"
  | "option-unsupported-mode";

export interface OptionDiagnostic {
  code: OptionDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: SourceRange;
}

export interface OptionResolution {
  values: Readonly<Record<string, OptionValue>>;
  diagnostics: OptionDiagnostic[];
}
