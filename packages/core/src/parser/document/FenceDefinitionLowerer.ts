import type { DefinitionIndex } from "../scope/DefinitionIndex";
import type { ScopeDefinition } from "../scope/types";
import type { DocumentAst, FenceDefinitionResult, FenceObjectBinding } from "./types";

export class FenceDefinitionLowerer {
  private readonly definitions: DefinitionIndex;

  public constructor(definitions: DefinitionIndex) {
    this.definitions = definitions;
  }

  public lower(document: DocumentAst): FenceDefinitionResult {
    const definitions: ScopeDefinition<FenceObjectBinding>[] = [];
    for (const scene of document.scenes) {
      for (const fence of scene.fences) {
        const payload: FenceObjectBinding = {
          type: "fence-object-binding",
          fenceId: fence.id,
          sceneIndex: scene.index,
          contentRange: { ...fence.contentRange },
          coveredLineRanges: fence.coveredLineRanges.map((range) => ({ ...range })),
        };
        definitions.push(this.definitions.add({
          name: fence.name,
          kind: "object",
          level: "scene",
          visibleFrom: { offset: fence.openRange.start },
          visibleUntil: { offset: scene.range.end },
          payload,
          declarationRange: { ...fence.openRange },
          source: "fence",
        }));
      }
    }
    const scopeDiagnostics = this.definitions.diagnosticsSnapshot();
    return {
      definitions,
      diagnostics: [...document.diagnostics],
      scopeDiagnostics,
      complete: document.diagnostics.length === 0
        && scopeDiagnostics.every((entry) => entry.severity !== "error"),
    };
  }
}
