import type { SourceRange } from "../../types/diagnostics";
import type { StateReadView } from "../../state/StateStore";
import type {
  BoundExpression,
  ExpressionDiagnostic,
  SpatialValueProvider,
} from "../expression/types";
import type { DocumentDiagnostic } from "../document/types";

export type ControlDiagnosticCode =
  | "control-duplicate-anchor"
  | "control-undefined-anchor"
  | "control-presence-non-boolean";

export interface ControlDiagnostic {
  code: ControlDiagnosticCode;
  severity: "error";
  message: string;
  range: SourceRange;
  relatedRange?: SourceRange;
}

export interface AnchorLocation {
  id: string;
  name: string;
  sceneIndex: number;
  lineIndex: number;
  position: { offset: number };
  declarationRange: SourceRange;
  rendered: boolean;
}

export interface ParagraphPresenceSeed {
  type: "paragraph-presence-seed";
  id: string;
  paragraphId: string;
  sceneIndex: number;
  range: SourceRange;
  conditions: BoundExpression[];
  evaluationTiming: "scene-bake";
}

export interface ControlEdgeSeed {
  type: "control-edge-seed";
  id: string;
  sourceKind: "goto" | "routing";
  sourceSceneIndex: number;
  sourceLineIndex: number;
  sourcePosition: { offset: number };
  sourceRange: SourceRange;
  branchIndex: number;
  condition: BoundExpression | null;
  targetName: string;
  targetRange: SourceRange;
  targetAnchorId: string | null;
  targetPosition: { offset: number } | null;
  evaluationTiming: "edge-arrival";
}

export interface ControlFlowLoweringResult {
  anchors: AnchorLocation[];
  presenceSeeds: ParagraphPresenceSeed[];
  edgeSeeds: ControlEdgeSeed[];
  documentDiagnostics: DocumentDiagnostic[];
  diagnostics: ControlDiagnostic[];
  expressionDiagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export interface ParagraphPresenceEvaluationContext {
  state: StateReadView;
  spatial?: SpatialValueProvider;
}

export interface ParagraphPresenceEvaluationResult {
  present: boolean | null;
  diagnostics: Array<ControlDiagnostic | ExpressionDiagnostic>;
  complete: boolean;
}
