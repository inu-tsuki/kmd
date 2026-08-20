import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import {
  createStaticScopeCommandRegistryView,
  runtimeScopeCommandRegistryView,
} from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import type { ScopeCommandMatch } from "@kmd/core/parser/scope/types";
import { SemanticLowerer } from "@kmd/core/parser/semantic/SemanticLowerer";

const TEST_REGISTRY: ScopeCommandMatch[] = [
  { name: "bold", family: "style" },
  { name: "red", family: "style" },
  { name: "wave", family: "effect", metadata: { argumentUnits: { positional: ["number"] } } },
  { name: "hold", family: "effect", metadata: { argumentUnits: { positional: ["s"] } } },
  { name: "ease", family: "effect", metadata: { argumentUnits: { positional: ["s"] } } },
  { name: "invalidMeta", family: "effect", metadata: { argumentUnits: { positional: ["minute"] } } },
  {
    name: "named",
    family: "effect",
    metadata: { argumentUnits: { positional: ["s"], named: { duration: "ms" } } },
  },
  {
    name: "pause",
    family: "stage",
    metadata: { blockingDefault: true, argumentUnits: { positional: ["s"] } },
  },
  {
    name: "cam.move",
    family: "stage",
    metadata: { argumentUnits: { positional: ["px", "px", "s"] } },
  },
  {
    name: "cam.zoom",
    family: "stage",
    metadata: { argumentUnits: { positional: ["number", "s"] } },
  },
];

const DESIGN_PROBE = join(
  import.meta.dirname,
  "__fixtures__",
  "semantic-resolution",
  "b0-3-design-probe.kmd",
);

function lower(source: string) {
  const syntax = parseChainSyntax(source);
  expect(syntax.diagnostics).toEqual([]);
  const scopes = new ScopeResolver(
    new DefinitionIndex(),
    createStaticScopeCommandRegistryView(TEST_REGISTRY),
  );
  const resolved = new SubjectResolver(scopes).resolveExpression(syntax.expression);
  return new SemanticLowerer().lowerExpression(resolved);
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("parser-semantic-lowering: commands and typed arguments", () => {
  it("inserts a command head into the first beat without re-running registry lookup", () => {
    const result = lower("bold.wave:char(3) ~500ms~> wave(0)");

    expect(result.complete).toBe(true);
    expect(result.sentences[0]).toMatchObject({
      commandHeadInserted: true,
      beats: [
        {
          connectorBefore: null,
          members: [
            { type: "semantic-command-member", origin: "command-head", name: "bold" },
            {
              type: "semantic-command-member",
              origin: "predicate",
              name: "wave",
              granularity: "char",
              args: [{ value: { type: "number", value: 3 } }],
            },
          ],
        },
        {
          connectorBefore: { kind: "ease", durationSeconds: 0.5 },
          members: [{ name: "wave" }],
        },
      ],
    });
  });

  it("applies registry default units and normalizes explicit milliseconds to seconds", () => {
    const result = lower("cam.move(10,20,250ms).zoom(2,500)");
    const members = result.sentences[0]!.beats[0]!.members;

    expect(members[0]).toMatchObject({
      name: "cam.move",
      args: [
        { expectedUnit: "px", value: { type: "space", value: 10, unit: "px", defaultUnitApplied: true } },
        { expectedUnit: "px", value: { type: "space", value: 20, unit: "px", defaultUnitApplied: true } },
        { expectedUnit: "s", value: { type: "time", seconds: 0.25, sourceUnit: "ms" } },
      ],
    });
    expect(members[1]).toMatchObject({
      name: "cam.zoom",
      args: [
        { expectedUnit: "number", value: { type: "number", value: 2 } },
        { expectedUnit: "s", value: { type: "time", seconds: 500, defaultUnitApplied: true } },
      ],
    });
  });

  it("gives named argument metadata precedence over its positional slot", () => {
    const result = lower(".named(duration=500)");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      args: [{
        name: "duration",
        expectedUnit: "ms",
        value: { type: "time", seconds: 0.5, defaultUnitApplied: true },
      }],
    });
  });

  it("carries units through relative and range endpoints", () => {
    const result = lower("cam.zoom(0~2s~>+=1)");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      args: [{
        expectedUnit: "number",
        value: {
          type: "range",
          from: { type: "number", value: 0 },
          durationSeconds: 2,
          to: {
            type: "relative",
            operator: "+=",
            value: 1,
            unit: "number",
            defaultUnitApplied: true,
          },
        },
      }],
    });
  });

  it("uses stage metadata for default blocking semantics", () => {
    const result = lower(".pause(1)");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      name: "pause",
      blocking: true,
      blockingOrigin: "metadata",
      args: [{ value: { type: "time", seconds: 1, defaultUnitApplied: true } }],
    });
  });

  it("exposes unit metadata through the real stage and layout registry view", () => {
    expect(runtimeScopeCommandRegistryView.find("cam.zoom")[0]?.metadata).toMatchObject({
      argumentUnits: { positional: ["number", "s"] },
    });
    expect(runtimeScopeCommandRegistryView.find("left")[0]?.metadata).toMatchObject({
      argumentUnits: { positional: ["px"] },
    });
    expect(runtimeScopeCommandRegistryView.find("pause")[0]?.metadata).toMatchObject({
      blockingDefault: true,
      argumentUnits: { positional: ["s"] },
    });
  });
});

