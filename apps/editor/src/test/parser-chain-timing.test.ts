import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import type { ScopeCommandMatch } from "@kmd/core/parser/scope/types";
import { ChainTimingLowerer } from "@kmd/core/parser/semantic/ChainTimingLowerer";
import { SemanticLowerer } from "@kmd/core/parser/semantic/SemanticLowerer";
import type { UnitRevealPlan } from "@kmd/core/parser/semantic/types";

const TEST_REGISTRY: ScopeCommandMatch[] = [
  { name: "red", family: "style" },
  { name: "wave", family: "effect", metadata: { argumentUnits: { positional: ["number"] } } },
  {
    name: "cam.zoom",
    family: "stage",
    metadata: { argumentUnits: { positional: ["number", "s"] } },
  },
];

const REVEAL_PLAN: UnitRevealPlan = {
  char: [
    { id: "char:a", revealAtSeconds: 0.1 },
    { id: "char:b", revealAtSeconds: 0.4 },
  ],
  group: [{ id: "group:1", revealAtSeconds: 0.2 }],
  block: [{ id: "block:1", revealAtSeconds: 0 }],
};

function time(source: string, revealPlan: UnitRevealPlan = REVEAL_PLAN) {
  const syntax = parseChainSyntax(source);
  expect(syntax.diagnostics).toEqual([]);
  const scopes = new ScopeResolver(
    new DefinitionIndex(),
    createStaticScopeCommandRegistryView(TEST_REGISTRY),
  );
  const resolved = new SubjectResolver(scopes).resolveExpression(syntax.expression);
  const semantic = new SemanticLowerer().lowerExpression(resolved);
  return {
    semantic,
    timed: new ChainTimingLowerer().lower(semantic.sentences[0]!, revealPlan),
  };
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("parser-chain-timing: beats and reveal offsets", () => {
  it("starts members in one beat together for each matching reveal unit", () => {
    const { timed } = time(".wave:char(3).red:char ~1s~> wave:char(0)");

    expect(timed.diagnostics).toEqual([]);
    expect(timed.beats.map((beat) => beat.nominalOffsetSeconds)).toEqual([0, 1]);
    expect(timed.beats[0]!.instances.map((instance) => ({
      member: instance.member.type === "semantic-command-member" ? instance.member.name : "clause",
      unit: instance.unitId,
      start: instance.nominalStartSeconds,
    }))).toEqual([
      { member: "wave", unit: "char:a", start: 0.1 },
      { member: "wave", unit: "char:b", start: 0.4 },
      { member: "red", unit: "char:a", start: 0.1 },
      { member: "red", unit: "char:b", start: 0.4 },
    ]);
    expect(timed.beats[1]!.instances.map((instance) => instance.nominalStartSeconds))
      .toEqual([1.1, 1.4]);
  });

  it("does not advance the beat baseline for a parameter range tween", () => {
    const { timed } = time(".wave(0~4s~>1) ~1s~> red");
    expect(timed.beats.map((beat) => beat.nominalOffsetSeconds)).toEqual([0, 1]);
    expect(timed.beats[1]!.instances[0]!.nominalStartSeconds).toBe(1);
  });

  it("instantiates a granular clause once per layout unit", () => {
    const { timed } = time(".(cam.zoom(+=0.01)):char");
    expect(timed.beats[0]!.instances).toMatchObject([
      { unitKind: "char", unitId: "char:a", nominalStartSeconds: 0.1 },
      { unitKind: "char", unitId: "char:b", nominalStartSeconds: 0.4 },
    ]);
    for (const instance of timed.beats[0]!.instances) {
      expect(instance.member.type).toBe("semantic-clause-member");
    }
  });
});

describe("parser-chain-timing: blocking dependencies", () => {
  it("pairs blocking instances by unit when both beats use the same granularity", () => {
    const { timed } = time(".wave:char! ~1s~> red:char");
    expect(timed.beats[1]!.instances).toMatchObject([
      {
        unitId: "char:a",
        dependencyMode: "unit",
        dependsOnInstanceIds: ["b0:m0:u0"],
      },
      {
        unitId: "char:b",
        dependencyMode: "unit",
        dependsOnInstanceIds: ["b0:m0:u1"],
      },
    ]);
  });

  it("depends on every same-unit blocking member from the previous beat", () => {
    const { timed } = time(".wave:char!.red:char! ~1s~> wave:char");
    expect(timed.beats[1]!.instances).toMatchObject([
      {
        unitId: "char:a",
        dependencyMode: "unit",
        dependsOnInstanceIds: ["b0:m0:u0", "b0:m1:u0"],
      },
      {
        unitId: "char:b",
        dependencyMode: "unit",
        dependsOnInstanceIds: ["b0:m0:u1", "b0:m1:u1"],
      },
    ]);
  });

  it("uses the previous beat as a barrier when granularities differ", () => {
    const { timed } = time(".wave:char! -500ms-> red:group");
    expect(timed.beats[1]!.instances[0]).toMatchObject({
      unitKind: "group",
      dependencyMode: "beat",
      dependsOnInstanceIds: ["b0:m0:u0", "b0:m0:u1"],
      nominalStartSeconds: 0.7,
    });
  });
});

describe("parser-chain-timing: layout contract diagnostics", () => {
  it("does not create granular instances when the required reveal plan is absent", () => {
    const { timed } = time(".wave:char", { char: [], group: [], block: [] });
    expect(timed.beats[0]!.instances).toEqual([]);
    expect(codes(timed.diagnostics)).toContain("timing-missing-reveal-plan");
  });

  it("rejects duplicate and negative reveal units deterministically", () => {
    const { timed } = time(".wave:char", {
      char: [
        { id: "a", revealAtSeconds: 0 },
        { id: "a", revealAtSeconds: 0.2 },
        { id: "b", revealAtSeconds: -1 },
      ],
      group: [],
      block: [],
    });
    expect(timed.beats[0]!.instances).toHaveLength(1);
    expect(codes(timed.diagnostics)).toEqual([
      "timing-duplicate-reveal-unit",
      "timing-invalid-reveal-unit",
    ]);
  });

  it("reports deferred members and excludes them from timing instances", () => {
    const { timed } = time(".wave.$saved");
    expect(timed.beats[0]!.instances).toHaveLength(1);
    expect(codes(timed.diagnostics)).toContain("timing-deferred-member");
  });
});
