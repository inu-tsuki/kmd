import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { ArgumentResolver } from "@kmd/core/parser/expression/ArgumentResolver";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import type { ScopeCommandMatch, ScopeDefinition } from "@kmd/core/parser/scope/types";
import { SemanticLowerer } from "@kmd/core/parser/semantic/SemanticLowerer";
import type { SemanticBoundValue } from "@kmd/core/parser/semantic/types";
import { stateKeyFromDefinition } from "@kmd/core/parser/expression/ExpressionBinder";
import { StateStore } from "@kmd/core/state/StateStore";

const REGISTRY: ScopeCommandMatch[] = [
  { name: "wave", family: "effect", metadata: { argumentUnits: { positional: ["number"] } } },
  { name: "pause", family: "stage", metadata: { argumentUnits: { positional: ["s"] } } },
  { name: "waitMs", family: "stage", metadata: { argumentUnits: { positional: ["ms"] } } },
  { name: "move", family: "layout", metadata: { argumentUnits: { positional: ["px"] } } },
  { name: "rotate", family: "effect", metadata: { argumentUnits: { positional: ["deg"] } } },
  { name: "cam.zoom", family: "stage", metadata: { argumentUnits: { positional: ["number"] } } },
];

function argumentHarness(variableNames: readonly string[]) {
  const definitions = new DefinitionIndex();
  const variables = new Map<string, ScopeDefinition>();
  for (const name of variableNames) {
    variables.set(name, definitions.add({
      name,
      kind: "var",
      level: "document",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: 10_000 },
      payload: null,
      declarationRange: { start: 0, end: name.length },
      source: "frontmatter",
    }));
  }
  const scopes = new ScopeResolver(
    definitions,
    createStaticScopeCommandRegistryView(REGISTRY),
  );
  const resolver = new ArgumentResolver(scopes);
  return {
    variables,
    resolver,
    lower(source: string) {
      const syntax = parseChainSyntax(source, 100);
      expect(syntax.diagnostics).toEqual([]);
      const resolved = new SubjectResolver(scopes).resolveExpression(syntax.expression);
      return resolver.resolve(new SemanticLowerer().lowerExpression(resolved));
    },
    state(values: Readonly<Record<string, number | string | boolean>>) {
      return new StateStore(Object.entries(values).map(([name, value]) => ({
        key: stateKeyFromDefinition(variables.get(name)!),
        value,
      })));
    },
  };
}

function firstArgument(result: ReturnType<ReturnType<typeof argumentHarness>["lower"]>): SemanticBoundValue {
  const member = result.semantic.sentences[0]!.beats[0]!.members[0]!;
  expect(member.type).toBe("semantic-command-member");
  if (member.type !== "semantic-command-member") throw new Error("expected command member");
  return member.args[0]!.value;
}

describe("parser-argument-resolution", () => {
  it("binds a conditional state expression and reads its value at trigger time", () => {
    const harness = argumentHarness(["trust"]);
    const result = harness.lower(".wave(var.trust > 3 ? 20 : 5)");
    const value = firstArgument(result);

    expect(result.complete).toBe(true);
    expect(result.semantic.diagnostics).toEqual([]);
    expect(value).toMatchObject({
      type: "state-expression",
      expectedUnit: "number",
      evaluationTiming: "trigger-record",
    });
    expect(harness.resolver.evaluate(value, harness.state({ trust: 4 })))
      .toMatchObject({ complete: true, value: { type: "number", value: 20 } });
    expect(harness.resolver.evaluate(value, harness.state({ trust: 2 })))
      .toMatchObject({ complete: true, value: { type: "number", value: 5 } });
  });

  it("applies s, ms, px, and deg command metadata after expression evaluation", () => {
    const harness = argumentHarness(["seconds", "millis", "distance", "angle"]);
    const result = harness.lower(
      ".pause(var.seconds).waitMs(var.millis).move(var.distance).rotate(var.angle)",
    );
    const members = result.semantic.sentences[0]!.beats[0]!.members;
    const state = harness.state({ seconds: 2, millis: 250, distance: 12, angle: 45 });
    const values = members.map((member) => {
      expect(member.type).toBe("semantic-command-member");
      if (member.type !== "semantic-command-member") throw new Error("expected command member");
      return harness.resolver.evaluate(member.args[0]!.value, state).value;
    });

    expect(values).toEqual([
      { type: "time", seconds: 2, sourceUnit: "s", defaultUnitApplied: true },
      { type: "time", seconds: 0.25, sourceUnit: "ms", defaultUnitApplied: true },
      { type: "space", value: 12, unit: "px", defaultUnitApplied: true },
      { type: "angle", value: 45, unit: "deg", defaultUnitApplied: true },
    ]);
  });

  it("resolves and materializes state-backed range endpoints", () => {
    const harness = argumentHarness(["from", "to"]);
    const result = harness.lower(".rotate(var.from~1s~>var.to)");
    const value = firstArgument(result);

    expect(value).toMatchObject({
      type: "range",
      from: { type: "state-expression", expectedUnit: "deg" },
      durationSeconds: 1,
      to: { type: "state-expression", expectedUnit: "deg" },
    });
    expect(harness.resolver.evaluate(value, harness.state({ from: 10, to: 30 })))
      .toMatchObject({
        complete: true,
        value: {
          type: "range",
          from: { type: "angle", value: 10, unit: "deg" },
          to: { type: "angle", value: 30, unit: "deg" },
        },
      });
  });

  it("clears resolved deferred diagnostics recursively inside clauses", () => {
    const harness = argumentHarness(["trust"]);
    const result = harness.lower(".(cam.zoom(var.trust))");

    expect(result.complete).toBe(true);
    expect(result.semantic.diagnostics).toEqual([]);
    expect(result.semantic.sentences[0]).toMatchObject({
      beats: [{
        members: [{
          type: "semantic-clause-member",
          sentence: {
            diagnostics: [],
            beats: [{ members: [{ args: [{ value: { type: "state-expression" } }] }] }],
          },
        }],
      }],
    });
  });

  it("rejects non-numeric expression results for numeric command metadata", () => {
    const harness = argumentHarness(["label"]);
    const result = harness.lower(".wave(var.label)");
    const evaluated = harness.resolver.evaluate(
      firstArgument(result),
      harness.state({ label: "high" }),
    );

    expect(evaluated.complete).toBe(false);
    expect(evaluated.value).toBeNull();
    expect(evaluated.diagnostics[0]?.code).toBe("expression-type-mismatch");
  });
});
