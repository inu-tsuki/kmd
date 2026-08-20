import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { MacroDefinitionLowerer } from "@kmd/core/parser/macro/MacroDefinitionLowerer";
import { MacroExpander } from "@kmd/core/parser/macro/MacroExpander";
import { parseMacroChoice } from "@kmd/core/parser/macro/MacroChoiceParser";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import { SemanticLowerer } from "@kmd/core/parser/semantic/SemanticLowerer";
import { StateLowerer } from "@kmd/core/parser/state/StateLowerer";
import type { DeferredStateDefinition } from "@kmd/core/parser/state/types";
import { StateStore } from "@kmd/core/state/StateStore";

const REGISTRY = createStaticScopeCommandRegistryView([
  { name: "red", family: "style" },
  { name: "gray", family: "style" },
  { name: "wave", family: "effect" },
  { name: "shake", family: "effect" },
  { name: "cam.zoom", family: "stage" },
]);

function harness() {
  const definitions = new DefinitionIndex();
  const scopes = new ScopeResolver(definitions, REGISTRY);
  const subjects = new SubjectResolver(scopes);
  return {
    definitions,
    scopes,
    subjects,
    expander: new MacroExpander(definitions, scopes, subjects),
  };
}

function sentence(source: string, offset = 0) {
  const parsed = parseChainSyntax(source, offset);
  expect(parsed.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  return parsed.expression.sentences[0]!;
}

function deferred(source: string, offset = 0, sceneEnd = 500): DeferredStateDefinition {
  return {
    sentence: sentence(source, offset),
    sceneVisibleUntil: { offset: sceneEnd },
    reason: "macro-or-object",
  };
}

function addObject(definitions: DefinitionIndex, name: string, start = 0, end = 500): void {
  definitions.add({
    name,
    kind: "object",
    level: "scene",
    visibleFrom: { offset: start },
    visibleUntil: { offset: end },
    payload: null,
    declarationRange: { start, end: start + name.length },
    source: "fence",
  });
}

function resolve(source: string, offset: number, subjects: SubjectResolver) {
  const parsed = parseChainSyntax(source, offset);
  expect(parsed.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  return subjects.resolveExpression(parsed.expression);
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((entry) => entry.code);
}

describe("parser-macro-expansion: definition lowering", () => {
  it("consumes only the definition sentences deferred by StateLowerer", () => {
    const { definitions, scopes } = harness();
    const state = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: 500 },
      sentences: [{
        sentence: sentence("heading = .red -1s-> wave", 10),
        sceneVisibleUntil: { offset: 300 },
      }],
    });

    expect(state.assignments).toEqual([]);
    expect(state.deferredDefinitions).toMatchObject([{
      sentence: { payload: { name: { name: "heading" } } },
      sceneVisibleUntil: { offset: 300 },
    }]);

    const lowered = new MacroDefinitionLowerer(definitions).lower(state.deferredDefinitions);
    expect(lowered.complete).toBe(true);
    expect(lowered.definitions[0]).toMatchObject({
      name: "heading",
      kind: "macro",
      level: "scene",
      visibleFrom: { offset: 10 },
      visibleUntil: { offset: 300 },
      payload: {
        type: "macro-definition",
        name: "heading",
        sentence: { kind: "predicate", beats: [{}, { connectorBefore: { kind: "hold" } }] },
        localTimelineTemplateId: "macro-timeline:heading:10",
        complete: true,
      },
    });
  });

  it("retains invalid definitions for diagnostics and rejects multi-sentence bodies", () => {
    const { definitions } = harness();
    const lowered = new MacroDefinitionLowerer(definitions).lower([
      deferred("many = red wave", 0),
      deferred("assignment = var.x = 1", 30),
    ]);

    expect(lowered.complete).toBe(false);
    expect(codes(lowered.diagnostics)).toEqual([
      "macro-multiple-definition-sentences",
      "macro-invalid-definition-body",
    ]);
    expect(lowered.definitions.map((entry) => entry.payload.complete)).toEqual([false, false]);
  });
});

