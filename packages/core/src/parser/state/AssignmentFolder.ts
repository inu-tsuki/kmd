import type { StateStore } from "../../state/StateStore";
import { ExpressionEvaluator } from "../expression/ExpressionEvaluator";
import type {
  ExpressionDiagnostic,
  SpatialValueProvider,
} from "../expression/types";
import type { AssignmentFoldResult, AssignmentSeed } from "./types";

/**
 * Linear B1 proof of the record model. B3 replaces scriptOffset with graph
 * path/time positions while retaining the same ordered fold operation.
 */
export class AssignmentFolder {
  private readonly evaluator = new ExpressionEvaluator();

  public foldThroughOffset(
    assignments: readonly AssignmentSeed[],
    targetOffset: number,
    state: StateStore,
    spatial?: SpatialValueProvider,
  ): AssignmentFoldResult {
    const ordered = [...assignments]
      .filter((seed) => seed.scriptOffset <= targetOffset)
      .sort((left, right) => (
        left.scriptOffset - right.scriptOffset || left.sequence - right.sequence
      ));
    const appliedAssignmentIds: string[] = [];
    const diagnostics: ExpressionDiagnostic[] = [];

    for (const seed of ordered) {
      const evaluated = this.evaluator.evaluate(seed.expression, state, spatial);
      diagnostics.push(...evaluated.diagnostics);
      if (!evaluated.complete || evaluated.value === null) continue;
      const mutation = state.set(seed.target, evaluated.value);
      if (!mutation.ok) {
        diagnostics.push(...mutation.diagnostics.map((entry) => ({
          code: "expression-type-mismatch" as const,
          severity: "error" as const,
          message: entry.message,
          range: { ...seed.range },
        })));
        continue;
      }
      appliedAssignmentIds.push(seed.id);
    }

    return {
      appliedAssignmentIds,
      diagnostics,
      checkpoint: state.snapshot(),
      complete: diagnostics.every((entry) => entry.severity !== "error"),
    };
  }
}
