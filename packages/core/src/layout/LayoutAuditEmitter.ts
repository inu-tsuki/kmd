import { auditBus } from "../diagnostics/AuditBus";
import { diagnosticsCollector } from "../diagnostics/DiagnosticsCollector";
import type {
  LayoutPreflightResult,
} from "./types";

export class LayoutAuditEmitter {
  public static emitPreflight(preflight: LayoutPreflightResult) {
    diagnosticsCollector.reportDiagnostics(preflight.diagnostics);
    auditBus.emit({
      phase: "layout",
      subsystem: "layout",
      severity: "info",
      payload: {
        event: "layout.preflight.complete",
        lineCount: preflight.lines.length,
        markerCount: preflight.anchors.markers.size,
        writtenMarkerCount: preflight.anchors.writtenKeys.size,
      },
    });
  }

  public static emitCalculation(params: {
    resultCount: number;
    markerCount: number;
    estimatedBounds: LayoutPreflightResult["estimatedBounds"];
  }) {
    auditBus.emit({
      phase: "layout",
      subsystem: "layout",
      severity: "info",
      payload: {
        event: "layout.calculate.complete",
        resultCount: params.resultCount,
        markerCount: params.markerCount,
        estimatedBounds: params.estimatedBounds,
      },
    });
  }
}
