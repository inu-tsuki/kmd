import { auditBus } from "../diagnostics/AuditBus";
import { diagnosticsCollector } from "../diagnostics/DiagnosticsCollector";
import { AnchorCoordinator } from "./AnchorCoordinator";
import type {
  LayoutAuditRecord,
  LayoutContext,
  LayoutPreflightResult,
  LayoutResult,
} from "./types";

type LayoutAuditMeta = {
  isFlowBroken: boolean;
  justMoved: boolean;
};

type AnnotatedLayoutResult = LayoutResult & {
  __auditMeta?: LayoutAuditMeta;
};

export class LayoutAuditEmitter {
  public static stampResultMeta(context: LayoutContext, result: LayoutResult) {
    (result as AnnotatedLayoutResult).__auditMeta = {
      isFlowBroken: context.isFlowBroken,
      justMoved: context.justMoved,
    };
  }

  public static buildAuditLog(
    context: LayoutContext,
    results: LayoutResult[],
  ): LayoutAuditRecord[] {
    return results.map((result) => {
      const charText = result.item.charData?.char?.text ?? "";
      const meta = (result as AnnotatedLayoutResult).__auditMeta;
      const local = {
        x: result.x + (result.displayOffsetX ?? 0),
        y: result.y + (result.displayOffsetY ?? 0),
      };

      return {
        text: charText,
        local,
        global: AnchorCoordinator.toGlobal(context, local),
        inFlow: result.inFlow,
        isFlowBroken: meta?.isFlowBroken ?? false,
        justMoved: meta?.justMoved ?? false,
      };
    });
  }

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
    auditRecordCount: number;
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
        auditRecordCount: params.auditRecordCount,
        markerCount: params.markerCount,
        estimatedBounds: params.estimatedBounds,
      },
    });
  }
}
