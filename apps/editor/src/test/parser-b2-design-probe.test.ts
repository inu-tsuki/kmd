import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentLowerer } from "@kmd/core/parser/content/ContentLowerer";
import { ControlFlowLowerer } from "@kmd/core/parser/control/ControlFlowLowerer";
import { parseDocumentStructure } from "@kmd/core/parser/document/DocumentParser";
import { FenceDefinitionLowerer } from "@kmd/core/parser/document/FenceDefinitionLowerer";
import { extractFrontMatterBlock, linesToMetadata } from "@kmd/core/parser/frontmatter";
import { ExpressionBinder } from "@kmd/core/parser/expression/ExpressionBinder";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { StateLowerer } from "@kmd/core/parser/state/StateLowerer";
import { StateStore } from "@kmd/core/state/StateStore";

const PROBE = join(import.meta.dirname, "__fixtures__", "b2", "b2-design-probe.kmd");

describe("parser B2 design probe", () => {
  it("builds document control seeds and bakes conditional text without production wiring", () => {
    const source = readFileSync(PROBE, "utf-8").replace(/\r\n/gu, "\n");
    const document = parseDocumentStructure(source);
    expect(document.diagnostics).toEqual([]);
    expect(document.contentDiagnostics).toEqual([]);
    expect(document.expressionDiagnostics).toEqual([]);
    expect(document.chainDiagnostics).toEqual([]);

    const definitions = new DefinitionIndex();
    const fences = new FenceDefinitionLowerer(definitions).lower(document);
    expect(fences.complete).toBe(true);
    const scopes = new ScopeResolver(
      definitions,
      createStaticScopeCommandRegistryView([
        { name: "wave", family: "effect" },
        { name: "red", family: "style" },
        { name: "powerIn", family: "effect" },
      ]),
    );

    const frontmatter = extractFrontMatterBlock(source);
    expect(frontmatter).not.toBeNull();
    if (frontmatter === null) throw new Error("expected frontmatter");
    const metadata: Record<string, unknown> = {};
    linesToMetadata(frontmatter.lines, metadata);
    const variables = metadata.variables as Record<string, unknown>;
    const stateResult = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: source.length },
      frontmatterVariables: Object.entries(variables).map(([name, value]) => ({
        name,
        value,
        range: { start: source.indexOf(name), end: source.indexOf(name) + name.length },
      })),
      sentences: [],
    });
    expect(stateResult.complete).toBe(true);
    const state = new StateStore(stateResult.storeInitials);

    const controlLowerer = new ControlFlowLowerer(scopes);
    const control = controlLowerer.lower(document);
    expect(control.complete).toBe(true);
    expect(control.anchors.map((entry) => entry.name)).toEqual(["start", "truth", "lie", "end"]);
    expect(control.edgeSeeds).toHaveLength(3);
    expect(control.presenceSeeds).toHaveLength(1);
    expect(controlLowerer.evaluatePresence(control.presenceSeeds[0]!, { state })).toMatchObject({
      present: true,
      complete: true,
    });

    const conditionalLine = document.scenes[0]!.paragraphs
      .flatMap((paragraph) => paragraph.bodyLines)
      .find((line) => line.raw.startsWith("你好"));
    expect(conditionalLine).toBeDefined();
    if (conditionalLine === undefined) throw new Error("expected conditional content line");
    const contentLowerer = new ContentLowerer(new ExpressionBinder(scopes));
    const bound = contentLowerer.bind(conditionalLine.inline, {
      offset: conditionalLine.range.start,
    });
    const baked = contentLowerer.bake(bound.nodes, { state });
    expect(bound.complete).toBe(true);
    expect(baked).toMatchObject({ complete: true, text: "你好，月。她说真话" });
  });
});
