import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { StateLowerer } from "@kmd/core/parser/state/StateLowerer";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import type { SentenceAst } from "@kmd/core/parser/chainSyntax/types";

function parseSentence(source: string, baseOffset: number): SentenceAst {
  const parsed = parseChainSyntax(source, baseOffset);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.expression.sentences).toHaveLength(1);
  return parsed.expression.sentences[0]!;
}

function stateHarness() {
  const definitions = new DefinitionIndex();
  const scopes = new ScopeResolver(
    definitions,
    createStaticScopeCommandRegistryView([{ name: "wave", family: "effect" }]),
  );
  return { definitions, scopes, lowerer: new StateLowerer(definitions, scopes) };
}

describe("parser-state-lowering", () => {
  it("collects frontmatter variables and reuses their document definitions", () => {
    const { lowerer } = stateHarness();
    const result = lowerer.lower({
      documentVisibleUntil: { offset: 500 },
      frontmatterVariables: [
        { name: "trust", value: 3, range: { start: 8, end: 13 } },
        { name: "route", value: "left", range: { start: 14, end: 19 } },
      ],
      sentences: [{
        sentence: parseSentence("var.trust = var.trust + 1", 100),
        sceneVisibleUntil: { offset: 200 },
      }],
    });

    expect(result.complete).toBe(true);
    expect(result.definitions).toMatchObject([
      { name: "route", kind: "var", level: "document", qualifiedName: "var.route" },
      { name: "trust", kind: "var", level: "document", qualifiedName: "var.trust" },
    ]);
    expect(result.storeInitials).toMatchObject([
      { key: { qualifiedName: "var.trust" }, value: 3 },
      { key: { qualifiedName: "var.route" }, value: "left" },
    ]);
    expect(result.assignments).toMatchObject([{
      target: { qualifiedName: "var.trust" },
      evaluationTiming: "assignment-arrival",
      expression: { type: "bound-binary-expression", operator: "+" },
    }]);
  });

  it("treats the first var write as a declaration and later writes as assignments", () => {
    const { lowerer } = stateHarness();
    const result = lowerer.lower({
      documentVisibleUntil: { offset: 500 },
      sentences: [
        { sentence: parseSentence("var.score = 1", 10), sceneVisibleUntil: { offset: 200 } },
        { sentence: parseSentence("var.score = var.score + 2", 40), sceneVisibleUntil: { offset: 200 } },
      ],
    });

    expect(result.complete).toBe(true);
    expect(result.definitions.filter((entry) => entry.qualifiedName === "var.score"))
      .toHaveLength(1);
    expect(result.assignments.map((entry) => entry.scriptOffset)).toEqual([10, 40]);
    expect(result.scopeDiagnostics).toEqual([]);
  });

  it("creates a scene state interval and binds repeated bare-name writes to one key", () => {
    const { lowerer } = stateHarness();
    const result = lowerer.lower({
      documentVisibleUntil: { offset: 500 },
      sentences: [
        { sentence: parseSentence("temp = 1", 100), sceneVisibleUntil: { offset: 220 } },
        { sentence: parseSentence("temp = temp + 1", 140), sceneVisibleUntil: { offset: 220 } },
      ],
    });

    expect(result.complete).toBe(true);
    expect(result.definitions).toMatchObject([{
      name: "temp",
      kind: "state",
      level: "scene",
      visibleFrom: { offset: 100 },
      visibleUntil: { offset: 220 },
    }]);
    expect(result.assignments.map((entry) => entry.target.qualifiedName)).toEqual([
      "scene:100:temp",
      "scene:100:temp",
    ]);
  });

  it("leaves macro/object candidates for B0.4", () => {
    const { lowerer } = stateHarness();
    const result = lowerer.lower({
      documentVisibleUntil: { offset: 500 },
      sentences: [{
        sentence: parseSentence("intro = wave", 50),
        sceneVisibleUntil: { offset: 200 },
      }],
    });

    expect(result.complete).toBe(true);
    expect(result.assignments).toEqual([]);
    expect(result.deferredDefinitions).toMatchObject([{
      reason: "macro-or-object",
      sentence: { kind: "definition" },
    }]);
  });

  it("diagnoses non-state conflicts and empty scene intervals", () => {
    const conflict = stateHarness();
    conflict.definitions.add({
      name: "intro",
      kind: "macro",
      level: "scene",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: 200 },
      payload: null,
      declarationRange: { start: 0, end: 5 },
      source: "definition",
    });
    const conflicted = conflict.lowerer.lower({
      documentVisibleUntil: { offset: 500 },
      sentences: [{
        sentence: parseSentence("intro = 1", 50),
        sceneVisibleUntil: { offset: 200 },
      }],
    });
    expect(conflicted.diagnostics[0]?.code).toBe("state-lowering-target-conflict");

    const empty = stateHarness().lowerer.lower({
      documentVisibleUntil: { offset: 500 },
      sentences: [{
        sentence: parseSentence("temp = 1", 100),
        sceneVisibleUntil: { offset: 100 },
      }],
    });
    expect(empty.diagnostics[0]?.code).toBe("state-lowering-invalid-scene-interval");
  });
});
