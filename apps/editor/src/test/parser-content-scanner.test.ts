import { describe, expect, it } from "vitest";
import { ContentLowerer } from "@kmd/core/parser/content/ContentLowerer";
import { scanContent } from "@kmd/core/parser/content/ContentScanner";
import { ExpressionBinder, stateKeyFromDefinition } from "@kmd/core/parser/expression/ExpressionBinder";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { StateStore } from "@kmd/core/state/StateStore";

describe("parser-content-scanner: B2 inline content", () => {
  it("keeps bare braces as text groups and bakes all three inline expression forms", () => {
    const source = "A{红绿灯}B{=var.name}{=var.ok ? 是 | 否}{=var.mood ? happy: 笑 | sad: 哭 | 静}C|(click)";
    const scanned = scanContent(source, 10);

    expect(scanned.complete).toBe(true);
    expect(scanned.nodes.map((node) => node.type)).toEqual([
      "text-run",
      "brace-group",
      "text-run",
      "expr-span",
      "expr-span",
      "expr-span",
      "text-run",
      "pause-cue",
    ]);
    expect(scanned.nodes[1]).toMatchObject({
      type: "brace-group",
      children: [{ type: "text-run", content: "红绿灯" }],
    });
    expect(scanned.nodes[3]).toMatchObject({
      type: "expr-span",
      expression: { type: "inline-interpolation" },
      range: { start: 17 },
    });
    expect(scanned.nodes[7]).toMatchObject({
      type: "pause-cue",
      parameter: "click",
      closed: true,
    });

    const definitions = new DefinitionIndex();
    const values = { name: "小月", ok: true, mood: "happy" } as const;
    const entries = Object.entries(values).map(([name, value]) => {
      const definition = definitions.add({
        name,
        kind: "var",
        level: "document",
        visibleFrom: { offset: 0 },
        visibleUntil: { offset: 500 },
        payload: null,
        declarationRange: { start: 0, end: name.length },
        source: "frontmatter",
      });
      return { key: stateKeyFromDefinition(definition), value };
    });
    const scopes = new ScopeResolver(
      definitions,
      createStaticScopeCommandRegistryView([]),
    );
    const lowerer = new ContentLowerer(new ExpressionBinder(scopes));
    const bound = lowerer.bind(scanned.nodes, { offset: 10 });
    const baked = lowerer.bake(bound.nodes, { state: new StateStore(entries) });

    expect(bound.complete).toBe(true);
    expect(baked.complete).toBe(true);
    expect(baked.text).toBe("A红绿灯B小月是笑C");
  });

  it("keeps UTF-16 absolute ranges and reports malformed spans without discarding surrounding text", () => {
    const source = "甲{=var.ok ? 有}乙{";
    const scanned = scanContent(source, 100);

    expect(scanned.complete).toBe(false);
    expect(scanned.nodes[0]).toMatchObject({ range: { start: 100, end: 101 } });
    expect(scanned.diagnostics.map((entry) => entry.code)).toEqual([
      "content-conditional-branch-count",
      "content-conditional-empty-text",
      "content-unclosed-brace-group",
    ]);
    expect(scanned.nodes.at(-1)).toMatchObject({ type: "brace-group", closed: false });
  });
});
