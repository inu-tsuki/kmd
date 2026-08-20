import type { SourceRange } from '../types/diagnostics';
import type { BoundExpression } from '../parser/expression/types';

export type SegmentGraphNodeId = string;

export type SegmentGraphNodeKind =
  | 'paragraph-group'
  | 'control-point'
  | 'interactive'
  | 'empty';

export interface SegmentParagraphReference {
  id: string;
  sceneIndex: number;
  paragraphIndex: number;
  range: SourceRange;
}

/**
 * B3 只确定一个节点包含哪些段落，不创建 GSAP/Pixi 对象。生产切换时，单 Segment builder
 * 会把这份载荷烘焙成真正的 deterministic Segment，graph 层不需要依赖具体渲染后端。
 */
export interface DeterministicSegmentPlan {
  type: 'deterministic-segment-plan';
  id: string;
  sceneId: string;
  sceneIndex: number;
  paragraphIds: string[];
  paragraphs: SegmentParagraphReference[];
  range: SourceRange;
}

export interface InteractiveSegmentPlan {
  type: 'interactive-segment-plan';
  id: string;
  sceneId: string;
  sceneIndex: number;
  moduleId: string;
  outcomes: string[];
  hasFallback: boolean;
  range: SourceRange;
}

export type SegmentGraphNodePlan =
  | DeterministicSegmentPlan
  | InteractiveSegmentPlan;

export interface SegmentGraphAnchorReference {
  id: string;
  name: string;
  rendered: boolean;
  declarationRange: SourceRange;
}

export interface SegmentGraphControlPoint {
  sourceKind: 'goto' | 'routing';
  sourceLineIndex: number;
  sourceRange: SourceRange;
  edgeSeedIds: string[];
}

export type SegmentGraphEntryCheckpointReason =
  | 'graph-entry'
  | 'scene-entry'
  | 'anchor-target'
  | 'branch-target'
  | 'jump-target'
  | 'back-edge-target'
  | 'wait-resume-target';

export interface SegmentGraphEntryCheckpointRequirement {
  required: boolean;
  reasons: SegmentGraphEntryCheckpointReason[];
}

export interface SegmentGraphNode {
  id: SegmentGraphNodeId;
  order: number;
  sceneOrder: number;
  sceneId: string;
  sceneIndex: number;
  kind: SegmentGraphNodeKind;
  sourceRange: SourceRange;
  segment: SegmentGraphNodePlan;
  entryAnchors: SegmentGraphAnchorReference[];
  controlPoint: SegmentGraphControlPoint | null;
  entryCheckpoint: SegmentGraphEntryCheckpointRequirement;
}

export interface SegmentGraphAnchorTarget extends SegmentGraphAnchorReference {
  sceneIndex: number;
  lineIndex: number;
  position: { offset: number };
  nodeId: SegmentGraphNodeId;
}

export interface SegmentGraphJumpTarget {
  anchorId: string;
  name: string;
}

export interface SegmentGraphWaitGate {
  event: 'click' | 'signal';
  signal?: string;
}

interface SegmentGraphEdgeBase {
  id: string;
  from: SegmentGraphNodeId;
  to: SegmentGraphNodeId;
  priority: number;
  branchIndex: number | null;
  sourceKind: 'sequential' | 'routing' | 'goto' | 'wait' | 'outcome';
  sourceRange: SourceRange;
  evaluationTiming: 'edge-arrival' | 'interactive-completion';
  isBackEdge: boolean;
  requiresCheckpointRestore: boolean;
  documentId?: string;
}

export interface SegmentGraphDefaultEdge extends SegmentGraphEdgeBase {
  kind: 'default';
  condition: null;
  jumpTarget: SegmentGraphJumpTarget | null;
  wait: null;
}

export interface SegmentGraphConditionalEdge extends SegmentGraphEdgeBase {
  kind: 'conditional';
  condition: BoundExpression;
  jumpTarget: SegmentGraphJumpTarget;
  wait: null;
}

export interface SegmentGraphJumpEdge extends SegmentGraphEdgeBase {
  kind: 'jump';
  condition: null;
  jumpTarget: SegmentGraphJumpTarget;
  wait: null;
}

/**
 * `pause(click)` 的完整提取与播放行为属于后续 execution/B4 接缝。B3 先固定边形状，
 * 使后续接入不需要修改 SegmentGraph 的公共结构。
 */
export interface SegmentGraphWaitGateEdge extends SegmentGraphEdgeBase {
  kind: 'wait-gate';
  condition: null;
  jumpTarget: null;
  wait: SegmentGraphWaitGate;
}

export interface SegmentGraphOutcomeEdge extends SegmentGraphEdgeBase {
  kind: 'outcome';
  outcome: string | null;
  condition: null;
  jumpTarget: SegmentGraphJumpTarget;
  wait: null;
  sourceKind: 'outcome';
  evaluationTiming: 'interactive-completion';
}

export type SegmentGraphEdge =
  | SegmentGraphDefaultEdge
  | SegmentGraphConditionalEdge
  | SegmentGraphJumpEdge
  | SegmentGraphWaitGateEdge
  | SegmentGraphOutcomeEdge;

export interface SegmentGraph {
  readonly type: 'segment-graph';
  readonly entryNodeId: SegmentGraphNodeId;
  readonly nodes: readonly SegmentGraphNode[];
  readonly edges: readonly SegmentGraphEdge[];
  readonly defaultPath: readonly SegmentGraphNodeId[];
  readonly anchorTargets: readonly SegmentGraphAnchorTarget[];
}

export type SegmentGraphDiagnosticCode =
  | 'segment-graph-unmapped-anchor'
  | 'segment-graph-missing-edge-source'
  | 'segment-graph-unresolved-target'
  | 'segment-graph-unreachable-node'
  | 'segment-graph-unreachable-branch';

export interface SegmentGraphDiagnostic {
  code: SegmentGraphDiagnosticCode;
  severity: 'error' | 'warning';
  message: string;
  range: SourceRange;
  nodeId?: SegmentGraphNodeId;
  edgeId?: string;
}

export interface SegmentGraphBuildResult {
  graph: SegmentGraph;
  diagnostics: SegmentGraphDiagnostic[];
  complete: boolean;
}
