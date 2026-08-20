import type { StateReadView } from "../../state/StateStore";
import { parseChainSyntax } from "../chainSyntax/ChainSyntaxParser";
import type {
  ClauseMemberAst,
  ReferenceMemberAst,
} from "../chainSyntax/types";
import { ExpressionBinder } from "../expression/ExpressionBinder";
import { ExpressionEvaluator } from "../expression/ExpressionEvaluator";
import type { DefinitionIndex } from "../scope/DefinitionIndex";
import type { ScopeResolver } from "../scope/ScopeResolver";
import type { SubjectResolver } from "../scope/SubjectResolver";
import type {
  MacroExpansionOrigin,
  ResolvedBeat,
  ResolvedClauseMember,
  ResolvedExpression,
  ResolvedMember,
  ResolvedReferenceMember,
  ResolvedSentence,
  ResolvedSubject,
  ScopeDefinition,
  ScopeDiagnostic,
  SubjectResolutionContext,
} from "../scope/types";
import { parseMacroChoice } from "./MacroChoiceParser";
import type {
  MacroChoiceNode,
  MacroDefinition,
  MacroDiagnostic,
  MacroExpansionInput,
  MacroExpansionResult,
} from "./types";

interface ExpansionCollection {
  diagnostics: MacroDiagnostic[];
  syntaxDiagnostics: MacroExpansionResult["syntaxDiagnostics"];
  expressionDiagnostics: MacroExpansionResult["expressionDiagnostics"];
  scopeDiagnostics: ScopeDiagnostic[];
  origins: MacroExpansionOrigin[];
}

interface ExpansionFrame {
  state: StateReadView;
  context: SubjectResolutionContext;
  lookupOffset: number;
  stack: string[];
  path: string;
  depth: number;
}

interface ExpandedReference {
  member: ResolvedClauseMember | ResolvedReferenceMember | null;
}

export class MacroExpander {
  private readonly binder: ExpressionBinder;
  private readonly definitions: DefinitionIndex;
  private readonly evaluator = new ExpressionEvaluator();
  private readonly subjects: SubjectResolver;
  private readonly maxDepth: number;

  public constructor(
    definitions: DefinitionIndex,
    scopes: ScopeResolver,
    subjects: SubjectResolver,
    maxDepth = 32,
  ) {
    this.definitions = definitions;
    this.binder = new ExpressionBinder(scopes);
    this.subjects = subjects;
    this.maxDepth = maxDepth;
  }

  public expand(input: MacroExpansionInput): MacroExpansionResult {
    const collection: ExpansionCollection = {
      diagnostics: [],
      syntaxDiagnostics: [],
      expressionDiagnostics: [],
      scopeDiagnostics: [],
      origins: [],
    };
    const sentences = input.expression.sentences.map((sentence, index) => this.expandSentence(
      sentence,
      {
        state: input.state,
        context: input.context ?? {},
        lookupOffset: input.context?.at?.offset ?? sentence.source.range.start,
        stack: [],
        path: `root:${index}:${sentence.source.range.start}`,
        depth: 0,
      },
      collection,
    ));
    const scopeDiagnostics = [
      ...input.expression.diagnostics,
      ...collection.scopeDiagnostics,
    ];
    const expression: ResolvedExpression = {
      ...input.expression,
      sentences,
      diagnostics: scopeDiagnostics,
    };
    const complete = collection.diagnostics.length === 0
      && collection.syntaxDiagnostics.every((entry) => entry.severity !== "error")
      && collection.expressionDiagnostics.every((entry) => entry.severity !== "error")
      && scopeDiagnostics.every((entry) => entry.severity !== "error")
      && !containsReference(expression);
    return {
      expression,
      diagnostics: collection.diagnostics,
      syntaxDiagnostics: collection.syntaxDiagnostics,
      expressionDiagnostics: collection.expressionDiagnostics,
      scopeDiagnostics,
      origins: collection.origins,
      complete,
    };
  }

  private expandSentence(
    source: ResolvedSentence,
    frame: ExpansionFrame,
    collection: ExpansionCollection,
  ): ResolvedSentence {
    const beats: ResolvedBeat[] = source.beats.map((beat, beatIndex) => {
      const members: ResolvedMember[] = [];
      for (let memberIndex = 0; memberIndex < beat.members.length; memberIndex += 1) {
        const member = beat.members[memberIndex]!;
        if (member.type === "resolved-reference-member") {
          const referencePath = `${frame.path}/b${beatIndex}m${memberIndex}`;
          const expanded = this.expandReference(
            member,
            source.subject,
            { ...frame, path: referencePath },
            collection,
          );
          if (expanded.member !== null) members.push(expanded.member);
          continue;
        }
        if (member.type === "resolved-clause-member") {
          members.push({
            ...member,
            sentence: this.expandSentence(
              member.sentence,
              { ...frame, path: `${frame.path}/b${beatIndex}m${memberIndex}c` },
              collection,
            ),
          });
          continue;
        }
        members.push(member);
      }
      return { ...beat, members };
    });
    return { ...source, beats };
  }

