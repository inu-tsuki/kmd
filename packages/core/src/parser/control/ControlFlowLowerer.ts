import { ExpressionBinder } from "../expression/ExpressionBinder";
import { ExpressionEvaluator } from "../expression/ExpressionEvaluator";
import type { ScopeResolver } from "../scope/ScopeResolver";
import type { DocumentAst, DocumentRoutingBranchAst } from "../document/types";
import { AnchorIndex } from "./AnchorIndex";
import type {
  ControlDiagnostic,
  ControlEdgeSeed,
  ControlFlowLoweringResult,
  ParagraphPresenceEvaluationContext,
  ParagraphPresenceEvaluationResult,
  ParagraphPresenceSeed,
} from "./types";

/**
 * 把文档控制结构降为 B3 可消费的边种子。目标名字在这里完成绑定，条件只完成引用绑定；
 * 路由条件的取值保留到播放到达边时，避免构建阶段丢弃未选择路径。
 */
export class ControlFlowLowerer {
  private readonly binder: ExpressionBinder;

  public constructor(scopes: ScopeResolver) {
    this.binder = new ExpressionBinder(scopes);
  }

  public lower(document: DocumentAst): ControlFlowLoweringResult {
    const anchorIndex = AnchorIndex.fromDocument(document);
    const diagnostics = anchorIndex.diagnostics();
    const expressionDiagnostics: ControlFlowLoweringResult["expressionDiagnostics"] = [];
    const presenceSeeds: ParagraphPresenceSeed[] = [];
    const edgeSeeds: ControlEdgeSeed[] = [];

    for (const scene of document.scenes) {
      for (const paragraph of scene.paragraphs) {
        const conditions = paragraph.presence.map((presence) => {
          expressionDiagnostics.push(...presence.diagnostics);
          const bound = this.binder.bind(presence.expression, { offset: presence.range.start });
          expressionDiagnostics.push(...bound.diagnostics);
          return bound.expression;
        });
        if (conditions.length > 0) {
          presenceSeeds.push({
            type: "paragraph-presence-seed",
            id: `presence:${paragraph.id}`,
            paragraphId: paragraph.id,
            sceneIndex: scene.index,
            range: { ...paragraph.range },
            conditions,
            evaluationTiming: "scene-bake",
          });
        }
      }

      for (const line of scene.lines) {
        if (line.type === "goto-line") {
          edgeSeeds.push(this.edgeSeed(
            anchorIndex,
            diagnostics,
            scene.index,
            line.index,
            line.range,
            "goto",
            0,
            null,
            line.target,
            line.targetRange,
          ));
          continue;
        }
        if (line.type !== "bracket-line" || line.routing === null) continue;
        for (const [branchIndex, branch] of line.routing.branches.entries()) {
          expressionDiagnostics.push(...branch.conditionDiagnostics);
          const condition = this.bindRoutingCondition(branch, expressionDiagnostics);
          edgeSeeds.push(this.edgeSeed(
            anchorIndex,
            diagnostics,
            scene.index,
            line.index,
            branch.range,
            "routing",
            branchIndex,
            condition,
            branch.target,
            branch.targetRange,
          ));
        }
      }
    }

    return {
      anchors: anchorIndex.all(),
      presenceSeeds,
      edgeSeeds,
      documentDiagnostics: document.diagnostics.map((entry) => ({
        ...entry,
        range: { ...entry.range },
      })),
      diagnostics,
      expressionDiagnostics,
      complete: document.diagnostics.length === 0
        && diagnostics.length === 0
        && expressionDiagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  public evaluatePresence(
    seed: ParagraphPresenceSeed,
    context: ParagraphPresenceEvaluationContext,
  ): ParagraphPresenceEvaluationResult {
    return evaluateParagraphPresence(seed, context);
  }

  private bindRoutingCondition(
    branch: DocumentRoutingBranchAst,
    diagnostics: ControlFlowLoweringResult["expressionDiagnostics"],
  ) {
    if (branch.condition === null) return null;
    const bound = this.binder.bind(branch.condition, { offset: branch.range.start });
    diagnostics.push(...bound.diagnostics);
    return bound.expression;
  }

  private edgeSeed(
    anchors: AnchorIndex,
    diagnostics: ControlDiagnostic[],
    sceneIndex: number,
    lineIndex: number,
    sourceRange: { start: number; end: number },
    sourceKind: ControlEdgeSeed["sourceKind"],
    branchIndex: number,
    condition: ControlEdgeSeed["condition"],
    targetName: string,
    targetRange: { start: number; end: number },
  ): ControlEdgeSeed {
    const target = anchors.resolve(targetName);
    if (target === null) {
      diagnostics.push({
        code: "control-undefined-anchor",
        severity: "error",
        message: `Control edge target "#${targetName}" is not declared in this document.`,
        range: { ...targetRange },
      });
    }
    return {
      type: "control-edge-seed",
      id: `edge:${sceneIndex}:${lineIndex}:${branchIndex}:${sourceRange.start}`,
      sourceKind,
      sourceSceneIndex: sceneIndex,
      sourceLineIndex: lineIndex,
      sourcePosition: { offset: sourceRange.start },
      sourceRange: { ...sourceRange },
      branchIndex,
      condition,
      targetName,
      targetRange: { ...targetRange },
      targetAnchorId: target?.id ?? null,
      targetPosition: target === null ? null : { ...target.position },
      evaluationTiming: "edge-arrival",
    };
  }
}

/**
 * Scene bake 只需要已绑定条件与 StateStore。把求值从 lowerer 实例中拆出，
 * production baker 因而无需重新构造 scope/binder，也不会再次解析源文本。
 */
export function evaluateParagraphPresence(
  seed: ParagraphPresenceSeed,
  context: ParagraphPresenceEvaluationContext,
): ParagraphPresenceEvaluationResult {
  const evaluator = new ExpressionEvaluator();
  const diagnostics: ParagraphPresenceEvaluationResult['diagnostics'] = [];
  for (const condition of seed.conditions) {
    const evaluated = evaluator.evaluate(condition, context.state, context.spatial);
    diagnostics.push(...evaluated.diagnostics);
    if (!evaluated.complete || evaluated.value === null) {
      return { present: null, diagnostics, complete: false };
    }
    if (typeof evaluated.value !== 'boolean') {
      diagnostics.push({
        code: 'control-presence-non-boolean',
        severity: 'error',
        message: 'Paragraph presence condition must evaluate to boolean.',
        range: { ...condition.range },
      });
      return { present: null, diagnostics, complete: false };
    }
    // 多个段落条件使用 AND，并保留短路语义。
    if (!evaluated.value) return { present: false, diagnostics, complete: true };
  }
  return { present: true, diagnostics, complete: true };
}
