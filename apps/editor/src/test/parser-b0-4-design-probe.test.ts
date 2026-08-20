import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { FenceDefinitionLowerer } from "@kmd/core/parser/document/FenceDefinitionLowerer";
import { parseDocumentStructure } from "@kmd/core/parser/document/DocumentParser";
import { extractFrontMatterBlock, linesToMetadata } from "@kmd/core/parser/frontmatter";
import { MacroDefinitionLowerer } from "@kmd/core/parser/macro/MacroDefinitionLowerer";
import { MacroExpander } from "@kmd/core/parser/macro/MacroExpander";
import { ObjectMutationLowerer } from "@kmd/core/parser/object/ObjectMutationLowerer";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import { SemanticLowerer } from "@kmd/core/parser/semantic/SemanticLowerer";
import { StateLowerer } from "@kmd/core/parser/state/StateLowerer";
import { StateStore } from "@kmd/core/state/StateStore";

const PROBE = join(import.meta.dirname, "__fixtures__", "b0-4", "b0-4-design-probe.kmd");

describe("parser B0.4 design probe", () => {
  it("lowers fences, expands macro choices, and emits object mutation seeds in isolation", () => {
    const source = readFileSync(PROBE, "utf-8").replace(/\r\n/gu, "\n");
    const document = parseDocumentStructure(source);
    expect(document.diagnostics).toEqual([]);
    expect(document.scenes).toHaveLength(2);

    const definitions = new DefinitionIndex();
    const fences = new FenceDefinitionLowerer(definitions).lower(document);
    expect(fences.complete).toBe(true);
    expect(fences.definitions).toMatchObject([{
      name: "hero",
      kind: "object",
      payload: { coveredLineRanges: [{}, {}] },
    }]);

    const registry = createStaticScopeCommandRegistryView([
      { name: "red", family: "style" },
      { name: "gray", family: "style" },
      { name: "wave", family: "effect" },
      { name: "shake", family: "effect" },
    ]);
    const scopes = new ScopeResolver(definitions, registry);
    const subjects = new SubjectResolver(scopes);
    const commandLines = collectCommandLines(source, document.scenes[0]!.range.end);
    expect(commandLines).toHaveLength(4);
    expect(commandLines.flatMap((entry) => entry.syntax.diagnostics)).toEqual([]);

    const frontmatter = extractFrontMatterBlock(source);
    expect(frontmatter).not.toBeNull();
    if (frontmatter === null) throw new Error("expected frontmatter");
    const metadata: Record<string, unknown> = {};
    linesToMetadata(frontmatter.lines, metadata);
    const variables = metadata.variables as Record<string, unknown>;
    const state = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: source.length },
      frontmatterVariables: Object.entries(variables).map(([name, value]) => ({
        name,
        value,
        range: { start: source.indexOf(name), end: source.indexOf(name) + name.length },
      })),
      sentences: commandLines.map((entry) => ({
        sentence: entry.syntax.expression.sentences[0]!,
        sceneVisibleUntil: { offset: document.scenes[0]!.range.end },
      })),
    });
    expect(state.complete).toBe(true);
    expect(state.deferredDefinitions).toHaveLength(1);

    const macros = new MacroDefinitionLowerer(definitions).lower(state.deferredDefinitions);
    expect(macros.complete).toBe(true);
    expect(macros.definitions).toMatchObject([{
      name: "heading",
      payload: { localTimelineTemplateId: expect.stringContaining("heading") },
    }]);

    const store = new StateStore(state.storeInitials);
    const expander = new MacroExpander(definitions, scopes, subjects);
    const expanded = commandLines.slice(1).map((entry) => expander.expand({
      expression: subjects.resolveExpression(entry.syntax.expression),
      state: store,
    }));
    expect(expanded.every((entry) => entry.complete)).toBe(true);
    expect(expanded[0]!.origins).toMatchObject([
      { macroName: "heading", kind: "macro-expansion" },
      { macroName: null, kind: "macro-expansion" },
    ]);
    const semantic = new SemanticLowerer().lowerExpression(expanded[0]!.expression);
    expect(semantic.complete).toBe(true);
    expect(JSON.stringify(semantic)).not.toContain("semantic-deferred-member");

    const mutations = new ObjectMutationLowerer().lower(
      expanded.flatMap((entry) => entry.expression.sentences),
    );
    expect(mutations.complete).toBe(true);
    expect(mutations.mutations.map((entry) => ({
      operation: entry.operation,
      policy: entry.memberPolicy,
    }))).toEqual([
      { operation: "replace", policy: "replace-chain" },
      { operation: "upsert", policy: "merge-arguments" },
      { operation: "remove", policy: "remove-by-name" },
    ]);
  });
});

function collectCommandLines(source: string, sceneEnd: number) {
  const entries = [];
  let searchFrom = 0;
  for (const line of source.split("\n")) {
    const lineStart = source.indexOf(line, searchFrom);
    searchFrom = lineStart + line.length + 1;
    if (!line.startsWith("@ ") || lineStart >= sceneEnd) continue;
    const chain = line.slice(2);
    const offset = lineStart + 2;
    entries.push({ chain, offset, syntax: parseChainSyntax(chain, offset) });
  }
  return entries;
}
