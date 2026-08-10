import type { DiagnosticEvent } from "../types";

export class ConsoleDiagnosticsSink {
  public static report(diagnostic: DiagnosticEvent) {
    const subsystem = diagnostic.subsystem ? `[${diagnostic.subsystem}] ` : "";
    const code = diagnostic.code ? `[${diagnostic.code}] ` : "";
    const message = `${subsystem}${code}${diagnostic.message}`;
    const context = diagnostic.origin ?? (diagnostic.line !== undefined ? { line: diagnostic.line } : undefined);

    if (diagnostic.severity === "error") {
      if (context) {
        console.error(message, context);
      } else {
        console.error(message);
      }
      return;
    }

    if (diagnostic.severity === "warning") {
      if (context) {
        console.warn(message, context);
      } else {
        console.warn(message);
      }
      return;
    }

    if (context) {
      console.info(message, context);
    } else {
      console.info(message);
    }
  }

  public static reportMany(diagnostics: Iterable<DiagnosticEvent>) {
    for (const diagnostic of diagnostics) {
      this.report(diagnostic);
    }
  }
}