describe("parser-semantic-lowering: clauses and honest deferral", () => {
  it("recursively lowers clauses and canonicalizes a terminal inner blocking marker", () => {
    const result = lower(".(cam.zoom(1s)!):char");
    expect(result.complete).toBe(true);
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      type: "semantic-clause-member",
      granularity: "char",
      blocking: true,
      canonicalization: "inner-terminal-blocking-to-clause",
      sentence: {
        subject: { kind: "builtin", name: "cam" },
        beats: [{ members: [{ name: "cam.zoom", blocking: true }] }],
      },
    });
  });

  it("keeps an inner blocking marker when a later inner beat consumes it", () => {
    const result = lower(".(cam.zoom(1s)! ~1s~> zoom(2))");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      type: "semantic-clause-member",
      blocking: false,
      canonicalization: null,
      sentence: {
        beats: [
          { members: [{ name: "cam.zoom", blocking: true }] },
          { members: [{ name: "cam.zoom", blocking: false }] },
        ],
      },
    });
  });

  it("marks B1/B0.4 values and references as deferred instead of final IR", () => {
    const result = lower(".wave(var.amount).$saved");
    expect(result.complete).toBe(false);
    expect(codes(result.diagnostics)).toEqual([
      "semantic-value-deferred",
      "semantic-reference-deferred",
    ]);
    expect(result.sentences[0]!.beats[0]!.members).toMatchObject([
      { args: [{ value: { type: "deferred-value", reason: "name-ref" } }] },
      { type: "semantic-deferred-member", reason: "reference" },
    ]);
  });
});

describe("parser-semantic-lowering: structured diagnostics", () => {
  it("rejects legacy timing words in the no-compatibility frontend", () => {
    const result = lower(".hold(1s).red");
    expect(result.complete).toBe(false);
    expect(codes(result.diagnostics)).toContain("semantic-legacy-timing-command");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      type: "semantic-deferred-member",
      reason: "legacy-timing-command",
    });
  });

  it("diagnoses malformed argument metadata without applying an invented unit", () => {
    const result = lower(".invalidMeta(3)");
    expect(result.complete).toBe(false);
    expect(codes(result.diagnostics)).toContain("semantic-invalid-command-metadata");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      args: [{ expectedUnit: null, value: { type: "number", value: 3 } }],
    });
  });

  it("diagnoses a negative connector duration", () => {
    const result = lower(".wave --1s-> red");
    expect(result.complete).toBe(false);
    expect(codes(result.diagnostics)).toContain("semantic-negative-connector-duration");
    expect(result.sentences[0]!.beats[1]!.connectorBefore).toMatchObject({
      kind: "hold",
      durationSeconds: null,
    });
  });

  it("keeps unresolved commands outside the executable member union", () => {
    const result = lower(".missing");
    expect(result.complete).toBe(false);
    expect(codes(result.diagnostics)).toContain("semantic-unresolved-command");
    expect(result.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      type: "semantic-deferred-member",
      reason: "unresolved-command",
    });
  });
});

describe("parser-semantic-lowering: B0.3 design probe", () => {
  it("keeps every connector, clause, and granularity probe semantically complete", () => {
    const chains = readFileSync(DESIGN_PROBE, "utf-8")
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => line.slice(line.indexOf("@ ") + 2));

    expect(chains).toHaveLength(6);
    for (const chain of chains) {
      const result = lower(chain);
      expect(result.complete, chain).toBe(true);
      expect(result.diagnostics, chain).toEqual([]);
    }
  });
});
