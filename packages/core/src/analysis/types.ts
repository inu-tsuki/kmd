import type { SegmentGraph, SegmentGraphEdge } from '../graph/types';
import type { DocumentAst } from '../parser/document/types';
import type { ScopeCommandFamily } from '../parser/scope/types';
import type { StateInspectionEntry } from '../state/StateStore';
import type {
  DiagnosticEvent,
  SourceRange,
} from '../types/diagnostics';

/**
 * Compile-time readonly view used by the shared editor/LSP analysis snapshot.
 * The compiler may share backing objects with `CompiledKmdDocument`; consumers
 * cannot mutate either containers or nested leaves through this public view.
 */
export type KmdReadonly<T> = T extends (...args: infer _TArgs) => infer _TReturn
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly KmdReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: KmdReadonly<T[TKey]> }
      : T;

export type KmdFoldingRangeKind = 'fence' | 'anchor';

export interface KmdFoldingRange {
  readonly kind: KmdFoldingRangeKind;
  /** Zero-based line indexes. */
  readonly startLine: number;
  readonly endLine: number;
  readonly range: KmdReadonly<SourceRange>;
  readonly label: string;
}

export interface KmdSegmentBoundary {
  readonly nodeId: string;
  readonly sceneIndex: number;
  /** Zero-based source line. */
  readonly line: number;
  readonly range: KmdReadonly<SourceRange>;
  readonly defaultPathIndex: number | null;
}

export interface KmdDefaultPathMarker {
  readonly nodeId: string;
  readonly label: string;
  readonly sceneIndex: number;
  /** Zero-based source line. */
  readonly line: number;
  readonly range: KmdReadonly<SourceRange>;
  readonly pathIndex: number;
  readonly pathLength: number;
}

export interface KmdCommandInspectionEntry {
  readonly name: string;
  readonly family: ScopeCommandFamily | null;
  readonly role: 'head' | 'predicate';
  readonly range: KmdReadonly<SourceRange>;
  readonly metadata: KmdReadonly<Record<string, unknown>> | null;
}

export interface KmdStateInspectionSnapshot {
  readonly document: readonly KmdReadonly<StateInspectionEntry>[];
  readonly scene: readonly KmdReadonly<StateInspectionEntry>[];
  readonly appliedAssignmentIds: readonly string[];
  readonly diagnostics: readonly KmdReadonly<DiagnosticEvent>[];
}

export interface KmdGraphInspectionSnapshot {
  readonly entryNodeId: string;
  readonly defaultPath: readonly string[];
  readonly edges: readonly KmdReadonly<SegmentGraphEdge>[];
  readonly diagnostics: readonly KmdReadonly<DiagnosticEvent>[];
}

export interface KmdDocumentInspectionSnapshot {
  readonly commands: readonly KmdCommandInspectionEntry[];
  readonly state: KmdStateInspectionSnapshot;
  readonly graph: KmdGraphInspectionSnapshot;
}

export interface KmdDocumentAnalysis {
  readonly schemaVersion: 1;
  readonly sourceLength: number;
  readonly document: KmdReadonly<DocumentAst>;
  readonly graph: KmdReadonly<SegmentGraph>;
  readonly diagnostics: readonly KmdReadonly<DiagnosticEvent>[];
  readonly foldingRanges: readonly KmdFoldingRange[];
  readonly segmentBoundaries: readonly KmdSegmentBoundary[];
  readonly defaultPathMarkers: readonly KmdDefaultPathMarker[];
  readonly inspector: KmdDocumentInspectionSnapshot;
  readonly complete: boolean;
}
