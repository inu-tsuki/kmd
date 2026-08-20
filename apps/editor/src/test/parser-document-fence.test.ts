import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { FenceDefinitionLowerer } from "@kmd/core/parser/document/FenceDefinitionLowerer";
import { parseDocumentStructure } from "@kmd/core/parser/document/DocumentParser";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";

function diagnosticCodes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("parser-document-fence: document structure", () => {
  it("keeps frontmatter delimiters outside scene splitting", () => {
    const source = "---\nmode: stage\n---\nfirst\n---\nsecond";
    const document = parseDocumentStructure(source);

    expect(document.frontmatterRange).toEqual({ start: 0, end: source.indexOf("first") });
    expect(document.scenes).toHaveLength(2);
    expect(document.scenes.map((scene) => scene.lines.map((line) => line.raw))).toEqual([
      ["first"],
      ["second"],
    ]);
    expect(document.lines.filter((line) => line.type === "scene-boundary-line")).toHaveLength(1);
  });

  it("preserves UTF-16 ranges and CRLF widths", () => {
    const source = ":::obj\r\n甲\r\n:::\r\n";
    const document = parseDocumentStructure(source);
    const fence = document.scenes[0]!.fences[0]!;

    expect(fence).toMatchObject({
      name: "obj",
      openRange: { start: 0, end: 6 },
      contentRange: { start: 8, end: 11 },
      closeRange: { start: 11, end: 14 },
      coveredLineRanges: [{ start: 8, end: 9 }],
      closed: true,
    });
  });

  it("builds a nested stack and records content membership for every active fence", () => {
    const source = [
      ":::outer",
      "# heading",
      ":::inner",
      "nested",
      ":::",
      "tail",
      ":::",
    ].join("\n");
    const document = parseDocumentStructure(source);
    const [outer, inner] = document.scenes[0]!.fences;
    const nestedLine = document.lines.find((line) => line.raw === "nested");

    expect(outer).toMatchObject({ name: "outer", depth: 0, parentFenceId: null, closed: true });
    expect(inner).toMatchObject({ name: "inner", depth: 1, parentFenceId: outer!.id, closed: true });
    expect(nestedLine).toMatchObject({
      type: "content-line",
      activeFenceIds: [outer!.id, inner!.id],
    });
    expect(outer!.coveredLineRanges).toContainEqual(nestedLine!.range);
    expect(inner!.coveredLineRanges).toContainEqual(nestedLine!.range);
    expect(document.lines.find((line) => line.raw === "# heading")).toMatchObject({
      type: "anchor-line",
      activeFenceIds: [outer!.id],
      name: "heading",
    });
  });

  it("closes malformed scene-crossing fences structurally and starts a clean next scene", () => {
    const source = ":::hero\ninside\n---\nafter";
    const document = parseDocumentStructure(source);
    const fence = document.scenes[0]!.fences[0]!;

    expect(diagnosticCodes(document.diagnostics)).toEqual(["document-fence-crosses-scene"]);
    expect(fence).toMatchObject({
      name: "hero",
      contentRange: { start: source.indexOf("inside"), end: source.indexOf("---") },
      closeRange: null,
      closed: false,
    });
    expect(document.scenes[0]!.lines.some((line) => line.type === "scene-boundary-line")).toBe(false);
    expect(document.scenes[1]!.lines).toMatchObject([{ raw: "after", activeFenceIds: [] }]);
  });

  it("reports stray, malformed, and EOF-unclosed fence lines independently", () => {
    const source = ":::\n:::name extra\n:::open\ncontent";
    const document = parseDocumentStructure(source);

    expect(diagnosticCodes(document.diagnostics)).toEqual([
      "document-stray-fence-close",
      "document-invalid-fence-line",
      "document-unclosed-fence",
    ]);
    expect(document.scenes[0]!.fences[0]).toMatchObject({ name: "open", closed: false });
    expect(document.lines.map((line) => line.type)).toEqual([
      "fence-close-line",
      "fence-error-line",
      "fence-open-line",
      "content-line",
    ]);
  });

  it("retains one empty scene for an empty document", () => {
    const document = parseDocumentStructure("");
    expect(document.scenes).toMatchObject([{ index: 0, range: { start: 0, end: 0 }, lines: [] }]);
  });
});

describe("parser-document-fence: object definitions", () => {
  it("lowers fence names to scene definitions with content bindings", () => {
    const source = ":::hero\nline\n:::\nhero.wave";
    const document = parseDocumentStructure(source);
    const definitions = new DefinitionIndex();
    const lowered = new FenceDefinitionLowerer(definitions).lower(document);

    expect(lowered.complete).toBe(true);
    expect(lowered.definitions[0]).toMatchObject({
      name: "hero",
      kind: "object",
      level: "scene",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: source.length },
      source: "fence",
      payload: {
        type: "fence-object-binding",
        sceneIndex: 0,
        coveredLineRanges: [{
          start: source.indexOf("line"),
          end: source.indexOf("line") + "line".length,
        }],
      },
    });

    const expression = parseChainSyntax("hero.wave", source.indexOf("hero.wave")).expression;
    const subjects = new SubjectResolver(new ScopeResolver(
      definitions,
      createStaticScopeCommandRegistryView([{ name: "wave", family: "effect" }]),
    ));
    expect(subjects.resolveExpression(expression).sentences[0]).toMatchObject({
      subject: {
        kind: "selector",
        selector: {
          kind: "definition",
          definition: { name: "hero", kind: "object" },
        },
      },
      beats: [{ members: [{ command: { name: "wave", family: "effect" } }] }],
    });
  });

  it("keeps malformed fence bindings for editor display and reports duplicate names", () => {
    const source = ":::same\n:::\n:::same\nbody";
    const definitions = new DefinitionIndex();
    const lowered = new FenceDefinitionLowerer(definitions).lower(parseDocumentStructure(source));

    expect(lowered.complete).toBe(false);
    expect(lowered.definitions).toHaveLength(2);
    expect(diagnosticCodes(lowered.diagnostics)).toContain("document-unclosed-fence");
    expect(diagnosticCodes(lowered.scopeDiagnostics)).toContain("scope-duplicate-definition");
  });
});
