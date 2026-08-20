import type { SourceRange } from '../types/diagnostics';
import type { AnchorLocation, ControlEdgeSeed, ControlFlowLoweringResult } from '../parser/control/types';
import type {
  InteractiveSegmentLoweringResult,
  InteractiveSegmentSeed,
} from '../parser/interactive/types';
import type {
  DocumentLineAst,
  DocumentAst,
  ParagraphAst,
  SceneAst,
} from '../parser/document/types';
import type {
  DeterministicSegmentPlan,
  InteractiveSegmentPlan,
  SegmentGraph,
  SegmentGraphAnchorReference,
  SegmentGraphAnchorTarget,
  SegmentGraphBuildResult,
  SegmentGraphControlPoint,
  SegmentGraphDiagnostic,
  SegmentGraphEdge,
  SegmentGraphEntryCheckpointReason,
  SegmentGraphNode,
} from './types';

interface AnchorEvent {
  kind: 'anchor';
  offset: number;
  anchor: AnchorLocation;
}

interface ParagraphEvent {
  kind: 'paragraph';
  offset: number;
  paragraph: ParagraphAst;
}

interface ControlEvent {
  kind: 'control';
  offset: number;
  line: Extract<DocumentLineAst, { type: 'goto-line' | 'bracket-line' }>;
  sourceKind: 'goto' | 'routing';
  edgeSeeds: ControlEdgeSeed[];
}

interface InteractiveEvent {
  kind: 'interactive';
  offset: number;
  line: Extract<DocumentLineAst, { type: 'interactive-line' }>;
  seed: InteractiveSegmentSeed;
}

type SceneEvent = AnchorEvent | ParagraphEvent | ControlEvent | InteractiveEvent;

interface NodeCollection {
  nodes: SegmentGraphNode[];
  anchorTargets: SegmentGraphAnchorTarget[];
  anchorTargetById: Map<string, SegmentGraphAnchorTarget>;
  sourceNodeByLine: Map<string, SegmentGraphNode>;
}

const CHECKPOINT_REASON_ORDER: SegmentGraphEntryCheckpointReason[] = [
  'graph-entry',
  'scene-entry',
  'anchor-target',
  'branch-target',
  'jump-target',
  'back-edge-target',
  'wait-resume-target',
];

/**
 * 把 B2 的文档结构与 control edge seeds 编成后端无关的 SegmentGraph 计划。
 * 这里仅切 paragraph group、生成边并做图分析；timeline、checkpoint 内容和播放均留在 B4/生产切换。
 */
export class SegmentGraphBuilder {
  public build(
    document: DocumentAst,
    control: ControlFlowLoweringResult,
    interactive: InteractiveSegmentLoweringResult,
  ): SegmentGraphBuildResult {
    const diagnostics: SegmentGraphDiagnostic[] = [];
    const collection = this.collectNodes(document, control, interactive, diagnostics);
    const edges = this.collectEdges(collection, control, interactive, diagnostics);
    const nodes = this.attachCheckpointRequirements(collection.nodes, edges);
    const graph: SegmentGraph = {
      type: 'segment-graph',
      entryNodeId: nodes[0]!.id,
      nodes,
      edges,
      defaultPath: this.buildDefaultPath(nodes[0]!.id, edges),
      anchorTargets: collection.anchorTargets,
    };

    this.analyzeReachability(graph, diagnostics);
    this.analyzeRoutingPriority(graph, diagnostics);
    return {
      graph,
      diagnostics,
      complete: control.complete
        && interactive.complete
        && diagnostics.every((entry) => entry.severity !== 'error'),
    };
  }

