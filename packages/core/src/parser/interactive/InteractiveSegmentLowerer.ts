import type { AnchorLocation } from '../control/types';
import type { DocumentAst } from '../document/types';
import type {
  InteractiveDiagnostic,
  InteractiveOutcomeSeed,
  InteractiveSegmentLoweringResult,
  InteractiveSegmentSeed,
} from './types';

/**
 * 把源码内可确定的 game line 降低为 node-owned seed。模块资源、权限和 integrity
 * 需要 Work manifest，留给 load 前的 InteractiveWorkResolver 校验。
 */
export class InteractiveSegmentLowerer {
  public lower(
    document: DocumentAst,
    anchors: readonly AnchorLocation[],
    presentationMode: unknown,
  ): InteractiveSegmentLoweringResult {
    const diagnostics: InteractiveDiagnostic[] = [];
    const seeds: InteractiveSegmentSeed[] = [];
    const anchorByName = new Map<string, AnchorLocation>();
    for (const anchor of anchors) {
      if (!anchorByName.has(anchor.name)) anchorByName.set(anchor.name, anchor);
    }

    for (const scene of document.scenes) {
      for (const line of scene.lines) {
        if (line.type !== 'interactive-line') continue;
        if (presentationMode !== 'stage') {
          diagnostics.push({
            code: 'interactive-mode-unsupported',
            severity: 'error',
            message: 'Interactive segments are supported only in Stage presentation mode.',
            range: { ...line.range },
          });
        }

        const outcomes: InteractiveOutcomeSeed[] = line.outcomes.map((branch, branchIndex) => {
          const target = anchorByName.get(branch.target) ?? null;
          if (target === null) {
            diagnostics.push({
              code: 'interactive-undefined-anchor',
              severity: 'error',
              message: `Interactive outcome target "#${branch.target}" is not declared in this document.`,
              range: { ...branch.targetRange },
            });
          }
          return {
            id: `interactive-outcome:${scene.index}:${line.index}:${branchIndex}:${branch.range.start}`,
            branchIndex,
            outcome: branch.outcome,
            sourceRange: { ...branch.range },
            targetName: branch.target,
            targetRange: { ...branch.targetRange },
            targetAnchorId: target?.id ?? null,
            targetPosition: target === null ? null : { ...target.position },
          };
        });
        seeds.push({
          type: 'interactive-segment-seed',
          id: `interactive:${scene.index}:${line.index}:${line.range.start}`,
          sourceSceneIndex: scene.index,
          sourceLineIndex: line.index,
          sourcePosition: { offset: line.range.start },
          sourceRange: { ...line.range },
          moduleId: line.moduleId,
          moduleIdRange: { ...line.moduleIdRange },
          outcomes,
        });
      }
    }

    return {
      seeds,
      diagnostics,
      complete: diagnostics.length === 0,
    };
  }
}
