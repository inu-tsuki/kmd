import { auditBus } from "../diagnostics/AuditBus";
import { diagnosticsCollector } from "../diagnostics/DiagnosticsCollector";
import type { DiagnosticEvent } from "../types";
import type { StageAuditEntry, StageConflictDiagnostic } from "./types";

const MAX_STAGE_AUDIT_ENTRIES = 300;
const MAX_STAGE_CONFLICTS = 150;

export interface StageAuditPort {
  record(entry: StageAuditEntry): void;
  getEntries(): StageAuditEntry[];
  clear(): void;
  reportConflict(diagnostic: StageConflictDiagnostic): void;
  getConflicts(): StageConflictDiagnostic[];
}

export class MemoryStageAuditPort implements StageAuditPort {
  private entries: StageAuditEntry[] = [];
  private conflicts: StageConflictDiagnostic[] = [];

  public record(entry: StageAuditEntry) {
    this.pushBounded(this.entries, entry, MAX_STAGE_AUDIT_ENTRIES);
  }

  public getEntries() {
    return [...this.entries];
  }

  public clear() {
    this.entries = [];
    this.conflicts = [];
  }

  public reportConflict(diagnostic: StageConflictDiagnostic) {
    this.pushBounded(this.conflicts, diagnostic, MAX_STAGE_CONFLICTS);
  }

  public getConflicts() {
    return [...this.conflicts];
  }

  private pushBounded<T>(buffer: T[], entry: T, maxSize: number) {
    buffer.push(entry);
    const overflow = buffer.length - maxSize;
    if (overflow > 0) {
      buffer.splice(0, overflow);
    }
  }
}

export class UnifiedStageAuditPort extends MemoryStageAuditPort {
  public override record(entry: StageAuditEntry) {
    super.record(entry);
    auditBus.emit({
      phase: "runtime",
      subsystem: "stage",
      severity: entry.overwriteWarning ? "warn" : "info",
      payload: {
        event: "stage.effect.applied",
        effect: entry.effect,
        params: entry.params,
        overwriteWarning: entry.overwriteWarning,
        cameraBefore: entry.cameraBefore,
        cameraTarget: entry.cameraTarget,
        worldState: entry.worldState,
      },
    });
  }

  public override reportConflict(diagnostic: StageConflictDiagnostic) {
    super.reportConflict(diagnostic);

    const normalized: DiagnosticEvent = {
      severity: diagnostic.severity,
      subsystem: "stage",
      code: "stage_conflict",
      message: diagnostic.message,
    };
    diagnosticsCollector.reportDiagnostic(normalized);

    auditBus.emit({
      phase: "runtime",
      subsystem: "stage",
      severity: diagnostic.severity === "error" ? "error" : "warn",
      payload: {
        event: "stage.conflict",
        channel: diagnostic.channel,
        command: diagnostic.command,
        message: diagnostic.message,
      },
    });
  }
}
