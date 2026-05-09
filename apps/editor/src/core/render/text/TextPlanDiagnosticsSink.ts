import { ConsoleDiagnosticsSink } from "../../diagnostics/ConsoleDiagnosticsSink";
import { diagnosticsCollector } from "../../diagnostics/DiagnosticsCollector";
import type { RuntimeParagraphExecutionPlan } from "../../execution/paragraphExecutionPlan";
import type { DiagnosticEvent } from "../../types";

export class TextPlanDiagnosticsSink {
  public static reportPlan(plan: RuntimeParagraphExecutionPlan) {
    const normalized = (plan.diagnostics ?? []).map((diagnostic) => this.normalize(diagnostic));
    diagnosticsCollector.reportDiagnostics(normalized);
    ConsoleDiagnosticsSink.reportMany(normalized);
  }

  public static warnMissingChainPlan(tokenIdx: number, line?: number) {
    const diagnostic = this.normalize({
      severity: "warning",
      code: "missing_chain_plan",
      message: `Missing chain plan for token ${tokenIdx}; falling back to char_stagger via hold:char.`,
      line,
    });
    diagnosticsCollector.reportDiagnostic(diagnostic);
    ConsoleDiagnosticsSink.report(diagnostic);
  }

  private static normalize(diagnostic: DiagnosticEvent): DiagnosticEvent {
    return {
      ...diagnostic,
      subsystem: diagnostic.subsystem ?? "execution",
    };
  }
}
