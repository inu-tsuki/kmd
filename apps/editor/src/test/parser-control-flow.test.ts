import { describe, expect, it } from "vitest";
import { ControlFlowLowerer } from "@kmd/core/parser/control/ControlFlowLowerer";
import { parseDocumentStructure } from "@kmd/core/parser/document/DocumentParser";
import { stateKeyFromDefinition } from "@kmd/core/parser/expression/ExpressionBinder";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { StateStore } from "@kmd/core/state/StateStore";

describe("parser-control-flow: B2 anchors and edge seeds", () => {
  it("binds paragraph presence for scene bake and routing conditions for edge arrival", () => {
    const source = [
      "# start",
      "[if var.a]",
      "[if var.b]",
      "body",
      "[if var.a -> #end | else -> #start]",
      "# end",
      "-> #start",
    ].join("\n");
    const document = parseDocumentStructure(source);
    const definitions = new DefinitionIndex();
    const entries = (["a", "b"] as const).map((name) => {
      const definition = definitions.add({
        name,
        kind: "var",
        level: "document",
        visibleFrom: { offset: 0 },
        visibleUntil: { offset: source.length },
        payload: null,
        declarationRange: { start: 0, end: name.length },
        source: "frontmatter",
      });
      return { name, key: stateKeyFromDefinition(definition) };
    });
    const scopes = new ScopeResolver(
      definitions,
      createStaticScopeCommandRegistryView([]),
    );
    const lowerer = new ControlFlowLowerer(scopes);
    const lowered = lowerer.lower(document);

    expect(lowered.complete).toBe(true);
    expect(lowered.anchors).toMatchObject([
      { name: "start", rendered: false },
      { name: "end", rendered: false },
    ]);
    expect(lowered.presenceSeeds).toMatchObject([{
      conditions: [{ type: "bound-state-ref-expression" }, { type: "bound-state-ref-expression" }],
      evaluationTiming: "scene-bake",
    }]);
    expect(lowered.edgeSeeds).toHaveLength(3);
    expect(lowered.edgeSeeds).toMatchObject([
      { sourceKind: "routing", targetName: "end", evaluationTiming: "edge-arrival" },
      { sourceKind: "routing", targetName: "start", condition: null, evaluationTiming: "edge-arrival" },
      { sourceKind: "goto", targetName: "start", condition: null, evaluationTiming: "edge-arrival" },
    ]);
    expect(lowered.edgeSeeds[2]!.targetPosition!.offset).toBeLessThan(
      lowered.edgeSeeds[2]!.sourcePosition.offset,
    );

    const state = new StateStore([
      { key: entries[0]!.key, value: true },
      { key: entries[1]!.key, value: false },
    ]);
    expect(lowerer.evaluatePresence(lowered.presenceSeeds[0]!, { state })).toMatchObject({
      present: false,
      complete: true,
      diagnostics: [],
    });
    state.set(entries[1]!.key, true);
    expect(lowerer.evaluatePresence(lowered.presenceSeeds[0]!, { state })).toMatchObject({
      present: true,
      complete: true,
      diagnostics: [],
    });
  });

  it("reports duplicate anchors and every unresolved target without entering DefinitionIndex", () => {
    const source = "# same\n# same\n-> #missing\n[if true -> #also-missing]";
    const document = parseDocumentStructure(source);
    const scopes = new ScopeResolver(
      new DefinitionIndex(),
      createStaticScopeCommandRegistryView([]),
    );
    const lowered = new ControlFlowLowerer(scopes).lower(document);

    expect(lowered.complete).toBe(false);
    expect(lowered.diagnostics.map((entry) => entry.code)).toEqual([
      "control-duplicate-anchor",
      "control-undefined-anchor",
      "control-undefined-anchor",
    ]);
    expect(lowered.anchors).toHaveLength(2);
    expect(lowered.edgeSeeds.every((edge) => edge.targetAnchorId === null)).toBe(true);
  });

  it("defers presence type checking to scene bake and preserves the structured diagnostic", () => {
    const document = parseDocumentStructure("[if 1]\nbody");
    const scopes = new ScopeResolver(
      new DefinitionIndex(),
      createStaticScopeCommandRegistryView([]),
    );
    const lowerer = new ControlFlowLowerer(scopes);
    const lowered = lowerer.lower(document);

    expect(lowered.complete).toBe(true);
    expect(lowerer.evaluatePresence(lowered.presenceSeeds[0]!, {
      state: new StateStore(),
    })).toMatchObject({
      present: null,
      complete: false,
      diagnostics: [{ code: "control-presence-non-boolean", severity: "error" }],
    });
  });
});