  private collectNodes(
    document: DocumentAst,
    control: ControlFlowLoweringResult,
    interactive: InteractiveSegmentLoweringResult,
    diagnostics: SegmentGraphDiagnostic[],
  ): NodeCollection {
    const nodes: SegmentGraphNode[] = [];
    const anchorTargets: SegmentGraphAnchorTarget[] = [];
    const anchorTargetById = new Map<string, SegmentGraphAnchorTarget>();
    const sourceNodeByLine = new Map<string, SegmentGraphNode>();

    for (const scene of document.scenes) {
      const sceneNodeStart = nodes.length;
      const events = this.sceneEvents(scene, control, interactive);
      let paragraphs: ParagraphAst[] = [];
      let pendingAnchors: AnchorLocation[] = [];

      const appendNode = (
        kind: SegmentGraphNode['kind'],
        sourceRanges: SourceRange[],
        controlPoint: SegmentGraphControlPoint | null,
        segmentOverride: SegmentGraphNode['segment'] | null = null,
      ): SegmentGraphNode => {
        const sceneOrder = nodes.length - sceneNodeStart;
        const sourceRange = combineRanges(sourceRanges, scene.range.start);
        const nodeId = `node:${scene.index}:${sceneOrder}:${sourceRange.start}`;
        const segment = segmentOverride ?? this.segmentPlan(nodeId, scene, paragraphs, sourceRange);
        const entryAnchors = pendingAnchors.map(anchorReference);
        const node: SegmentGraphNode = {
          id: nodeId,
          order: nodes.length,
          sceneOrder,
          sceneId: scene.id,
          sceneIndex: scene.index,
          kind,
          sourceRange,
          segment,
          entryAnchors,
          controlPoint,
          entryCheckpoint: { required: false, reasons: [] },
        };
        nodes.push(node);

        for (const anchor of pendingAnchors) {
          const target: SegmentGraphAnchorTarget = {
            ...anchorReference(anchor),
            sceneIndex: anchor.sceneIndex,
            lineIndex: anchor.lineIndex,
            position: { ...anchor.position },
            nodeId,
          };
          anchorTargets.push(target);
          anchorTargetById.set(anchor.id, target);
        }
        pendingAnchors = [];
        paragraphs = [];
        return node;
      };

      const flushParagraphs = (): void => {
        if (paragraphs.length === 0) return;
        appendNode(
          'paragraph-group',
          [
            ...pendingAnchors.map(anchorSourceRange),
            ...paragraphs.map((paragraph) => paragraph.range),
          ],
          null,
        );
      };

      for (const event of events) {
        if (event.kind === 'anchor') {
          // 锚点定义图入口位置，因此锚点之前已积累的段落必须先结束当前节点。
          flushParagraphs();
          pendingAnchors.push(event.anchor);
          continue;
        }
        if (event.kind === 'paragraph') {
          paragraphs.push(event.paragraph);
          continue;
        }

        if (event.kind === 'interactive') {
          flushParagraphs();
          const node = appendNode(
            'interactive',
            [...pendingAnchors.map(anchorSourceRange), event.line.range],
            null,
            this.interactivePlan(scene, event.seed),
          );
          sourceNodeByLine.set(sourceLineKey(scene.index, event.line.index), node);
          continue;
        }

        flushParagraphs();
        const controlPoint: SegmentGraphControlPoint = {
          sourceKind: event.sourceKind,
          sourceLineIndex: event.line.index,
          sourceRange: { ...event.line.range },
          edgeSeedIds: event.edgeSeeds.map((seed) => seed.id),
        };
        const node = appendNode(
          'control-point',
          [...pendingAnchors.map(anchorSourceRange), event.line.range],
          controlPoint,
        );
        sourceNodeByLine.set(sourceLineKey(scene.index, event.line.index), node);
      }

      flushParagraphs();
      if (pendingAnchors.length > 0 || nodes.length === sceneNodeStart) {
        appendNode(
          'empty',
          pendingAnchors.length > 0
            ? pendingAnchors.map(anchorSourceRange)
            : [scene.range],
          null,
        );
      }
    }

    for (const anchor of control.anchors) {
      if (anchorTargetById.has(anchor.id)) continue;
      diagnostics.push({
        code: 'segment-graph-unmapped-anchor',
        severity: 'error',
        message: `Anchor "${anchor.name}" could not be mapped to a graph node.`,
        range: { ...anchor.declarationRange },
      });
    }

    // DocumentParser 对空文档也会产出一个空 scene；这里仍保留防御性入口，避免调用方构造 AST 时出现空图。
    if (nodes.length === 0) {
      const range = { start: document.range.start, end: document.range.start };
      const nodeId = `node:0:0:${range.start}`;
      nodes.push({
        id: nodeId,
        order: 0,
        sceneOrder: 0,
        sceneId: 'scene:0:empty',
        sceneIndex: 0,
        kind: 'empty',
        sourceRange: range,
        segment: {
          type: 'deterministic-segment-plan',
          id: `segment:${nodeId}`,
          sceneId: 'scene:0:empty',
          sceneIndex: 0,
          paragraphIds: [],
          paragraphs: [],
          range,
        },
        entryAnchors: [],
        controlPoint: null,
        entryCheckpoint: { required: false, reasons: [] },
      });
    }

    return { nodes, anchorTargets, anchorTargetById, sourceNodeByLine };
  }

