export type DiagnosticSeverity = "info" | "warning" | "error";

export interface SourceRange {
  start: number;
  end: number;
}

export interface SourceOrigin {
  line?: number;
  range?: SourceRange;
  paragraphIndex?: number;
  segmentIndex?: number;
  tokenIndex?: number;
  charIndex?: number;
  path?: string;
}

export interface DiagnosticEvent {
  severity: DiagnosticSeverity;
  message: string;
  line?: number;
  range?: SourceRange;
  code?: string;
  subsystem?: string;
  origin?: SourceOrigin;
}

export interface AuditEvent {
  phase: string;
  subsystem: string;
  severity?: "debug" | "info" | "warn" | "error";
  origin?: SourceOrigin;
  payload?: Record<string, unknown>;
}
