import { parseChainSyntax } from "../chainSyntax/ChainSyntaxParser";
import type { DefinitionIndex } from "../scope/DefinitionIndex";
import type { ScopeDefinition } from "../scope/types";
import type { DeferredStateDefinition } from "../state/types";
import type {
  MacroDefinition,
  MacroDefinitionLoweringResult,
  MacroDiagnostic,
} from "./types";

export class MacroDefinitionLowerer {
  private readonly definitions: DefinitionIndex;

  public constructor(definitions: DefinitionIndex) {
    this.definitions = definitions;
  }

  public lower(deferred: readonly DeferredStateDefinition[]): MacroDefinitionLoweringResult {
    const definitions: ScopeDefinition<MacroDefinition>[] = [];
    const diagnostics: MacroDiagnostic[] = [];
    const syntaxDiagnostics: MacroDefinitionLoweringResult["syntaxDiagnostics"] = [];
    const entries = [...deferred].sort((left, right) => (
      left.sentence.range.start - right.sentence.range.start
      || left.sentence.range.end - right.sentence.range.end
    ));

    for (const entry of entries) {
      const source = entry.sentence;
      const name = source.payload?.name;
      const slice = source.payload?.slice;
      if (source.kind !== "definition" || name === undefined || slice === undefined) {
        diagnostics.push({
          code: "macro-invalid-definition",
          severity: "error",
          message: "Macro lowering requires a single-name definition sentence with a body.",
          range: { ...source.range },
        });
        continue;
      }

      const parsed = parseChainSyntax(slice.raw, slice.range.start);
      syntaxDiagnostics.push(...parsed.diagnostics);
      const body = parsed.expression.sentences[0]!;
      let bodyComplete = parsed.diagnostics.every((diagnostic) => diagnostic.severity !== "error");
      if (parsed.expression.sentences.length !== 1) {
        diagnostics.push({
          code: "macro-multiple-definition-sentences",
          severity: "error",
          message: `Macro "${name.name}" must contain exactly one chain sentence in B0.4.`,
          range: { ...slice.range },
        });
        bodyComplete = false;
      }
      if (body.kind !== "predicate" && body.kind !== "member-op") {
        diagnostics.push({
          code: "macro-invalid-definition-body",
          severity: "error",
          message: `Macro "${name.name}" must contain an executable chain fragment.`,
          range: { ...slice.range },
        });
        bodyComplete = false;
      }

      const payload: MacroDefinition = {
        type: "macro-definition",
        id: `macro:${name.name}:${source.range.start}`,
        name: name.name,
        sentence: body,
        definitionRange: { ...source.range },
        bodyRange: { ...slice.range },
        localTimelineTemplateId: `macro-timeline:${name.name}:${source.range.start}`,
        complete: bodyComplete,
      };
      definitions.push(this.definitions.add({
        name: name.name,
        kind: "macro",
        level: "scene",
        visibleFrom: { offset: source.range.start },
        visibleUntil: { ...entry.sceneVisibleUntil },
        payload,
        declarationRange: { ...name.range },
        source: "definition",
      }));
    }

    const scopeDiagnostics = this.definitions.diagnosticsSnapshot();
    return {
      definitions,
      diagnostics,
      syntaxDiagnostics,
      scopeDiagnostics,
      complete: diagnostics.length === 0
        && syntaxDiagnostics.every((entry) => entry.severity !== "error")
        && scopeDiagnostics.every((entry) => entry.severity !== "error")
        && definitions.every((definition) => definition.payload.complete),
    };
  }
}