  private expandReference(
    source: ResolvedReferenceMember,
    inheritedSubject: ResolvedSubject | null,
    frame: ExpansionFrame,
    collection: ExpansionCollection,
  ): ExpandedReference {
    const reference = source.source;
    const lookupOffset = frame.depth === 0
      ? frame.context.at?.offset ?? reference.range.start
      : frame.lookupOffset;
    const nextFrame = { ...frame, lookupOffset };

    if (reference.form === "name") {
      const definition = this.requireMacro(reference.delimited, lookupOffset, reference, collection);
      if (definition === null) return { member: source };
      return this.expandMacroDefinition(definition, reference, inheritedSubject, nextFrame, collection);
    }

    const choiceOffset = reference.range.start + 2;
    const parsed = parseMacroChoice(reference.delimited, choiceOffset);
    collection.diagnostics.push(...parsed.diagnostics);
    collection.expressionDiagnostics.push(...parsed.expressionDiagnostics);
    if (!parsed.complete) return { member: source };
    return this.expandChoice(parsed.choice, reference, inheritedSubject, nextFrame, collection);
  }

  private expandChoice(
    choice: MacroChoiceNode,
    reference: ReferenceMemberAst,
    inheritedSubject: ResolvedSubject | null,
    frame: ExpansionFrame,
    collection: ExpansionCollection,
  ): ExpandedReference {
    if (choice.type === "macro-choice-conditional") {
      const bound = this.binder.bind(choice.condition, { offset: frame.lookupOffset });
      collection.expressionDiagnostics.push(...bound.diagnostics);
      if (!bound.complete) {
        return { member: { type: "resolved-reference-member", source: reference } };
      }
      const evaluated = this.evaluator.evaluate(bound.expression, frame.state);
      collection.expressionDiagnostics.push(...evaluated.diagnostics);
      if (!evaluated.complete) {
        return { member: { type: "resolved-reference-member", source: reference } };
      }
      if (typeof evaluated.value !== "boolean") {
        collection.diagnostics.push({
          code: "macro-choice-condition-not-boolean",
          severity: "error",
          message: "Macro choice condition must evaluate to a boolean value.",
          range: { ...choice.condition.range },
        });
        return { member: { type: "resolved-reference-member", source: reference } };
      }
      return this.expandChoice(
        evaluated.value ? choice.whenTrue : choice.whenFalse,
        reference,
        inheritedSubject,
        frame,
        collection,
      );
    }

    if (choice.raw.length === 0) return { member: null };
    if (isIdentifier(choice.raw)) {
      const existing = this.definitions.named(choice.raw);
      if (existing.length > 0) {
        const definition = this.requireMacro(choice.raw, frame.lookupOffset, reference, collection);
        if (definition === null) {
          return { member: { type: "resolved-reference-member", source: reference } };
        }
        return this.expandMacroDefinition(definition, reference, inheritedSubject, frame, collection);
      }
    }
    return this.expandInlineChain(choice.raw, choice.range.start, reference, inheritedSubject, frame, collection);
  }

  private expandMacroDefinition(
    definition: ScopeDefinition<MacroDefinition>,
    reference: ReferenceMemberAst,
    inheritedSubject: ResolvedSubject | null,
    frame: ExpansionFrame,
    collection: ExpansionCollection,
  ): ExpandedReference {
    if (!definition.payload.complete) {
      collection.diagnostics.push({
        code: "macro-definition-unusable",
        severity: "error",
        message: `Macro "${definition.name}" has an invalid definition body and cannot be expanded.`,
        range: { ...reference.range },
      });
      return { member: { type: "resolved-reference-member", source: reference } };
    }
    if (frame.stack.includes(definition.payload.id)) {
      collection.diagnostics.push({
        code: "macro-expansion-cycle",
        severity: "error",
        message: `Macro expansion cycle detected: ${[...frame.stack, definition.payload.id].join(" -> ")}.`,
        range: { ...reference.range },
      });
      return { member: { type: "resolved-reference-member", source: reference } };
    }
    if (frame.depth >= this.maxDepth) {
      collection.diagnostics.push({
        code: "macro-expansion-depth-exceeded",
        severity: "error",
        message: `Macro expansion exceeded the configured depth limit of ${this.maxDepth}.`,
        range: { ...reference.range },
      });
      return { member: { type: "resolved-reference-member", source: reference } };
    }

    const origin = createOrigin(
      definition.name,
      definition.payload.definitionRange,
      reference,
      `${frame.path}/macro:${definition.payload.id}`,
      `${definition.payload.localTimelineTemplateId}@${frame.path}`,
    );
    const resolved = this.subjects.resolveFragmentSentence(
      definition.payload.sentence,
      inheritedSubject,
      {
        ...frame.context,
        at: { offset: frame.lookupOffset },
      },
    );
    collection.scopeDiagnostics.push(...resolved.diagnostics);
    const expanded = this.expandSentence(
      resolved,
      {
        ...frame,
        stack: [...frame.stack, definition.payload.id],
        depth: frame.depth + 1,
        path: origin.expansionId,
      },
      collection,
    );
    collection.origins.push(origin);
    return { member: syntheticClause(reference, expanded, origin) };
  }