  private sceneEvents(
    scene: SceneAst,
    control: ControlFlowLoweringResult,
    interactive: InteractiveSegmentLoweringResult,
  ): SceneEvent[] {
    const edgeSeedsByLine = new Map<number, ControlEdgeSeed[]>();
    for (const seed of control.edgeSeeds) {
      if (seed.sourceSceneIndex !== scene.index) continue;
      const existing = edgeSeedsByLine.get(seed.sourceLineIndex) ?? [];
      existing.push(seed);
      edgeSeedsByLine.set(seed.sourceLineIndex, existing);
    }
    const interactiveByLine = new Map<number, InteractiveSegmentSeed>();
    for (const seed of interactive.seeds) {
      if (seed.sourceSceneIndex === scene.index) interactiveByLine.set(seed.sourceLineIndex, seed);
    }

    const events: SceneEvent[] = [];
    for (const anchor of control.anchors) {
      if (anchor.sceneIndex !== scene.index) continue;
      events.push({ kind: 'anchor', offset: anchor.position.offset, anchor });
    }
    for (const paragraph of scene.paragraphs) {
      // anchor-content 可带段落前缀；以首条可渲染行排序，确保同位置锚点先建立节点入口。
      const offset = paragraph.bodyLines[0]?.range.start ?? paragraph.range.start;
      events.push({ kind: 'paragraph', offset, paragraph });
    }
    for (const line of scene.lines) {
      if (line.type === 'goto-line') {
        events.push({
          kind: 'control',
          offset: line.range.start,
          line,
          sourceKind: 'goto',
          edgeSeeds: edgeSeedsByLine.get(line.index) ?? [],
        });
      } else if (line.type === 'bracket-line' && line.slot === 'routing') {
        events.push({
          kind: 'control',
          offset: line.range.start,
          line,
          sourceKind: 'routing',
          edgeSeeds: edgeSeedsByLine.get(line.index) ?? [],
        });
      } else if (line.type === 'interactive-line') {
        const seed = interactiveByLine.get(line.index);
        if (seed !== undefined) {
          events.push({
            kind: 'interactive',
            offset: line.range.start,
            line,
            seed,
          });
        }
      }
    }

    const eventRank: Record<SceneEvent['kind'], number> = {
      anchor: 0,
      paragraph: 1,
      interactive: 2,
      control: 3,
    };
    return events.sort((left, right) => (
      left.offset - right.offset || eventRank[left.kind] - eventRank[right.kind]
    ));
  }

  private segmentPlan(
    nodeId: string,
    scene: SceneAst,
    paragraphs: ParagraphAst[],
    nodeRange: SourceRange,
  ): DeterministicSegmentPlan {
    const references = paragraphs.map((paragraph) => ({
      id: paragraph.id,
      sceneIndex: paragraph.sceneIndex,
      paragraphIndex: paragraph.index,
      range: { ...paragraph.range },
    }));
    return {
      type: 'deterministic-segment-plan',
      id: `segment:${nodeId}`,
      sceneId: scene.id,
      sceneIndex: scene.index,
      paragraphIds: references.map((paragraph) => paragraph.id),
      paragraphs: references,
      range: references.length === 0
        ? { start: nodeRange.start, end: nodeRange.start }
        : combineRanges(references.map((paragraph) => paragraph.range), nodeRange.start),
    };
  }

