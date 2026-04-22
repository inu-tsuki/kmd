import type { StageAuditEntry, StageConflictDiagnostic } from "./types";

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
    this.entries.push(entry);
  }

  public getEntries() {
    return [...this.entries];
  }

  public clear() {
    this.entries = [];
    this.conflicts = [];
  }

  public reportConflict(diagnostic: StageConflictDiagnostic) {
    this.conflicts.push(diagnostic);
  }

  public getConflicts() {
    return [...this.conflicts];
  }
}
