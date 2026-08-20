import { isStateValue } from "../../state/StateStore";
import type {
  StateEntry,
  StateValue,
} from "../../state/StateStore";
import type { DefinitionIndex } from "../scope/DefinitionIndex";
import type { ScopeResolver } from "../scope/ScopeResolver";
import type { ScopeDefinition } from "../scope/types";
import { ExpressionBinder, stateKeyFromDefinition } from "../expression/ExpressionBinder";
import { parseExpression } from "../expression/ExpressionParser";
import type {
  BoundExpression,
  ExpressionAst,
  ExpressionBindingResult,
  ExpressionDiagnostic,
} from "../expression/types";
import type {
  AssignmentSeed,
  DeferredStateDefinition,
  FrontmatterVariableInput,
  StateLoweringDiagnostic,
  StateLoweringInput,
  StateLoweringResult,
  StateSentenceInput,
} from "./types";

export class StateLowerer {
  private readonly definitions: DefinitionIndex;
  private readonly scopes: ScopeResolver;
  private readonly binder: ExpressionBinder;

  public constructor(definitions: DefinitionIndex, scopes: ScopeResolver) {
    this.definitions = definitions;
    this.scopes = scopes;
    this.binder = new ExpressionBinder(scopes);
  }

  public lower(input: StateLoweringInput): StateLoweringResult {
    const storeInitials: StateEntry[] = [];
    const assignments: AssignmentSeed[] = [];
    const deferredDefinitions: DeferredStateDefinition[] = [];
    const diagnostics: StateLoweringDiagnostic[] = [];
    const expressionDiagnostics: ExpressionDiagnostic[] = [];

    for (const variable of input.frontmatterVariables ?? []) {
      this.collectFrontmatterVariable(
        variable,
        input.documentVisibleUntil.offset,
        storeInitials,
        diagnostics,
      );
    }

    const sentences = [...input.sentences].sort((left, right) => (
      left.sentence.range.start - right.sentence.range.start
      || left.sentence.range.end - right.sentence.range.end
    ));
    for (const entry of sentences) {
      this.collectSentence(
        entry,
        input.documentVisibleUntil.offset,
        assignments,
        deferredDefinitions,
        diagnostics,
        expressionDiagnostics,
      );
    }

    const scopeDiagnostics = this.scopes.audit();
    const complete = diagnostics.length === 0
      && expressionDiagnostics.every((entry) => entry.severity !== "error")
      && scopeDiagnostics.every((entry) => entry.severity !== "error");
    return {
      definitions: this.definitions.all(),
      storeInitials,
      assignments,
      deferredDefinitions,
      diagnostics,
      expressionDiagnostics,
      scopeDiagnostics,
      complete,
    };
  }

  private collectFrontmatterVariable(
    input: FrontmatterVariableInput,
    documentEnd: number,
    initials: StateEntry[],
    diagnostics: StateLoweringDiagnostic[],
  ): void {
    if (!isIdentifier(input.name)) {
      diagnostics.push({
        code: "state-lowering-invalid-frontmatter-name",
        severity: "error",
        message: `Frontmatter variable name "${input.name}" is not a valid identifier.`,
        range: { ...input.range },
      });
      return;
    }
    if (!isStateValue(input.value)) {
      diagnostics.push({
        code: "state-lowering-invalid-frontmatter-value",
        severity: "error",
        message: `Frontmatter variable "${input.name}" must be a scalar or serializable point/domain value.`,
        range: { ...input.range },
      });
      return;
    }
    const definition = this.ensureDocumentDefinition(
      input.name,
      input.range,
      documentEnd,
      "frontmatter",
      diagnostics,
    );
    if (definition === null) return;
    initials.push({
      key: stateKeyFromDefinition(definition),
      value: input.value as StateValue,
    });
  }