  private interactivePlan(
    scene: SceneAst,
    seed: InteractiveSegmentSeed,
  ): InteractiveSegmentPlan {
    return {
      type: 'interactive-segment-plan',
      id: `segment:${seed.id}`,
      sceneId: scene.id,
      sceneIndex: scene.index,
      moduleId: seed.moduleId,
      outcomes: seed.outcomes.flatMap((branch) => (
        branch.outcome === null ? [] : [branch.outcome]
      )),
      hasFallback: seed.outcomes.some((branch) => branch.outcome === null),
      range: { ...seed.sourceRange },
    };
  }

  private collectEdges(
    collection: NodeCollection,
    control: ControlFlowLoweringResult,
    interactive: InteractiveSegmentLoweringResult,
    diagnostics: SegmentGraphDiagnostic[],
  ): SegmentGraphEdge[] {
    const edges: SegmentGraphEdge[] = [];
    const seedsBySourceLine = new Map<string, ControlEdgeSeed[]>();
    for (const seed of control.edgeSeeds) {
      const key = sourceLineKey(seed.sourceSceneIndex, seed.sourceLineIndex);
      const seeds = seedsBySourceLine.get(key) ?? [];
      seeds.push(seed);
      seedsBySourceLine.set(key, seeds);
    }

    for (let index = 0; index < collection.nodes.length - 1; index += 1) {
      const from = collection.nodes[index]!;
      const to = collection.nodes[index + 1]!;
      const controlPoint = from.controlPoint;
      // Interactive 节点只能由已提交 outcome 离开；普通顺序边会绕过实时模块。
      if (from.kind === 'interactive') continue;
      if (controlPoint?.sourceKind === 'goto') continue;
      const seeds = controlPoint === null
        ? []
        : seedsBySourceLine.get(sourceLineKey(from.sceneIndex, controlPoint.sourceLineIndex)) ?? [];
      if (controlPoint?.sourceKind === 'routing' && seeds.some((seed) => seed.condition === null)) {
        continue;
      }
      edges.push({
        id: `edge:sequential:${from.id}:${to.id}`,
        from: from.id,
        to: to.id,
        kind: 'default',
        priority: seeds.length,
        branchIndex: null,
        sourceKind: 'sequential',
        sourceRange: { start: from.sourceRange.end, end: from.sourceRange.end },
        evaluationTiming: 'edge-arrival',
        condition: null,
        jumpTarget: null,
        wait: null,
        isBackEdge: false,
        // 跨场景顺序边仍要重建目标场景的 stage/layout/scene state；同场景顺序边可直接承接出口态。
        requiresCheckpointRestore: from.sceneIndex !== to.sceneIndex,
      });
    }

    for (const seed of control.edgeSeeds) {
      const sourceNode = collection.sourceNodeByLine.get(
        sourceLineKey(seed.sourceSceneIndex, seed.sourceLineIndex),
      );
      if (sourceNode === undefined) {
        diagnostics.push({
          code: 'segment-graph-missing-edge-source',
          severity: 'error',
          message: 'Control edge source could not be mapped to a graph node.',
          range: { ...seed.sourceRange },
        });
        continue;
      }
      if (seed.targetAnchorId === null) {
        diagnostics.push({
          code: 'segment-graph-unresolved-target',
          severity: 'error',
          message: `Control edge target "#${seed.targetName}" is unresolved.`,
          range: { ...seed.targetRange },
          nodeId: sourceNode.id,
        });
        continue;
      }
      const target = collection.anchorTargetById.get(seed.targetAnchorId);
      if (target === undefined) {
        diagnostics.push({
          code: 'segment-graph-unmapped-anchor',
          severity: 'error',
          message: `Control edge target "#${seed.targetName}" has no graph node.`,
          range: { ...seed.targetRange },
          nodeId: sourceNode.id,
        });
        continue;
      }

      const common = {
        id: `graph:${seed.id}`,
        from: sourceNode.id,
        to: target.nodeId,
        priority: seed.branchIndex,
        branchIndex: seed.branchIndex,
        sourceKind: seed.sourceKind,
        sourceRange: { ...seed.sourceRange },
        evaluationTiming: seed.evaluationTiming,
        jumpTarget: { anchorId: target.id, name: target.name },
        wait: null,
        isBackEdge: (seed.targetPosition?.offset ?? target.position.offset) < seed.sourcePosition.offset,
        requiresCheckpointRestore: true,
      } as const;

      if (seed.sourceKind === 'goto') {
        edges.push({ ...common, kind: 'jump', condition: null });
      } else if (seed.condition === null) {
        edges.push({ ...common, kind: 'default', condition: null });
      } else {
        edges.push({ ...common, kind: 'conditional', condition: seed.condition });
      }
    }

    for (const seed of interactive.seeds) {
      const sourceNode = collection.sourceNodeByLine.get(
        sourceLineKey(seed.sourceSceneIndex, seed.sourceLineIndex),
      );
      if (sourceNode === undefined) {
        diagnostics.push({
          code: 'segment-graph-missing-edge-source',
          severity: 'error',
          message: 'Interactive segment source could not be mapped to a graph node.',
          range: { ...seed.sourceRange },
        });
        continue;
      }
      for (const branch of seed.outcomes) {
        if (branch.targetAnchorId === null) {
          diagnostics.push({
            code: 'segment-graph-unresolved-target',
            severity: 'error',
            message: `Interactive outcome target "#${branch.targetName}" is unresolved.`,
            range: { ...branch.targetRange },
            nodeId: sourceNode.id,
          });
          continue;
        }
        const target = collection.anchorTargetById.get(branch.targetAnchorId);
        if (target === undefined) {
          diagnostics.push({
            code: 'segment-graph-unmapped-anchor',
            severity: 'error',
            message: `Interactive outcome target "#${branch.targetName}" has no graph node.`,
            range: { ...branch.targetRange },
            nodeId: sourceNode.id,
          });
          continue;
        }
        edges.push({
          id: `graph:${branch.id}`,
          from: sourceNode.id,
          to: target.nodeId,
          kind: 'outcome',
          outcome: branch.outcome,
          priority: branch.branchIndex,
          branchIndex: branch.branchIndex,
          sourceKind: 'outcome',
          sourceRange: { ...branch.sourceRange },
          evaluationTiming: 'interactive-completion',
          condition: null,
          jumpTarget: { anchorId: target.id, name: target.name },
          wait: null,
          isBackEdge: (branch.targetPosition?.offset ?? target.position.offset)
            < seed.sourcePosition.offset,
          requiresCheckpointRestore: true,
        });
      }
    }

    const nodeOrder = new Map(collection.nodes.map((node) => [node.id, node.order]));
    const kindOrder: Record<SegmentGraphEdge['kind'], number> = {
      outcome: 0,
      conditional: 1,
      default: 2,
      jump: 3,
      'wait-gate': 4,
    };
    return edges.sort((left, right) => (
      (nodeOrder.get(left.from) ?? 0) - (nodeOrder.get(right.from) ?? 0)
      || left.priority - right.priority
      || kindOrder[left.kind] - kindOrder[right.kind]
      || left.id.localeCompare(right.id)
    ));
  }

