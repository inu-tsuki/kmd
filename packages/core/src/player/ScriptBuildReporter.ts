import { auditBus } from "../diagnostics/AuditBus";
import { ConsoleDiagnosticsSink } from "../diagnostics/ConsoleDiagnosticsSink";
import { diagnosticsCollector } from "../diagnostics/DiagnosticsCollector";
import type { KMDParseResult } from "../parser/types";
import type { Segment } from "../state/Segment";
import type { DiagnosticEvent } from "../types";

export class ScriptBuildReporter {
  public static beginBuildSession() {
    auditBus.clear();
    diagnosticsCollector.clear();
  }

  public static reportLoadFailure(sourcePath: string, error: unknown) {
    const diagnostic = this.normalize({
      severity: "error",
      code: "script_load_failed",
      message: `Failed to fetch KMD source: ${String(error)}`,
      origin: { path: sourcePath },
    });
    diagnosticsCollector.reportDiagnostic(diagnostic);
    ConsoleDiagnosticsSink.report(diagnostic);
  }

  public static reportParseResult(result: KMDParseResult, mode: string) {
    const parserDiagnostics = (result.diagnostics ?? []).map((diagnostic) =>
      this.normalize({ ...diagnostic, subsystem: diagnostic.subsystem ?? "parser" }),
    );
    diagnosticsCollector.reportDiagnostics(parserDiagnostics);
    ConsoleDiagnosticsSink.reportMany(parserDiagnostics);

    const hasError = parserDiagnostics.some((diagnostic) => diagnostic.severity === "error");
    const hasWarning = parserDiagnostics.some((diagnostic) => diagnostic.severity === "warning");

    auditBus.emit({
      phase: "build",
      subsystem: "script",
      severity: hasError ? "error" : hasWarning ? "warn" : "info",
      payload: {
        event: "script.parse.complete",
        paragraphCount: result.paragraphs.length,
        diagnosticCount: parserDiagnostics.length,
        mode,
      },
    });
  }

  public static reportSegmentBuilt(segment: Segment) {
    auditBus.emit({
      phase: "build",
      subsystem: "script",
      severity: "info",
      payload: {
        event: "script.segment.built",
        duration: segment.duration,
        paragraphCount: segment.paragraphs.length,
        behaviorCount: segment.behaviors.length,
      },
    });
  }

  private static normalize(diagnostic: DiagnosticEvent): DiagnosticEvent {
    return {
      ...diagnostic,
      subsystem: diagnostic.subsystem ?? "script",
    };
  }
}
