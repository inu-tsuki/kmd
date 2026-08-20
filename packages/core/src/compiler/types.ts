import type { KmdDocumentAnalysis } from '../analysis/types';
import type { SegmentGraph } from '../graph/types';
import type { BoundContentNode } from '../parser/content/types';
import type { ControlFlowLoweringResult } from '../parser/control/types';
import type { DocumentAst } from '../parser/document/types';
import type { ObjectMutationSeed } from '../parser/object/types';
import type { OptionValue } from '../parser/options/types';
import type { ScopeDefinition } from '../parser/scope/types';
import type { SemanticSentence } from '../parser/semantic/types';
import type { AssignmentSeed } from '../parser/state/types';
import type { StateEntry } from '../state/StateStore';
import type { DiagnosticEvent, SourceRange } from '../types/diagnostics';

export interface CompiledSentenceGroup {
  host: 'line' | 'paragraph';
  sourceLine: number;
  range: SourceRange;
  sentences: SemanticSentence[];
  complete: boolean;
}

export interface CompiledKmdLine {
  id: string;
  sceneIndex: number;
  paragraphId: string;
  /** Zero-based source line. */
  sourceLine: number;
  range: SourceRange;
  bodyRange: SourceRange;
  activeFenceIds: string[];
  content: BoundContentNode[];
  sentenceGroup: CompiledSentenceGroup | null;
  complete: boolean;
}

export interface CompiledKmdParagraph {
  id: string;
  sceneIndex: number;
  paragraphIndex: number;
  range: SourceRange;
  options: Readonly<Record<string, OptionValue>>;
  presenceSeedIds: string[];
  openingSentenceGroups: CompiledSentenceGroup[];
  lines: CompiledKmdLine[];
  complete: boolean;
}

export interface CompiledKmdScene {
  id: string;
  index: number;
  range: SourceRange;
  paragraphs: CompiledKmdParagraph[];
}

export interface CompiledKmdScope {
  definitions: readonly ScopeDefinition[];
  storeInitials: readonly StateEntry[];
  assignments: readonly AssignmentSeed[];
  objectMutations: readonly ObjectMutationSeed[];
}

/**
 * Phase B production front-end output. Names, command families, macro references,
 * argument units and expression bindings are settled; timed values remain bound
 * until their declared scene/edge/trigger evaluation point.
 */
export interface CompiledKmdDocument {
  schemaVersion: 1;
  source: string;
  sourceLength: number;
  syntax: DocumentAst;
  options: Readonly<Record<string, OptionValue>>;
  scope: CompiledKmdScope;
  scenes: CompiledKmdScene[];
  control: ControlFlowLoweringResult;
  graph: SegmentGraph;
  /** Sorted signal names referenced by event-pause syntax in this work. */
  signalNames: readonly string[];
  analysis: KmdDocumentAnalysis;
  diagnostics: DiagnosticEvent[];
  complete: boolean;
}