  private collectSentence(
    input: StateSentenceInput,
    documentEnd: number,
    assignments: AssignmentSeed[],
    deferred: DeferredStateDefinition[],
    diagnostics: StateLoweringDiagnostic[],
    expressionDiagnostics: ExpressionDiagnostic[],
  ): void {
    const sentence = input.sentence;
    const slice = sentence.payload?.slice;
    if (slice === undefined) return;

    if (sentence.kind === "assignment") {
      const path = sentence.payload?.path ?? [];
      if (path.length !== 2 || path[0]?.name !== "var" || path[1] === undefined) {
        diagnostics.push({
          code: "state-lowering-invalid-assignment-target",
          severity: "error",
          message: "Only var.name is a valid qualified state assignment target.",
          range: { ...sentence.range },
        });
        return;
      }
      const definition = this.ensureDocumentDefinition(
        path[1].name,
        { start: path[0].range.start, end: path[1].range.end },
        documentEnd,
        "definition",
        diagnostics,
      );
      if (definition === null) return;
      const expression = this.parseAndBind(slice.raw, slice.range.start, sentence.range.start);
      expressionDiagnostics.push(...expression.diagnostics);
      if (!expression.complete) return;
      assignments.push(createAssignmentSeed(assignments.length, sentence, definition, expression.expression));
      return;
    }

    if (sentence.kind !== "definition" || sentence.payload?.name === undefined) return;
    const name = sentence.payload.name.name;
    const existing = this.definitions.named(name);
    const existingState = existing.length === 1 && existing[0]?.kind === "state"
      ? existing[0]
      : null;
    const parsed = parseExpression(slice.raw, slice.range.start);
    const preliminary = parsed.diagnostics.length === 0
      ? this.binder.bind(parsed.expression, { offset: sentence.range.start })
      : null;
    const stateIntent = existingState !== null
      || isDefiniteStateExpression(parsed.expression, slice.raw, preliminary);

    if (!stateIntent) {
      deferred.push({
        sentence,
        sceneVisibleUntil: { ...input.sceneVisibleUntil },
        reason: parsed.diagnostics.length === 0
          ? "macro-or-object"
          : "invalid-non-state-syntax",
      });
      return;
    }

    if (input.sceneVisibleUntil.offset <= sentence.range.start) {
      diagnostics.push({
        code: "state-lowering-invalid-scene-interval",
        severity: "error",
        message: `Scene state "${name}" requires a non-empty script interval.`,
        range: { ...sentence.payload.name.range },
      });
      return;
    }
    const definition = existingState ?? this.ensureSceneDefinition(
      name,
      sentence.payload.name.range,
      sentence.range.start,
      input.sceneVisibleUntil.offset,
      diagnostics,
    );
    if (definition === null) return;

    const expression = this.parseAndBind(slice.raw, slice.range.start, sentence.range.start);
    expressionDiagnostics.push(...expression.diagnostics);
    if (!expression.complete) return;
    assignments.push(createAssignmentSeed(assignments.length, sentence, definition, expression.expression));
  }

  private parseAndBind(raw: string, baseOffset: number, at: number): ExpressionBindingResult {
    const parsed = parseExpression(raw, baseOffset);
    if (parsed.diagnostics.some((entry) => entry.severity === "error")) {
      return {
        expression: { ...parsed.expression, type: "bound-error-expression" },
        diagnostics: parsed.diagnostics,
        complete: false,
      };
    }
    const bound = this.binder.bind(parsed.expression, { offset: at });
    return {
      expression: bound.expression,
      diagnostics: [...parsed.diagnostics, ...bound.diagnostics],
      complete: bound.complete,
    };
  }

  private ensureDocumentDefinition(
    name: string,
    range: { start: number; end: number },
    documentEnd: number,
    source: "definition" | "frontmatter",
    diagnostics: StateLoweringDiagnostic[],
  ): ScopeDefinition | null {
    const existing = this.definitions.named(name);
    if (existing.length === 1 && existing[0]?.kind === "var") return existing[0];
    if (existing.length > 0) {
      diagnostics.push(targetConflict(name, range));
      return null;
    }
    return this.definitions.add({
      name,
      kind: "var",
      level: "document",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: documentEnd },
      payload: null,
      declarationRange: { ...range },
      source,
    });
  }

  private ensureSceneDefinition(
    name: string,
    range: { start: number; end: number },
    visibleFrom: number,
    visibleUntil: number,
    diagnostics: StateLoweringDiagnostic[],
  ): ScopeDefinition | null {
    const existing = this.definitions.named(name);
    if (existing.length > 0) {
      diagnostics.push(targetConflict(name, range));
      return null;
    }
    return this.definitions.add({
      name,
      kind: "state",
      level: "scene",
      visibleFrom: { offset: visibleFrom },
      visibleUntil: { offset: visibleUntil },
      payload: null,
      declarationRange: { ...range },
      source: "definition",
    });
  }
}

function createAssignmentSeed(
  sequence: number,
  sentence: StateSentenceInput["sentence"],
  definition: ScopeDefinition,
  expression: BoundExpression,
): AssignmentSeed {
  return {
    id: `assignment:${sequence}:${sentence.range.start}`,
    sequence,
    scriptOffset: sentence.range.start,
    target: stateKeyFromDefinition(definition),
    expression,
    evaluationTiming: "assignment-arrival",
    range: { ...sentence.range },
  };
}

function isDefiniteStateExpression(
  expression: ExpressionAst,
  raw: string,
  preliminary: ExpressionBindingResult | null,
): boolean {
  if (preliminary?.complete) return true;
  switch (expression.type) {
    case "literal-expression":
    case "unary-expression":
    case "binary-expression":
    case "conditional-expression":
      return true;
    case "group-expression":
      return isDefiniteStateExpression(expression.expression, raw, preliminary);
    case "name-expression":
      return /^(?:var\.)/u.test(raw.trim());
    case "error-expression":
      return /^(?:[\d"'(!+-]|true\b|false\b|var\.)/u.test(raw.trim());
  }
}

function targetConflict(
  name: string,
  range: { start: number; end: number },
): StateLoweringDiagnostic {
  return {
    code: "state-lowering-target-conflict",
    severity: "error",
    message: `State assignment target "${name}" conflicts with an existing non-state definition.`,
    range: { ...range },
  };
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_\p{L}][A-Za-z0-9_\-\p{L}\p{N}]*$/u.test(value);
}