describe("parser-macro-expansion: structured expansion", () => {
  it("inherits the caller object and carries atomic local-timeline origin into semantic IR", () => {
    const { definitions, subjects, expander } = harness();
    addObject(definitions, "hero");
    new MacroDefinitionLowerer(definitions).lower([
      deferred("heading = .red -1s-> wave", 10),
    ]);

    const expanded = expander.expand({
      expression: resolve("hero.$heading", 100, subjects),
      state: new StateStore(),
    });
    expect(expanded.complete).toBe(true);
    expect(expanded.origins).toMatchObject([{
      kind: "macro-expansion",
      macroName: "heading",
      definitionRange: { start: 10 },
      referenceRange: { start: 105, end: 113 },
    }]);
    expect(expanded.expression.sentences[0]).toMatchObject({
      subject: { selector: { definition: { name: "hero" } } },
      beats: [{ members: [{
        type: "resolved-clause-member",
        origin: { macroName: "heading" },
        sentence: {
          subject: { selector: { definition: { name: "hero" } } },
          beats: [
            { connectorBefore: null, members: [{ command: { name: "red" } }] },
            { connectorBefore: { kind: "hold" }, members: [{ command: { name: "wave" } }] },
          ],
        },
      }] }],
    });

    const semantic = new SemanticLowerer().lowerExpression(expanded.expression);
    expect(semantic.complete).toBe(true);
    expect(semantic.sentences[0]!.beats[0]!.members[0]).toMatchObject({
      type: "semantic-clause-member",
      origin: { macroName: "heading", kind: "macro-expansion" },
      sentence: { beats: [{}, { connectorBefore: { durationSeconds: 1 } }] },
    });
  });

  it("treats a command-head fragment as the first inherited-subject command", () => {
    const { definitions, scopes, subjects, expander } = harness();
    addObject(definitions, "hero");
    const state = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: 500 },
      frontmatterVariables: [{ name: "route", value: "a", range: { start: 0, end: 5 } }],
      sentences: [],
    });

    const expanded = expander.expand({
      expression: resolve("hero.$(var.route == 'a' ? red.shake : gray)", 100, subjects),
      state: new StateStore(state.storeInitials),
    });
    expect(expanded.complete).toBe(true);
    expect(expanded.origins).toMatchObject([{ macroName: null }]);
    const clause = expanded.expression.sentences[0]!.beats[0]!.members[0];
    expect(clause).toMatchObject({
      type: "resolved-clause-member",
      sentence: {
        subject: { selector: { definition: { name: "hero" } } },
        commandHead: { name: "red", family: "style" },
        beats: [{ members: [{ command: { name: "shake", family: "effect" } }] }],
      },
    });
  });

  it("keeps an explicit builtin subject inside a macro body", () => {
    const { definitions, subjects, expander } = harness();
    addObject(definitions, "hero");
    new MacroDefinitionLowerer(definitions).lower([deferred("camera = cam.zoom", 10)]);

    const expanded = expander.expand({
      expression: resolve("hero.$camera", 100, subjects),
      state: new StateStore(),
    });
    const clause = expanded.expression.sentences[0]!.beats[0]!.members[0];
    expect(expanded.complete).toBe(true);
    expect(clause).toMatchObject({
      sentence: {
        subject: { kind: "builtin", name: "cam" },
        beats: [{ members: [{ command: { name: "cam.zoom", family: "stage" } }] }],
      },
    });
  });

  it("removes the reference member when a missing else selects the empty chain", () => {
    const { definitions, scopes, subjects, expander } = harness();
    addObject(definitions, "hero");
    const state = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: 500 },
      frontmatterVariables: [{ name: "enabled", value: false, range: { start: 0, end: 7 } }],
      sentences: [],
    });
    const expanded = expander.expand({
      expression: resolve("hero.$(var.enabled ? wave).shake", 100, subjects),
      state: new StateStore(state.storeInitials),
    });

    expect(expanded.complete).toBe(true);
    expect(expanded.origins).toEqual([]);
    expect(expanded.expression.sentences[0]!.beats[0]!.members).toMatchObject([
      { type: "resolved-command-member", command: { name: "shake" } },
    ]);
  });
});

describe("parser-macro-expansion: diagnostics", () => {
  it("detects recursive expansion and preserves the unresolved reference on failure", () => {
    const { definitions, subjects, expander } = harness();
    new MacroDefinitionLowerer(definitions).lower([
      deferred("a = $b", 0),
      deferred("b = $a", 20),
    ]);
    const expanded = expander.expand({
      expression: resolve("$a", 100, subjects),
      state: new StateStore(),
    });

    expect(expanded.complete).toBe(false);
    expect(codes(expanded.diagnostics)).toContain("macro-expansion-cycle");
    expect(JSON.stringify(expanded.expression)).toContain("resolved-reference-member");
  });

  it("enforces the configured depth and the $name macro-only boundary", () => {
    const definitions = new DefinitionIndex();
    const scopes = new ScopeResolver(definitions, REGISTRY);
    const subjects = new SubjectResolver(scopes);
    new MacroDefinitionLowerer(definitions).lower([
      deferred("a = $b", 0),
      deferred("b = wave", 20),
    ]);
    addObject(definitions, "hero", 0, 500);
    const expander = new MacroExpander(definitions, scopes, subjects, 1);

    const depth = expander.expand({
      expression: resolve("$a", 100, subjects),
      state: new StateStore(),
    });
    const kind = expander.expand({
      expression: resolve("$hero", 120, subjects),
      state: new StateStore(),
    });
    expect(codes(depth.diagnostics)).toContain("macro-expansion-depth-exceeded");
    expect(codes(kind.diagnostics)).toContain("macro-reference-kind-mismatch");
  });

  it("parses nested choice branches without treating granularity or quoted punctuation as separators", () => {
    const parsed = parseMacroChoice(
      "var.ok ? wave:char : var.alt ? shake(label='?:') : gray",
      50,
    );
    expect(parsed.complete).toBe(true);
    expect(parsed.choice).toMatchObject({
      type: "macro-choice-conditional",
      condition: { type: "name-expression", path: ["var", "ok"] },
      whenTrue: { type: "macro-choice-leaf", raw: "wave:char" },
      whenFalse: {
        type: "macro-choice-conditional",
        condition: { path: ["var", "alt"] },
        whenTrue: { raw: "shake(label='?:')" },
        whenFalse: { raw: "gray" },
      },
    });
  });
});
