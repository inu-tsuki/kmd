import type { SourceRange } from '../../types/diagnostics';

export type InteractiveDiagnosticCode =
  | 'interactive-undefined-anchor'
  | 'interactive-mode-unsupported';

export interface InteractiveDiagnostic {
  code: InteractiveDiagnosticCode;
  severity: 'error';
  message: string;
  range: SourceRange;
}

export interface InteractiveOutcomeSeed {
  id: string;
  branchIndex: number;
  outcome: string | null;
  sourceRange: SourceRange;
  targetName: string;
  targetRange: SourceRange;
  targetAnchorId: string | null;
  targetPosition: { offset: number } | null;
}

export interface InteractiveSegmentSeed {
  type: 'interactive-segment-seed';
  id: string;
  sourceSceneIndex: number;
  sourceLineIndex: number;
  sourcePosition: { offset: number };
  sourceRange: SourceRange;
  moduleId: string;
  moduleIdRange: SourceRange;
  outcomes: InteractiveOutcomeSeed[];
}

export interface InteractiveSegmentLoweringResult {
  seeds: InteractiveSegmentSeed[];
  diagnostics: InteractiveDiagnostic[];
  complete: boolean;
}