  private attachCheckpointRequirements(
    nodes: SegmentGraphNode[],
    edges: SegmentGraphEdge[],
  ): SegmentGraphNode[] {
    const reasons = new Map(nodes.map((node) => (
      [node.id, new Set<SegmentGraphEntryCheckpointReason>()] as const
    )));
    reasons.get(nodes[0]!.id)!.add('graph-entry');

    const seenScenes = new Set<number>();
    for (const node of nodes) {
      if (!seenScenes.has(node.sceneIndex)) {
        reasons.get(node.id)!.add('scene-entry');
        seenScenes.add(node.sceneIndex);
      }
      if (node.entryAnchors.length > 0) reasons.get(node.id)!.add('anchor-target');
    }
    for (const edge of edges) {
      if (edge.sourceKind === 'routing' || edge.sourceKind === 'outcome') {
        reasons.get(edge.to)!.add('branch-target');
      }
      if (edge.kind === 'jump') reasons.get(edge.to)!.add('jump-target');
      if (edge.isBackEdge) reasons.get(edge.to)!.add('back-edge-target');
      if (edge.kind === 'wait-gate') reasons.get(edge.to)!.add('wait-resume-target');
    }

    return nodes.map((node) => {
      const nodeReasons = reasons.get(node.id)!;
      const ordered = CHECKPOINT_REASON_ORDER.filter((reason) => nodeReasons.has(reason));
      return {
        ...node,
        entryCheckpoint: { required: ordered.length > 0, reasons: ordered },
      };
    });
  }

