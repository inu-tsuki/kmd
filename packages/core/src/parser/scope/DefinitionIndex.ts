import type { SentenceAst } from "../chainSyntax/types";
import type {
  DefinitionSentenceInput,
  ScopeDefinition,
  ScopeDefinitionInput,
  ScopeDiagnostic,
  ScriptPosition,
} from "./types";

export class DefinitionIndex {
  private readonly definitions: ScopeDefinition[] = [];
  private readonly diagnostics: ScopeDiagnostic[] = [];

  public add<TPayload>(input: ScopeDefinitionInput<TPayload>): ScopeDefinition<TPayload> {
    const definition: ScopeDefinition<TPayload> = {
      ...input,
      qualifiedName: input.level === "document" && input.kind === "var"
        ? `var.${input.name}`
        : input.name,
    };

    // D21 prohibits shadowing globally, so duplicates remain invalid even when
    // their visibility intervals do not overlap.
    const existing = this.definitions.filter((candidate) => candidate.name === input.name);
    if (existing.length > 0) {
      this.diagnostics.push({
        code: "scope-duplicate-definition",
        severity: "error",
        message: `Name "${input.name}" is declared more than once; KMD does not permit shadowing.`,
        range: { ...input.declarationRange },
      });
    }
    if (input.visibleUntil.offset <= input.visibleFrom.offset) {
      this.diagnostics.push({
        code: "scope-invalid-definition-interval",
        severity: "error",
        message: `Definition "${input.name}" must have a non-empty visibility interval.`,
        range: { ...input.declarationRange },
      });
    }

    this.definitions.push(definition);
    this.sortDefinitions();
    return definition;
  }

  public addSentence<TPayload>(input: DefinitionSentenceInput<TPayload>): ScopeDefinition<TPayload> | null {
    const { sentence } = input;
    if (sentence.kind === "definition" && sentence.payload?.name) {
      return this.add({
        name: sentence.payload.name.name,
        kind: "macro",
        level: "scene",
        visibleFrom: { offset: sentence.range.start },
        visibleUntil: input.visibleUntil,
        payload: input.payload === undefined
          ? (sentence.payload.slice as TPayload)
          : input.payload,
        declarationRange: { ...sentence.payload.name.range },
        source: "definition",
      });
    }

    const path = sentence.payload?.path;
    if (sentence.kind === "assignment" && path?.length === 2 && path[0]?.name === "var") {
      const name = path[1]!;
      const slice = sentence.payload?.slice;
      return this.add({
        name: name.name,
        kind: "var",
        level: "document",
        visibleFrom: { offset: 0 },
        visibleUntil: input.visibleUntil,
        payload: input.payload === undefined ? (slice as TPayload) : input.payload,
        declarationRange: { start: path[0]!.range.start, end: name.range.end },
        source: "definition",
      });
    }

    return null;
  }

  public all(): readonly ScopeDefinition[] {
    return this.definitions;
  }

  public diagnosticsSnapshot(): readonly ScopeDiagnostic[] {
    return this.diagnostics;
  }

  public named(name: string): readonly ScopeDefinition[] {
    const normalized = normalizeLookupName(name);
    return this.definitions.filter((definition) => definition.name === normalized);
  }

  public visible(name: string, at: ScriptPosition): readonly ScopeDefinition[] {
    return this.named(name).filter((definition) => isVisibleAt(definition, at));
  }

  private sortDefinitions(): void {
    this.definitions.sort((left, right) => (
      left.visibleFrom.offset - right.visibleFrom.offset
      || left.visibleUntil.offset - right.visibleUntil.offset
      || left.name.localeCompare(right.name)
    ));
  }
}

export function isVisibleAt(definition: ScopeDefinition, at: ScriptPosition): boolean {
  return definition.visibleFrom.offset <= at.offset && at.offset < definition.visibleUntil.offset;
}

function normalizeLookupName(name: string): string {
  return name.startsWith("var.") ? name.slice("var.".length) : name;
}

export function collectDefinitionSentences(
  index: DefinitionIndex,
  sentences: readonly SentenceAst[],
  visibleUntil: ScriptPosition,
): void {
  for (const sentence of sentences) {
    index.addSentence({ sentence, visibleUntil });
  }
}
