import type {
  ChainExpressionAst,
  CommandMemberAst,
  IdentifierAst,
  MemberAst,
  SentenceAst,
} from "../chainSyntax/types";
import type { ScopeResolver } from "./ScopeResolver";
import {
  isSelectorAccessorMember,
  isSelectorConstructorMember,
  SelectorResolver,
} from "./SelectorResolver";
import type {
  BraceGroupInput,
  ResolvedBeat,
  ResolvedCommand,
  ResolvedCommandMember,
  ResolvedExpression,
  ResolvedMember,
  ResolvedSentence,
  ResolvedSubject,
  ScopeDiagnostic,
  ScriptPosition,
  SpatialSelector,
  SubjectResolutionContext,
} from "./types";

interface SentenceSubjectSeed {
  subject: ResolvedSubject | null;
  commandHead: ResolvedCommand | null;
  diagnostics: ScopeDiagnostic[];
  selectorConstructor: CommandMemberAst | null;
  canConsumeAccessors: boolean;
}

export class SubjectResolver {
  private readonly selectors = new SelectorResolver();
  private readonly scopes: ScopeResolver;

  constructor(scopes: ScopeResolver) {
    this.scopes = scopes;
  }

  public resolveExpression(
    expression: ChainExpressionAst,
    context: SubjectResolutionContext = {},
  ): ResolvedExpression {
    const groups = context.braceGroups ?? [];
    const sentences: ResolvedSentence[] = [];
    const diagnostics: ScopeDiagnostic[] = [];
    let sequenceIndex = 0;
    let sequenceCount = 0;

    for (const sentence of expression.sentences) {
      const at = context.at ?? { offset: sentence.range.start };
      if (sentence.subject?.type === "selector-subject") {
        const selection = this.selectors.resolveBraced(sentence.subject, groups, sequenceIndex);
        sequenceIndex = selection.nextSequenceIndex;
        if (selection.usedSequence) sequenceCount += 1;
        const resolved = this.resolveSentence(sentence, at, groups, {
          subject: { kind: "selector", selector: selection.selector },
          commandHead: null,
          diagnostics: selection.diagnostics,
          selectorConstructor: null,
          canConsumeAccessors: true,
        });
        sentences.push(resolved);
        diagnostics.push(...resolved.diagnostics);
        continue;
      }

      const resolved = this.resolveSentence(sentence, at, groups);
      sentences.push(resolved);
      diagnostics.push(...resolved.diagnostics);
    }

    const countDiagnostics = this.selectors.validateSequenceCount(
      sequenceCount,
      groups.length,
      expression.range,
    );
    diagnostics.push(...countDiagnostics);
    return { source: expression, sentences, diagnostics };
  }

  /**
   * Resolves a macro/choice fragment at its expansion point. A leading dot or
   * omitted subject inherits the caller subject; explicit built-ins and object
   * subjects keep their own binding.
   */
  public resolveFragmentSentence(
    sentence: SentenceAst,
    inheritedSubject: ResolvedSubject | null,
    context: SubjectResolutionContext = {},
  ): ResolvedSentence {
    const at = context.at ?? { offset: sentence.range.start };
    const groups = context.braceGroups ?? [];
    const seed = this.resolveFragmentSubjectSeed(sentence, inheritedSubject, at, groups);
    return this.resolveSentence(sentence, at, groups, seed);
  }

