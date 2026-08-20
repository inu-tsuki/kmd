import type { CommandMemberAst } from "../chainSyntax/types";
import { SemanticLowerer } from "../semantic/SemanticLowerer";
import type {
  SemanticCommandMember,
  SemanticExecutableMember,
} from "../semantic/types";
import type {
  ResolvedSentence,
  ResolvedSubject,
  ScopeDefinition,
} from "../scope/types";
import type {
  ObjectMutationDiagnostic,
  ObjectMutationLoweringResult,
  ObjectMutationMemberPolicy,
  ObjectMutationOperation,
  ObjectMutationSeed,
} from "./types";

interface MutationMode {
  operation: ObjectMutationOperation;
  memberPolicy: ObjectMutationMemberPolicy;
  firstOperator: CommandMemberAst["op"];
}

/**
 * Produces scene-build mutation seeds only. Applying them to renderer objects
 * belongs to the future middleware/runtime switch and is deliberately absent.
 */
export class ObjectMutationLowerer {
  private readonly semantic = new SemanticLowerer();

  public lower(sentences: readonly ResolvedSentence[]): ObjectMutationLoweringResult {
    const mutations: ObjectMutationSeed[] = [];
    const diagnostics: ObjectMutationDiagnostic[] = [];
    const semanticDiagnostics: ObjectMutationLoweringResult["semanticDiagnostics"] = [];
    const scopeDiagnostics: ObjectMutationLoweringResult["scopeDiagnostics"] = [];
    const ordered = [...sentences].sort((left, right) => (
      left.source.range.start - right.source.range.start
      || left.source.range.end - right.source.range.end
    ));

    for (const source of ordered) {
      scopeDiagnostics.push(...source.diagnostics);
      const target = objectTarget(source.subject);
      if (target === null) {
        if (source.source.kind === "member-op") {
          diagnostics.push({
            code: "object-mutation-target-required",
            severity: "error",
            message: "A signed member operation requires an explicit scene object subject.",
            range: { ...source.source.range },
          });
        }
        continue;
      }
      if (source.source.kind !== "predicate" && source.source.kind !== "member-op") continue;

      const mode = mutationMode(source);
      if (mode === null) {
        diagnostics.push({
          code: "object-mutation-command-required",
          severity: "error",
          message: `Object mutation for "${target.name}" requires at least one command member.`,
          range: { ...source.source.range },
        });
        continue;
      }
      const lowered = this.semantic.lowerSentence(source, { allowMemberOperation: true });
      semanticDiagnostics.push(...lowered.diagnostics);
      const semanticMembers = executableMembers(lowered.sentence);
      if (!lowered.complete || semanticMembers.length === 0) {
        diagnostics.push({
          code: "object-mutation-semantic-incomplete",
          severity: "error",
          message: `Object mutation for "${target.name}" contains unresolved semantic members.`,
          range: { ...source.source.range },
        });
        continue;
      }
      const validation = validateMembers(mode, semanticMembers, source.source.range);
      diagnostics.push(...validation);
      if (validation.length > 0) continue;

      mutations.push({
        id: `object-mutation:${mutations.length}:${source.source.range.start}:${target.name}`,
        sequence: mutations.length,
        scriptOffset: source.source.range.start,
        target,
        operation: mode.operation,
        memberPolicy: mode.memberPolicy,
        semanticMembers,
        semanticSentence: lowered.sentence,
        source,
        range: { ...source.source.range },
      });
    }

    return {
      mutations,
      diagnostics,
      semanticDiagnostics,
      scopeDiagnostics,
      complete: diagnostics.length === 0
        && semanticDiagnostics.every((entry) => entry.severity !== "error")
        && scopeDiagnostics.every((entry) => entry.severity !== "error"),
    };
  }
}

function objectTarget(subject: ResolvedSubject | null): ScopeDefinition | null {
  if (
    subject?.kind !== "selector"
    || subject.selector.kind !== "definition"
    || subject.selector.definition.kind !== "object"
  ) {
    return null;
  }
  return subject.selector.definition;
}

function mutationMode(source: ResolvedSentence): MutationMode | null {
  if (source.source.kind === "predicate") {
    return { operation: "replace", memberPolicy: "replace-chain", firstOperator: null };
  }
  const first = source.source.beats[0]?.members[0];
  if (first?.type !== "command-member") return null;
  if (first.op === null) return null;
  if (first.op === "+") {
    return { operation: "upsert", memberPolicy: "merge-arguments", firstOperator: "+" };
  }
  return { operation: "remove", memberPolicy: "remove-by-name", firstOperator: "-" };
}

function executableMembers(sentence: { beats: Array<{ members: unknown[] }> }): SemanticExecutableMember[] {
  const result: SemanticExecutableMember[] = [];
  for (const beat of sentence.beats) {
    for (const member of beat.members) {
      if (
        typeof member === "object"
        && member !== null
        && (
          (member as { type?: unknown }).type === "semantic-command-member"
          || (member as { type?: unknown }).type === "semantic-clause-member"
        )
      ) {
        result.push(member as SemanticExecutableMember);
      }
    }
  }
  return result;
}

function validateMembers(
  mode: MutationMode,
  members: readonly SemanticExecutableMember[],
  range: { start: number; end: number },
): ObjectMutationDiagnostic[] {
  const diagnostics: ObjectMutationDiagnostic[] = [];
  const commands = members.filter((member): member is SemanticCommandMember => (
    member.type === "semantic-command-member"
  ));
  if (mode.operation !== "replace" && commands.length !== members.length) {
    diagnostics.push({
      code: "object-mutation-command-required",
      severity: "error",
      message: "Signed object mutations accept command members only; clauses remain valid in replacement chains.",
      range: { ...range },
    });
    return diagnostics;
  }

  const invalidOperator = commands.some((command, index) => {
    if (mode.operation === "replace") return command.operator !== null;
    if (index === 0) return command.operator !== mode.firstOperator;
    return command.operator !== null && command.operator !== mode.firstOperator;
  });
  if (invalidOperator) {
    diagnostics.push({
      code: "object-mutation-invalid-operator",
      severity: "error",
      message: "One object mutation sentence cannot mix replacement, append, and removal operators.",
      range: { ...range },
    });
  }
  if (mode.operation === "remove" && commands.some((command) => command.args.length > 0)) {
    diagnostics.push({
      code: "object-mutation-remove-arguments",
      severity: "error",
      message: "Object member removal identifies commands by name and does not accept arguments.",
      range: { ...range },
    });
  }
  return diagnostics;
}
