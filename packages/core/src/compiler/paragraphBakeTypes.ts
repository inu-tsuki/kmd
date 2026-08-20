import type { BakedContentNode, ContentMark } from '../parser/content/types';
import type { ParagraphPresenceSeed } from '../parser/control/types';
import type { SpatialValueProvider } from '../parser/expression/types';
import type { OptionValue } from '../parser/options/types';
import type { ResolvedSubject, SpatialSelector } from '../parser/scope/types';
import type {
  SemanticSentence,
  TimedSentence,
  UnitRevealPlan,
} from '../parser/semantic/types';
import type { StateReadView } from '../state/StateStore';
import type { DiagnosticEvent, SourceRange } from '../types/diagnostics';
import type { PlannedWaitGate } from '../execution/waitGateTypes';

export interface ParagraphTextUnit {
  id: string;
  text: string;
  sourceRange: SourceRange;
  /** Zero-based source line inherited from CompiledKmdLine. */
  sourceLine: number;
  lineId: string;
  marks: ContentMark[];
  /** Stable range-based identity for an enclosing explicit brace group. */
  braceGroupId: string | null;
  /** Group reveal identity; unbraced text uses one implicit group per line. */
  groupId: string;
  revealAtSeconds: number;
}

export interface BakedParagraphLine {
  id: string;
  sourceLine: number;
  range: SourceRange;
  bodyRange: SourceRange;
  activeFenceIds: string[];
  content: BakedContentNode[];
  text: string;
  unitIds: string[];
  complete: boolean;
}

export type ParagraphSentenceTargetKind =
  | 'text-domain'
  | 'text-point'
  | 'background'
  | 'stage'
  | 'layout-flow'
  | 'state'
  | 'definition'
  | 'unresolved';

export interface ParagraphSentenceTarget {
  kind: ParagraphSentenceTargetKind;
  subject: ResolvedSubject | null;
  selector: SpatialSelector | null;
  unitIds: string[];
}

export interface BakedSentencePlan {
  id: string;
  host: 'line' | 'paragraph';
  sourceLine: number;
  range: SourceRange;
  sentence: SemanticSentence;
  target: ParagraphSentenceTarget;
  revealPlan: UnitRevealPlan;
  timing: TimedSentence;
}

export interface ParagraphBakeContext {
  state: StateReadView;
  presenceSeeds: readonly ParagraphPresenceSeed[];
  spatial?: SpatialValueProvider;
}

/** Pure-data input for the later layout and execution lane middleware. */
export interface BakedParagraphPlan {
  paragraphId: string;
  sceneIndex: number;
  paragraphIndex: number;
  sourceRange: SourceRange;
  options: Readonly<Record<string, OptionValue>>;
  present: boolean | null;
  lines: BakedParagraphLine[];
  units: ParagraphTextUnit[];
  sentences: BakedSentencePlan[];
  waitGates: PlannedWaitGate[];
  diagnostics: DiagnosticEvent[];
  complete: boolean;
}
