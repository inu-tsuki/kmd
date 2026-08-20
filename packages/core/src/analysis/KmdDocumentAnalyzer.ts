import { KmdDocumentCompiler } from '../compiler/KmdDocumentCompiler';
import { ConsoleDiagnosticsSink } from '../diagnostics/ConsoleDiagnosticsSink';
import { diagnosticsCollector } from '../diagnostics/DiagnosticsCollector';
import type { ScopeCommandRegistryView } from '../parser/scope/types';
import type { KmdDocumentAnalysis } from './types';

export interface KmdDocumentAnalyzerOptions {
  registry?: ScopeCommandRegistryView;
}

/**
 * Compatibility read entry for editor and LSP consumers. The production
 * compiler owns parsing and all Phase B lowering; this wrapper only exposes the
 * analysis projection from that single compile pass.
 */
export class KmdDocumentAnalyzer {
  private readonly compiler: KmdDocumentCompiler;

  public constructor(options: KmdDocumentAnalyzerOptions = {}) {
    this.compiler = new KmdDocumentCompiler({ registry: options.registry });
  }

  public analyze(source: string): KmdDocumentAnalysis {
    return this.compiler.compile(source).analysis;
  }
}

export function analyzeKmdDocument(
  source: string,
  options: KmdDocumentAnalyzerOptions = {},
): KmdDocumentAnalysis {
  return new KmdDocumentAnalyzer(options).analyze(source);
}

/** Reports an already-computed snapshot, so callers never reparse only for logging. */
export function reportKmdDocumentAnalysis(analysis: KmdDocumentAnalysis): void {
  diagnosticsCollector.reportDiagnostics(analysis.diagnostics);
  ConsoleDiagnosticsSink.reportMany(analysis.diagnostics);
}