  private resolveSentence(
    sentence: SentenceAst,
    at: ScriptPosition,
    groups: readonly BraceGroupInput[],
    providedSeed?: SentenceSubjectSeed,
  ): ResolvedSentence {
    if (sentence.kind === "definition" || sentence.kind === "assignment") {
      return {
        source: sentence,
        subject: null,
        commandHead: null,
        beats: [],
        diagnostics: [],
      };
    }

    const seed = providedSeed ?? this.resolveSubjectSeed(sentence, at, groups);
    const diagnostics = [...seed.diagnostics];
    let activeSelector = seed.subject?.kind === "selector" ? seed.subject.selector : null;
    let selectorConstructor = seed.selectorConstructor;
    let mayConsumeAccessor = seed.canConsumeAccessors;

    const beats: ResolvedBeat[] = sentence.beats.map((beat, beatIndex) => {
      const members: ResolvedMember[] = [];
      for (let memberIndex = 0; memberIndex < beat.members.length; memberIndex += 1) {
        const member = beat.members[memberIndex]!;
        if (member.type === "command-member") {
          if (beatIndex === 0 && member === selectorConstructor) {
            members.push(selectorRoleMember(member, "selector-constructor"));
            selectorConstructor = null;
            continue;
          }

          if (
            beatIndex === 0
            && mayConsumeAccessor
            && activeSelector !== null
            && isSelectorAccessorMember(member)
          ) {
            const accessed = this.selectors.applyAccessor(activeSelector, member);
            diagnostics.push(...accessed.diagnostics);
            if (accessed.selector !== null) {
              activeSelector = accessed.selector;
            }
            members.push(selectorRoleMember(member, "selector-accessor"));
            continue;
          }

          mayConsumeAccessor = false;
          const command = this.resolvePredicate(member, seed.subject);
          diagnostics.push(...command.diagnostics);
          members.push({
            type: "resolved-command-member",
            source: member,
            role: "predicate",
            command,
          });
          continue;
        }

        mayConsumeAccessor = false;
        members.push(this.resolveNonCommandMember(member, at, groups));
        const nested = members[members.length - 1];
        if (nested?.type === "resolved-clause-member") {
          diagnostics.push(...nested.sentence.diagnostics);
        }
      }
      return {
        source: beat,
        connectorBefore: beat.connectorBefore,
        members,
      };
    });

    const subject = activeSelector === null
      ? seed.subject
      : { kind: "selector" as const, selector: activeSelector };

    if (seed.commandHead?.family === "layout") {
      diagnostics.push(bareLayoutDiagnostic(seed.commandHead.source.range, seed.commandHead.name));
    } else if (sentence.subject === null && subject?.kind === "selector") {
      const firstPredicate = firstResolvedPredicate(beats);
      if (firstPredicate?.family === "layout") {
        diagnostics.push(bareLayoutDiagnostic(firstPredicate.source.range, firstPredicate.name));
      }
    }

    return {
      source: sentence,
      subject,
      commandHead: seed.commandHead,
      beats,
      diagnostics,
    };
  }

  private resolveSubjectSeed(
    sentence: SentenceAst,
    at: ScriptPosition,
    groups: readonly BraceGroupInput[],
  ): SentenceSubjectSeed {
    const syntaxSubject = sentence.subject;
    if (syntaxSubject?.type === "dot-subject") {
      return selectorSeed({
        kind: "line",
        valueType: "domain",
        source: "explicit-dot",
        range: { ...syntaxSubject.range },
      }, true);
    }

    if (syntaxSubject?.type === "selector-subject") {
      const selection = this.selectors.resolveBraced(syntaxSubject, groups, 0);
      return {
        ...selectorSeed(selection.selector, true),
        diagnostics: selection.diagnostics,
      };
    }

    if (syntaxSubject?.type === "identifier-subject") {
      if (syntaxSubject.name.name === "prev" || syntaxSubject.name.name === "next") {
        return selectorSeed({
          kind: "relative-line",
          valueType: "domain",
          direction: syntaxSubject.name.name,
          range: { ...syntaxSubject.range },
        }, true);
      }

      const resolution = this.scopes.resolve(syntaxSubject.name.name, at, syntaxSubject.range);
      if (resolution.status === "unresolved") {
        return {
          subject: null,
          commandHead: null,
          diagnostics: resolution.diagnostics,
          selectorConstructor: null,
          canConsumeAccessors: false,
        };
      }

      if (resolution.entity.kind === "command-head") {
        return {
          subject: {
            kind: "selector",
            selector: {
              kind: "line",
              valueType: "domain",
              source: "implicit-command",
              range: { ...syntaxSubject.range },
            },
          },
          commandHead: commandFromIdentifier(syntaxSubject.name, resolution.entity.command),
          diagnostics: resolution.diagnostics,
          selectorConstructor: null,
          canConsumeAccessors: false,
        };
      }

      if (
        resolution.entity.kind === "definition"
        && resolution.entity.definition.kind === "object"
      ) {
        return selectorSeed({
          kind: "definition",
          valueType: "domain",
          definition: resolution.entity.definition,
          range: { ...syntaxSubject.range },
        }, true);
      }

      return {
        subject: resolution.entity,
        commandHead: null,
        diagnostics: resolution.diagnostics,
        selectorConstructor: null,
        canConsumeAccessors: false,
      };
    }

    const first = firstCommandMember(sentence);
    if (first !== null && isSelectorConstructorMember(first)) {
      const construction = this.selectors.construct(first);
      if (construction.selector !== null) {
        return {
          ...selectorSeed(construction.selector, true),
          diagnostics: construction.diagnostics,
          selectorConstructor: first,
        };
      }
      return {
        subject: null,
        commandHead: null,
        diagnostics: construction.diagnostics,
        selectorConstructor: first,
        canConsumeAccessors: false,
      };
    }

    return selectorSeed(implicitLineSelector(sentence), false);
  }

