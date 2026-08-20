import type { StateReadView } from "../../state/StateStore";
import type { ScopeResolver } from "../scope/ScopeResolver";
import type {
  SemanticBeat,
  SemanticBoundValue,
  SemanticCommandMember,
  SemanticDeferredValue,
  SemanticDiagnostic,
  SemanticLoweringResult,
  SemanticRangeEndpoint,
  SemanticRangeValue,
  SemanticSentence,
  SemanticStateExpressionValue,
} from "../semantic/types";
import { bindNumberWithDefaultUnit } from "../semantic/valueBinding";
import { ExpressionBinder } from "./ExpressionBinder";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { parseExpression } from "./ExpressionParser";
import type {
  ExpressionDiagnostic,
  SpatialValueProvider,
} from "./types";

export interface ArgumentResolutionResult {
  semantic: SemanticLoweringResult;
  diagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export interface ArgumentEvaluationResult {
  value: SemanticBoundValue | null;
  diagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export class ArgumentResolver {
  private readonly binder: ExpressionBinder;
  private readonly values = new ArgumentValueEvaluator();

  public constructor(scopes: ScopeResolver) {
    this.binder = new ExpressionBinder(scopes);
  }

  public resolve(lowering: SemanticLoweringResult): ArgumentResolutionResult {
    const diagnostics: ExpressionDiagnostic[] = [];
    const sentences = lowering.sentences.map((sentence) => {
      // SemanticLowerer mirrors nested diagnostics onto the parent sentence,
      // so one shared set is required while resolving an entire sentence tree.
      const resolvedRanges = new Set<string>();
      return this.resolveSentence(sentence, diagnostics, resolvedRanges);
    });
    const complete = lowering.upstreamDiagnostics.every((entry) => entry.severity !== "error")
      && diagnostics.every((entry) => entry.severity !== "error")
      && sentences.every((sentence) => sentence.complete);
    return {
      semantic: {
        ...lowering,
        sentences,
        diagnostics: sentences.flatMap((sentence) => sentence.diagnostics),
        complete,
      },
      diagnostics,
      complete,
    };
  }

  public evaluate(
    value: SemanticBoundValue,
    state: StateReadView,
    spatial?: SpatialValueProvider,
  ): ArgumentEvaluationResult {
    return this.values.evaluate(value, state, spatial);
  }

  private resolveSentence(
    source: SemanticSentence,
    diagnostics: ExpressionDiagnostic[],
    resolvedRanges: Set<string>,
  ): SemanticSentence {
    const beats = source.beats.map((beat) => this.resolveBeat(beat, diagnostics, resolvedRanges));
    const semanticDiagnostics = source.diagnostics.filter((entry) => (
      entry.code !== "semantic-value-deferred" || !resolvedRanges.has(rangeKey(entry.range))
    ));
    const complete = semanticDiagnostics.every((entry) => entry.severity !== "error")
      && beats.every(beatComplete);
    return {
      ...source,
      beats,
      diagnostics: semanticDiagnostics,
      complete,
    };
  }

  private resolveBeat(
    source: SemanticBeat,
    diagnostics: ExpressionDiagnostic[],
    resolvedRanges: Set<string>,
  ): SemanticBeat {
    return {
      ...source,
      members: source.members.map((member) => {
        if (member.type === "semantic-clause-member") {
          return {
            ...member,
            sentence: this.resolveSentence(member.sentence, diagnostics, resolvedRanges),
          };
        }
        if (member.type !== "semantic-command-member") return member;
        return this.resolveCommand(member, diagnostics, resolvedRanges);
      }),
    };
  }

  private resolveCommand(
    source: SemanticCommandMember,
    diagnostics: ExpressionDiagnostic[],
    resolvedRanges: Set<string>,
  ): SemanticCommandMember {
    return {
      ...source,
      args: source.args.map((argument) => ({
        ...argument,
        value: this.resolveValue(argument.value, diagnostics, resolvedRanges),
      })),
    };
  }

  private resolveValue(
    source: SemanticBoundValue,
    diagnostics: ExpressionDiagnostic[],
    resolvedRanges: Set<string>,
  ): SemanticBoundValue {
    if (source.type === "deferred-value") {
      const resolved = this.resolveDeferredValue(source);
      diagnostics.push(...resolved.diagnostics);
      if (resolved.value.type === "state-expression") {
        resolvedRanges.add(rangeKey(source.sourceRange));
      }
      return resolved.value;
    }
    if (source.type === "range") {
      return {
        ...source,
        from: this.resolveEndpoint(source.from, diagnostics, resolvedRanges),
        to: this.resolveEndpoint(source.to, diagnostics, resolvedRanges),
      };
    }
    return source;
  }

  private resolveEndpoint(
    source: SemanticRangeEndpoint,
    diagnostics: ExpressionDiagnostic[],
    resolvedRanges: Set<string>,
  ): SemanticRangeEndpoint {
    if (source.type !== "deferred-value") return source;
    const resolved = this.resolveDeferredValue(source);
    diagnostics.push(...resolved.diagnostics);
    if (resolved.value.type !== "state-expression") return source;
    resolvedRanges.add(rangeKey(source.sourceRange));
    // Range endpoints are evaluated by the same trigger-time expression path.
    return resolved.value;
  }

  private resolveDeferredValue(source: SemanticDeferredValue): {
    value: SemanticDeferredValue | SemanticStateExpressionValue;
    diagnostics: ExpressionDiagnostic[];
  } {
    const parsed = parseExpression(source.raw, source.sourceRange.start);
    if (parsed.diagnostics.some((entry) => entry.severity === "error")) {
      return { value: source, diagnostics: parsed.diagnostics };
    }
    const bound = this.binder.bind(parsed.expression, { offset: source.sourceRange.start });
    if (!bound.complete) return { value: source, diagnostics: bound.diagnostics };
    return {
      value: {
        type: "state-expression",
        expression: bound.expression,
        expectedUnit: source.expectedUnit,
        evaluationTiming: "trigger-record",
        sourceRange: { ...source.sourceRange },
      },
      diagnostics: [...parsed.diagnostics, ...bound.diagnostics],
    };
  }

}

/**
 * Trigger-record evaluator shared by the compiler lane planner and the scope-
 * aware ArgumentResolver. It owns no binder and therefore cannot reparse or
 * rebind source while materializing a command record.
 */
export class ArgumentValueEvaluator {
  private readonly evaluator = new ExpressionEvaluator();

  public evaluate(
    value: SemanticBoundValue,
    state: StateReadView,
    spatial?: SpatialValueProvider,
  ): ArgumentEvaluationResult {
    if (value.type === "range") return this.evaluateRange(value, state, spatial);
    if (value.type !== "state-expression") {
      return {
        value: value.type === "deferred-value" || value.type === "invalid-value"
          ? null
          : value,
        diagnostics: [],
        complete: value.type !== "deferred-value" && value.type !== "invalid-value",
      };
    }

    const evaluated = this.evaluator.evaluate(value.expression, state, spatial);
    if (!evaluated.complete || evaluated.value === null) {
      return { value: null, diagnostics: evaluated.diagnostics, complete: false };
    }
    if (typeof evaluated.value === "number") {
      return {
        value: bindNumberWithDefaultUnit(evaluated.value, value.expectedUnit),
        diagnostics: evaluated.diagnostics,
        complete: true,
      };
    }
    if (value.expectedUnit !== null) {
      return {
        value: null,
        diagnostics: [
          ...evaluated.diagnostics,
          {
            code: "expression-type-mismatch",
            severity: "error",
            message: `Argument expects ${value.expectedUnit}, but the expression produced a non-numeric value.`,
            range: { ...value.sourceRange },
          },
        ],
        complete: false,
      };
    }
    if (typeof evaluated.value === "string") {
      return {
        value: { type: "string", value: evaluated.value, quote: "\"" },
        diagnostics: evaluated.diagnostics,
        complete: true,
      };
    }
    if (typeof evaluated.value === "boolean") {
      return {
        value: { type: "bool", value: evaluated.value },
        diagnostics: evaluated.diagnostics,
        complete: true,
      };
    }
    return {
      value: { type: "spatial", value: evaluated.value },
      diagnostics: evaluated.diagnostics,
      complete: true,
    };
  }

  private evaluateRange(
    value: SemanticRangeValue,
    state: StateReadView,
    spatial?: SpatialValueProvider,
  ): ArgumentEvaluationResult {
    const from = this.evaluateEndpoint(value.from, state, spatial);
    const to = this.evaluateEndpoint(value.to, state, spatial);
    const diagnostics = [...from.diagnostics, ...to.diagnostics];
    if (!from.complete || !to.complete || from.value === null || to.value === null) {
      return { value: null, diagnostics, complete: false };
    }
    return {
      value: { ...value, from: from.value, to: to.value },
      diagnostics,
      complete: diagnostics.every((entry) => entry.severity !== "error"),
    };
  }

  private evaluateEndpoint(
    value: SemanticRangeEndpoint,
    state: StateReadView,
    spatial?: SpatialValueProvider,
  ): {
    value: Exclude<SemanticRangeEndpoint, SemanticStateExpressionValue | SemanticDeferredValue> | null;
    diagnostics: ExpressionDiagnostic[];
    complete: boolean;
  } {
    if (value.type === "deferred-value") {
      return { value: null, diagnostics: [], complete: false };
    }
    if (value.type !== "state-expression") {
      return { value, diagnostics: [], complete: true };
    }
    const evaluated = this.evaluate(value, state, spatial);
    if (
      evaluated.value === null
      || !isMaterializedRangeEndpoint(evaluated.value)
    ) {
      const diagnostics = [...evaluated.diagnostics];
      if (evaluated.value !== null) {
        diagnostics.push({
          code: "expression-type-mismatch",
          severity: "error",
          message: "Range endpoint expressions must produce numeric quantity values.",
          range: { ...value.sourceRange },
        });
      }
      return { value: null, diagnostics, complete: false };
    }
    return {
      value: evaluated.value,
      diagnostics: evaluated.diagnostics,
      complete: evaluated.complete,
    };
  }
}

function beatComplete(beat: SemanticBeat): boolean {
  return beat.members.every((member) => {
    if (member.type === "semantic-deferred-member") return false;
    if (member.type === "semantic-clause-member") return member.sentence.complete;
    return member.args.every((argument) => valueComplete(argument.value));
  });
}

function valueComplete(value: SemanticBoundValue): boolean {
  if (value.type === "deferred-value" || value.type === "invalid-value") return false;
  if (value.type === "range") return endpointComplete(value.from) && endpointComplete(value.to);
  return true;
}

function endpointComplete(value: SemanticRangeEndpoint): boolean {
  return value.type !== "deferred-value";
}

function rangeKey(range: { start: number; end: number }): string {
  return `${range.start}:${range.end}`;
}

function isMaterializedRangeEndpoint(
  value: SemanticBoundValue,
): value is Exclude<SemanticRangeEndpoint, SemanticStateExpressionValue | SemanticDeferredValue> {
  return value.type === "number"
    || value.type === "time"
    || value.type === "space"
    || value.type === "angle"
    || value.type === "relative";
}

export function filterResolvedSemanticValueDiagnostics(
  diagnostics: readonly SemanticDiagnostic[],
  resolvedRanges: ReadonlySet<string>,
): SemanticDiagnostic[] {
  return diagnostics.filter((entry) => (
    entry.code !== "semantic-value-deferred" || !resolvedRanges.has(rangeKey(entry.range))
  ));
}
