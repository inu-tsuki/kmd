import type { AuditEvent, DiagnosticEvent } from "../types";
import { auditBus } from "./AuditBus";

const MAX_DIAGNOSTICS = 500;
const MAX_COLLECTED_AUDITS = 500;

export interface DiagnosticsSnapshot {
  diagnostics: DiagnosticEvent[];
  audits: AuditEvent[];
}

export class DiagnosticsCollector {
  private diagnostics: DiagnosticEvent[] = [];
  private audits: AuditEvent[] = [];

  public reportDiagnostic(diagnostic: DiagnosticEvent) {
    this.pushBounded(this.diagnostics, diagnostic, MAX_DIAGNOSTICS);
  }

  public reportDiagnostics(diagnostics: Iterable<DiagnosticEvent>) {
    for (const diagnostic of diagnostics) {
      this.reportDiagnostic(diagnostic);
    }
  }

  public recordAudit(event: AuditEvent) {
    this.pushBounded(this.audits, event, MAX_COLLECTED_AUDITS);
  }

  public recordAudits(events: Iterable<AuditEvent>) {
    for (const event of events) {
      this.recordAudit(event);
    }
  }

  public getDiagnostics() {
    return [...this.diagnostics];
  }

  public getAudits() {
    return [...this.audits];
  }

  public snapshot(): DiagnosticsSnapshot {
    return {
      diagnostics: this.getDiagnostics(),
      audits: this.getAudits(),
    };
  }

  public clear() {
    this.diagnostics = [];
    this.audits = [];
  }

  private pushBounded<T>(buffer: T[], entry: T, maxSize: number) {
    buffer.push(entry);
    const overflow = buffer.length - maxSize;
    if (overflow > 0) {
      buffer.splice(0, overflow);
    }
  }
}

export const diagnosticsCollector = new DiagnosticsCollector();

auditBus.subscribe((event) => {
  diagnosticsCollector.recordAudit(event);
});
