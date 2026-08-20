export type DiagnosticSeverity = "info" | "warning" | "error";

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export interface SourceOrigin {
  readonly line?: number;
  readonly range?: SourceRange;
  readonly paragraphIndex?: number;
  readonly segmentIndex?: number;
  readonly tokenIndex?: number;
  readonly charIndex?: number;
  readonly path?: string;
}

export interface DiagnosticSuggestion {
  readonly label: string;
  readonly replacement: string;
  readonly range: SourceRange;
}

export interface DiagnosticEvent {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly line?: number;
  readonly range?: SourceRange;
  readonly code?: string;
  readonly subsystem?: string;
  readonly origin?: SourceOrigin;
  readonly suggestions?: readonly DiagnosticSuggestion[];
}

export interface AuditEvent {
  phase: string;
  subsystem: string;
  severity?: "debug" | "info" | "warn" | "error";
  origin?: SourceOrigin;
  payload?: Record<string, unknown>;
}
