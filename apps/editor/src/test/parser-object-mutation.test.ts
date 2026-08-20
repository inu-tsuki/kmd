import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { MacroDefinitionLowerer } from "@kmd/core/parser/macro/MacroDefinitionLowerer";
import { MacroExpander } from "@kmd/core/parser/macro/MacroExpander";
import { ObjectMutationLowerer } from "@kmd/core/parser/object/ObjectMutationLowerer";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import type { DeferredStateDefinition } from "@kmd/core/parser/state/types";
import { StateStore } from "@kmd/core/state/StateStore";

const REGISTRY = createStaticScopeCommandRegistryView([
  { name: "red", family: "style" },
  { name: "wave", family: "effect" },
  { name: "shake", family: "effect" },
]);

function harness() {
  const definitions = new DefinitionIndex();
  definitions.add({
    name: "hero",
    kind: "object",
    level: "scene",
    visibleFrom: { offset: 0 },
    visibleUntil: { offset: 500 },
    payload: { fenceId: "hero-fence" },
    declarationRange: { start: 0, end: 4 },
    source: "fence",
  });
  const scopes = new ScopeResolver(definitions, REGISTRY);
  const subjects = new SubjectResolver(scopes);
  return { definitions, scopes, subjects };
}

function resolve(source: string, offset: number, subjects: SubjectResolver) {
  const parsed = parseChainSyntax(source, offset);
  expect(parsed.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  return subjects.resolveExpression(parsed.expression).sentences[0]!;
}

function deferred(source: string, offset: number): DeferredStateDefinition {
  return {
    sentence: parseChainSyntax(source, offset).expression.sentences[0]!,
    sceneVisibleUntil: { offset: 500 },
    reason: "macro-or-object",
  };
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((entry) => entry.code);
}

describe("parser-object-mutation: mutation seeds", () => {
  it("lowers replace, upsert, and remove with explicit member policies", () => {
    const { subjects } = harness();
    const result = new ObjectMutationLowerer().lower([
      resolve("hero.-wave", 30, subjects),
      resolve("hero.red.wave", 10, subjects),
      resolve("hero.+shake(strength=5)", 20, subjects),
    ]);

    expect(result.complete).toBe(true);
    expect(result.mutations.map((mutation) => ({
      sequence: mutation.sequence,
      scriptOffset: mutation.scriptOffset,
      operation: mutation.operation,
      memberPolicy: mutation.memberPolicy,
      target: mutation.target.name,
    }))).toEqual([
      { sequence: 0, scriptOffset: 10, operation: "replace", memberPolicy: "replace-chain", target: "hero" },
      { sequence: 1, scriptOffset: 20, operation: "upsert", memberPolicy: "merge-arguments", target: "hero" },
      { sequence: 2, scriptOffset: 30, operation: "remove", memberPolicy: "remove-by-name", target: "hero" },
    ]);
    expect(result.mutations[0]!.semanticMembers).toMatchObject([
      { type: "semantic-command-member", name: "red", operator: null },
      { type: "semantic-command-member", name: "wave", operator: null },
    ]);
    expect(result.mutations[1]!.semanticMembers).toMatchObject([{
      name: "shake",
      operator: "+",
      args: [{ name: "strength", value: { type: "number", value: 5 } }],
    }]);
    expect(result.mutations[2]!.semanticMembers).toMatchObject([{
      name: "wave",
      operator: "-",
      args: [],
    }]);
  });

  it("preserves an expanded macro as an atomic replacement member", () => {
    const { definitions, scopes, subjects } = harness();
    new MacroDefinitionLowerer(definitions).lower([
      deferred("fx = .red -1s-> wave", 5),
    ]);
    const expression = subjects.resolveExpression(parseChainSyntax("hero.$fx", 100).expression);
    const expanded = new MacroExpander(definitions, scopes, subjects).expand({
      expression,
      state: new StateStore(),
    });
    const result = new ObjectMutationLowerer().lower(expanded.expression.sentences);

    expect(expanded.complete).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.mutations[0]).toMatchObject({
      operation: "replace",
      memberPolicy: "replace-chain",
      semanticMembers: [{
        type: "semantic-clause-member",
        origin: { kind: "macro-expansion", macroName: "fx" },
        sentence: { beats: [{}, { connectorBefore: { durationSeconds: 1 } }] },
      }],
    });
  });
});

describe("parser-object-mutation: validation", () => {
  it("rejects mixed signed operations and removal arguments", () => {
    const { subjects } = harness();
    const mixed = new ObjectMutationLowerer().lower([
      resolve("hero.+wave.-shake", 10, subjects),
    ]);
    const removalArgs = new ObjectMutationLowerer().lower([
      resolve("hero.-shake(strength=5)", 20, subjects),
    ]);

    expect(mixed.mutations).toEqual([]);
    expect(codes(mixed.diagnostics)).toContain("object-mutation-invalid-operator");
    expect(removalArgs.mutations).toEqual([]);
    expect(codes(removalArgs.diagnostics)).toContain("object-mutation-remove-arguments");
  });

  it("requires an explicit object target for signed member operations", () => {
    const { subjects } = harness();
    const result = new ObjectMutationLowerer().lower([
      resolve(".+wave", 10, subjects),
    ]);

    expect(result.complete).toBe(false);
    expect(result.mutations).toEqual([]);
    expect(codes(result.diagnostics)).toContain("object-mutation-target-required");
  });
});
