import type { KmdDocumentAnalysis } from './types';

// Compile-only contract: analysis consumers cannot mutate the snapshot at
// either the array-container level or the nested leaf-field level.
declare const analysis: KmdDocumentAnalysis;

// @ts-expect-error Analysis arrays are readonly views.
analysis.foldingRanges.push(analysis.foldingRanges[0]!);
// @ts-expect-error Projection leaves are readonly views.
analysis.foldingRanges[0]!.label = 'changed';
// @ts-expect-error Structured diagnostic leaves are readonly views.
analysis.diagnostics[0]!.message = 'changed';
// @ts-expect-error Inspector entry leaves are readonly views.
analysis.inspector.commands[0]!.name = 'changed';
// @ts-expect-error Document AST nodes are exposed through a deep readonly view.
analysis.document.scenes[0]!.id = 'changed';
// @ts-expect-error Graph nodes are exposed through a deep readonly view.
analysis.graph.nodes[0]!.id = 'changed';
