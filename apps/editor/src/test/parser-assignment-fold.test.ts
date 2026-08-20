import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { AssignmentFolder } from "@kmd/core/parser/state/AssignmentFolder";
import { StateLowerer } from "@kmd/core/parser/state/StateLowerer";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { StateStore } from "@kmd/core/state/StateStore";

function lowerAssignments(
  sources: readonly { text: string; offset: number; sceneEnd?: number }[],
  initial?: number,
) {
  const definitions = new DefinitionIndex();
  const scopes = new ScopeResolver(
    definitions,
    createStaticScopeCommandRegistryView([]),
  );
  const result = new StateLowerer(definitions, scopes).lower({
    documentVisibleUntil: { offset: 1_000 },
    ...(initial === undefined
      ? {}
      : {
          frontmatterVariables: [{
            name: "count",
            value: initial,
            range: { start: 0, end: 5 },
          }],
        }),
    sentences: sources.map(({ text, offset, sceneEnd }) => {
      const parsed = parseChainSyntax(text, offset);
      expect(parsed.diagnostics).toEqual([]);
      return {
        sentence: parsed.expression.sentences[0]!,
        sceneVisibleUntil: { offset: sceneEnd ?? 500 },
      };
    }),
  });
  expect(result.complete).toBe(true);
  return result;
}

describe("parser-assignment-fold", () => {
  it("folds by script offset and sequence, independent of input order", () => {
    const lowered = lowerAssignments([
      { text: "var.count = var.count * 10", offset: 80 },
      { text: "var.count = var.count + 1", offset: 20 },
      { text: "var.count = var.count + 2", offset: 20 },
    ], 1);
    const state = new StateStore(lowered.storeInitials);
    const folded = new AssignmentFolder().foldThroughOffset(
      lowered.assignments,
      100,
      state,
    );

    expect(folded.complete).toBe(true);
    expect(folded.appliedAssignmentIds).toEqual([
      "assignment:0:20",
      "assignment:1:20",
      "assignment:2:80",
    ]);
    expect(state.entries("document")).toMatchObject([{
      qualifiedName: "var.count",
      value: 40,
    }]);
    expect(folded.checkpoint).toEqual({
      schemaVersion: 1,
      document: { "var.count": 40 },
    });
  });

  it("reproduces seek-style results after restoring an entry snapshot", () => {
    const lowered = lowerAssignments([
      { text: "var.count = var.count + 1", offset: 20 },
      { text: "var.count = var.count * 4", offset: 80 },
    ], 2);
    const state = new StateStore(lowered.storeInitials);
    const entry = state.snapshot();
    const folder = new AssignmentFolder();

    expect(folder.foldThroughOffset(lowered.assignments, 100, state).checkpoint.document)
      .toEqual({ "var.count": 12 });
    expect(state.restore(entry).ok).toBe(true);
    expect(folder.foldThroughOffset(lowered.assignments, 50, state).checkpoint.document)
      .toEqual({ "var.count": 3 });
    expect(state.restore(entry).ok).toBe(true);
    expect(folder.foldThroughOffset(lowered.assignments, 100, state).checkpoint.document)
      .toEqual({ "var.count": 12 });
  });

  it("keeps scene values outside checkpoint snapshots", () => {
    const lowered = lowerAssignments([
      { text: "temp = 5", offset: 100, sceneEnd: 200 },
    ]);
    const state = new StateStore();
    const folded = new AssignmentFolder().foldThroughOffset(
      lowered.assignments,
      150,
      state,
    );

    expect(state.entries("scene")).toMatchObject([{
      qualifiedName: "scene:100:temp",
      value: 5,
    }]);
    expect(folded.checkpoint.document).toEqual({});
  });

  it("reports a first-write self-reference as uninitialized", () => {
    const lowered = lowerAssignments([
      { text: "var.missing = var.missing + 1", offset: 20 },
    ]);
    const folded = new AssignmentFolder().foldThroughOffset(
      lowered.assignments,
      100,
      new StateStore(),
    );

    expect(folded.complete).toBe(false);
    expect(folded.appliedAssignmentIds).toEqual([]);
    expect(folded.diagnostics[0]?.code).toBe("expression-uninitialized-state");
  });
});