  private expandInlineChain(
    raw: string,
    baseOffset: number,
    reference: ReferenceMemberAst,
    inheritedSubject: ResolvedSubject | null,
    frame: ExpansionFrame,
    collection: ExpansionCollection,
  ): ExpandedReference {
    const parsed = parseChainSyntax(raw, baseOffset);
    collection.syntaxDiagnostics.push(...parsed.diagnostics);
    if (parsed.expression.sentences.length !== 1) {
      collection.diagnostics.push({
        code: "macro-expansion-multiple-sentences",
        severity: "error",
        message: "An inline macro choice must produce exactly one chain sentence in B0.4.",
        range: { start: baseOffset, end: baseOffset + raw.length },
      });
      return { member: { type: "resolved-reference-member", source: reference } };
    }
    const sentence = parsed.expression.sentences[0]!;
    if (sentence.kind !== "predicate" && sentence.kind !== "member-op") {
      collection.diagnostics.push({
        code: "macro-expansion-invalid-sentence",
        severity: "error",
        message: "Macro choice result must be an executable chain fragment.",
        range: { ...sentence.range },
      });
      return { member: { type: "resolved-reference-member", source: reference } };
    }
    if (parsed.diagnostics.some((entry) => entry.severity === "error")) {
      return { member: { type: "resolved-reference-member", source: reference } };
    }

    const origin = createOrigin(
      null,
      null,
      reference,
      `${frame.path}/inline:${baseOffset}`,
      `inline-timeline:${baseOffset}@${frame.path}`,
    );
    const resolved = this.subjects.resolveFragmentSentence(sentence, inheritedSubject, {
      ...frame.context,
      at: { offset: frame.lookupOffset },
    });
    collection.scopeDiagnostics.push(...resolved.diagnostics);
    const expanded = this.expandSentence(
      resolved,
      { ...frame, depth: frame.depth + 1, path: origin.expansionId },
      collection,
    );
    collection.origins.push(origin);
    return { member: syntheticClause(reference, expanded, origin) };
  }

  private requireMacro(
    name: string,
    at: number,
    reference: ReferenceMemberAst,
    collection: ExpansionCollection,
  ): ScopeDefinition<MacroDefinition> | null {
    const named = this.definitions.named(name);
    if (named.length === 0) {
      collection.diagnostics.push({
        code: "macro-unknown-reference",
        severity: "error",
        message: `Macro "${name}" is not defined.`,
        range: { ...reference.range },
      });
      return null;
    }
    if (named.length !== 1) {
      collection.diagnostics.push({
        code: "macro-reference-kind-mismatch",
        severity: "error",
        message: `Macro reference "${name}" is ambiguous because the name has multiple definitions.`,
        range: { ...reference.range },
      });
      return null;
    }
    const definition = named[0]!;
    if (!(definition.visibleFrom.offset <= at && at < definition.visibleUntil.offset)) {
      collection.diagnostics.push({
        code: "macro-reference-out-of-scope",
        severity: "error",
        message: `Macro "${name}" is outside its scene visibility interval.`,
        range: { ...reference.range },
      });
      return null;
    }
    if (definition.kind !== "macro" || !isMacroDefinition(definition.payload)) {
      collection.diagnostics.push({
        code: "macro-reference-kind-mismatch",
        severity: "error",
        message: `Reference "$${name}" resolves to ${definition.kind}, but $name accepts only macros.`,
        range: { ...reference.range },
      });
      return null;
    }
    return definition as ScopeDefinition<MacroDefinition>;
  }
}

function createOrigin(
  macroName: string | null,
  definitionRange: { start: number; end: number } | null,
  reference: ReferenceMemberAst,
  expansionId: string,
  localTimelineId: string,
): MacroExpansionOrigin {
  return {
    kind: "macro-expansion",
    macroName,
    definitionRange: definitionRange === null ? null : { ...definitionRange },
    referenceRange: { ...reference.range },
    expansionId,
    localTimelineId,
  };
}

function syntheticClause(
  reference: ReferenceMemberAst,
  sentence: ResolvedSentence,
  origin: MacroExpansionOrigin,
): ResolvedClauseMember {
  const source: ClauseMemberAst = {
    type: "clause-member",
    raw: reference.raw,
    range: { ...reference.range },
    sentence: sentence.source,
    granularity: null,
    blocking: false,
  };
  return {
    type: "resolved-clause-member",
    source,
    sentence,
    origin,
  };
}

function isMacroDefinition(value: unknown): value is MacroDefinition {
  return value !== null
    && typeof value === "object"
    && (value as { type?: unknown }).type === "macro-definition";
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_\p{L}][A-Za-z0-9_\-\p{L}\p{N}]*$/u.test(value);
}

function containsReference(expression: ResolvedExpression): boolean {
  return expression.sentences.some(sentenceContainsReference);
}

function sentenceContainsReference(sentence: ResolvedSentence): boolean {
  return sentence.beats.some((beat) => beat.members.some((member) => (
    member.type === "resolved-reference-member"
    || (member.type === "resolved-clause-member" && sentenceContainsReference(member.sentence))
  )));
}