  private buildDefaultPath(entryNodeId: string, edges: SegmentGraphEdge[]): string[] {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: string | undefined = entryNodeId;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      path.push(current);
      const outgoing = edges.filter((edge) => edge.from === current);
      // 条件不求值；优先走显式/顺序 default。无 default 时，无条件 jump 仍是确定流向。
      const next = outgoing.find((edge) => edge.kind === 'default')
        ?? outgoing.find((edge) => edge.kind === 'jump');
      current = next?.to;
    }
    return path;
  }

  private analyzeReachability(
    graph: SegmentGraph,
    diagnostics: SegmentGraphDiagnostic[],
  ): void {
    const reachable = new Set<string>();
    const queue = [graph.entryNodeId];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const edge of graph.edges) {
        if (edge.from === nodeId && !reachable.has(edge.to)) queue.push(edge.to);
      }
    }

    for (const node of graph.nodes) {
      if (reachable.has(node.id)) continue;
      diagnostics.push({
        code: 'segment-graph-unreachable-node',
        severity: 'warning',
        message: 'Graph node is unreachable from the document entry.',
        range: { ...node.sourceRange },
        nodeId: node.id,
      });
    }
    for (const edge of graph.edges) {
      if (
        reachable.has(edge.from)
        || (edge.sourceKind !== 'routing' && edge.sourceKind !== 'outcome')
      ) continue;
      diagnostics.push({
        code: 'segment-graph-unreachable-branch',
        severity: 'warning',
        message: edge.sourceKind === 'outcome'
          ? 'Interactive outcome branch is unreachable because its source node cannot be entered.'
          : 'Routing branch is unreachable because its source node cannot be entered.',
        range: { ...edge.sourceRange },
        nodeId: edge.from,
        edgeId: edge.id,
      });
    }
  }

  private analyzeRoutingPriority(
    graph: SegmentGraph,
    diagnostics: SegmentGraphDiagnostic[],
  ): void {
    for (const node of graph.nodes) {
      const routing = graph.edges
        .filter((edge) => edge.from === node.id && edge.sourceKind === 'routing')
        .sort((left, right) => left.priority - right.priority);
      let foundDefault = false;
      for (const edge of routing) {
        if (foundDefault) {
          diagnostics.push({
            code: 'segment-graph-unreachable-branch',
            severity: 'warning',
            message: 'Routing branch appears after an unconditional default branch.',
            range: { ...edge.sourceRange },
            nodeId: edge.from,
            edgeId: edge.id,
          });
        }
        if (edge.kind === 'default') foundDefault = true;
      }
    }
  }
}

function sourceLineKey(sceneIndex: number, lineIndex: number): string {
  return `${sceneIndex}:${lineIndex}`;
}

function anchorReference(anchor: AnchorLocation): SegmentGraphAnchorReference {
  return {
    id: anchor.id,
    name: anchor.name,
    rendered: anchor.rendered,
    declarationRange: { ...anchor.declarationRange },
  };
}

function anchorSourceRange(anchor: AnchorLocation): SourceRange {
  return {
    start: anchor.position.offset,
    end: Math.max(anchor.position.offset, anchor.declarationRange.end),
  };
}

function combineRanges(ranges: readonly SourceRange[], fallback: number): SourceRange {
  if (ranges.length === 0) return { start: fallback, end: fallback };
  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  };
}