  private resolveFragmentSubjectSeed(
    sentence: SentenceAst,
    inheritedSubject: ResolvedSubject | null,
    at: ScriptPosition,
    groups: readonly BraceGroupInput[],
  ): SentenceSubjectSeed {
    if (
      inheritedSubject !== null
      && (sentence.subject === null || sentence.subject.type === "dot-subject")
    ) {
      return inheritedSubjectSeed(inheritedSubject);
    }

    const syntaxSubject = sentence.subject;
    if (syntaxSubject?.type === "identifier-subject") {
      const resolution = this.scopes.resolve(syntaxSubject.name.name, at, syntaxSubject.range);
      if (resolution.status === "resolved" && resolution.entity.kind === "command-head") {
        return {
          subject: inheritedSubject ?? {
            kind: "selector",
            selector: {
              kind: "line",
              valueType: "domain",
              source: "implicit-command",
              range: { ...syntaxSubject.range },
            },
          },
          commandHead: commandFromIdentifier(syntaxSubject.name, resolution.entity.command),
          diagnostics: resolution.diagnostics,
          selectorConstructor: null,
          canConsumeAccessors: false,
        };
      }
    }

    return this.resolveSubjectSeed(sentence, at, groups);
  }

  private resolvePredicate(member: CommandMemberAst, subject: ResolvedSubject | null): ResolvedCommand {
    const name = commandNameForSubject(member.name.name, subject);
    const resolution = this.scopes.resolveCommand(name, member.name.range);
    return {
      name,
      family: resolution.match?.family ?? null,
      ...(resolution.match?.metadata === undefined
        ? {}
        : { metadata: resolution.match.metadata }),
      source: member,
      diagnostics: resolution.diagnostics,
    };
  }

  private resolveNonCommandMember(
    member: Exclude<MemberAst, CommandMemberAst>,
    at: ScriptPosition,
    groups: readonly BraceGroupInput[],
  ): ResolvedMember {
    if (member.type === "clause-member") {
      return {
        type: "resolved-clause-member",
        source: member,
        sentence: this.resolveSentence(member.sentence, at, groups),
      };
    }
    if (member.type === "reference-member") {
      return { type: "resolved-reference-member", source: member };
    }
    return { type: "resolved-error-member", source: member };
  }
}

function selectorSeed(selector: SpatialSelector, canConsumeAccessors: boolean): SentenceSubjectSeed {
  return {
    subject: { kind: "selector", selector },
    commandHead: null,
    diagnostics: [],
    selectorConstructor: null,
    canConsumeAccessors,
  };
}

function inheritedSubjectSeed(subject: ResolvedSubject): SentenceSubjectSeed {
  return {
    subject,
    commandHead: null,
    diagnostics: [],
    selectorConstructor: null,
    canConsumeAccessors: subject.kind === "selector",
  };
}

function implicitLineSelector(sentence: SentenceAst): SpatialSelector {
  return {
    kind: "line",
    valueType: "domain",
    source: "implicit-command",
    range: { start: sentence.range.start, end: sentence.range.start },
  };
}

function selectorRoleMember(
  source: CommandMemberAst,
  role: ResolvedCommandMember["role"],
): ResolvedCommandMember {
  return { type: "resolved-command-member", source, role, command: null };
}

function commandFromIdentifier(
  source: IdentifierAst,
  match: {
    name: string;
    family: ResolvedCommand["family"];
    metadata?: Readonly<Record<string, unknown>>;
  },
): ResolvedCommand {
  return {
    name: match.name,
    family: match.family,
    ...(match.metadata === undefined ? {} : { metadata: match.metadata }),
    source,
    diagnostics: [],
  };
}

function firstCommandMember(sentence: SentenceAst): CommandMemberAst | null {
  const first = sentence.beats[0]?.members[0];
  return first?.type === "command-member" ? first : null;
}

function firstResolvedPredicate(beats: readonly ResolvedBeat[]): ResolvedCommand | null {
  for (const beat of beats) {
    for (const member of beat.members) {
      if (member.type === "resolved-command-member" && member.role === "predicate") {
        return member.command;
      }
    }
  }
  return null;
}

function commandNameForSubject(name: string, subject: ResolvedSubject | null): string {
  if (subject?.kind !== "builtin") return name;
  if (subject.name === "bg") return name;
  return `${subject.name}.${name}`;
}

function bareLayoutDiagnostic(
  range: { start: number; end: number },
  command: string,
): ScopeDiagnostic {
  return {
    code: "scope-bare-layout-deprecated",
    severity: "warning",
    message: `Bare layout command "${command}" is deprecated; write it with the explicit line subject, for example .${command}.`,
    range: { ...range },
  };
}
