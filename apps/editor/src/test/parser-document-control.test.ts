import { describe, expect, it } from "vitest";
import { parseDocumentStructure } from "@kmd/core/parser/document/DocumentParser";

function codes(entries: readonly { code: string }[]): string[] {
  return entries.map((entry) => entry.code);
}

describe("parser-document-control: B2 document structure", () => {
  it("classifies structural lines, splits paragraphs, and keeps prefix slots non-sticky", () => {
    const source = [
      "[speed=80 align=center .glitch]",
      "[if var.ready]",
      "first {=var.name} @ .wave",
      "second",
      "",
      "[if var.detached]",
      "",
      ":::hero",
      "# hidden",
      "# visible @ .powerIn",
      "inside",
      ":::",
      "[if var.ready -> #hidden | else -> #visible]",
      "-> #hidden",
      "---",
      "tail",
    ].join("\n");
    const document = parseDocumentStructure(source);

    expect(document.scenes).toHaveLength(2);
    expect(document.scenes[0]!.paragraphs).toHaveLength(2);
    expect(document.scenes[1]!.paragraphs).toHaveLength(1);
    const first = document.scenes[0]!.paragraphs[0]!;
    expect(first.options).toMatchObject([
      { key: "speed", value: 80 },
      { key: "align", value: "center" },
    ]);
    expect(first.openers).toMatchObject([{ raw: ".glitch", diagnostics: [] }]);
    expect(first.presence).toHaveLength(1);
    expect(first.bodyLines.map((line) => line.raw)).toEqual([
      "first {=var.name} @ .wave",
      "second",
    ]);
    expect(first.bodyLines[0]).toMatchObject({
      type: "content-line",
      inline: [
        { type: "text-run", content: "first " },
        { type: "expr-span" },
      ],
      command: { raw: ".wave", diagnostics: [] },
    });

    const anchored = document.scenes[0]!.paragraphs[1]!;
    expect(anchored.options).toEqual([]);
    expect(anchored.presence).toEqual([]);
    expect(anchored.bodyLines).toMatchObject([
      { type: "anchor-content-line", name: "visible", body: "visible" },
      { type: "content-line", body: "inside" },
    ]);
    expect(document.lines.find((line) => line.raw === "# hidden")).toMatchObject({
      type: "anchor-line",
      name: "hidden",
    });
    expect(document.lines.find((line) => line.raw.startsWith("[if var.ready ->"))).toMatchObject({
      type: "bracket-line",
      slot: "routing",
      routing: {
        branches: [
          { kind: "condition", target: "hidden" },
          { kind: "else", target: "visible" },
        ],
      },
    });
    expect(document.lines.find((line) => line.raw === "-> #hidden")).toMatchObject({
      type: "goto-line",
      target: "hidden",
    });
    expect(codes(document.diagnostics)).toEqual(["document-dangling-paragraph-prefix"]);
  });

  it("rejects heading levels, malformed goto lines, and routing mixed with options", () => {
    const document = parseDocumentStructure([
      "## nested",
      "-> target",
      "[speed=80 if var.ready -> #next]",
      "# next",
    ].join("\n"));

    expect(codes(document.diagnostics)).toEqual([
      "document-heading-level-not-supported",
      "document-invalid-goto-line",
      "document-routing-mixed-slot",
      "document-invalid-routing-branch",
    ]);
    expect(document.lines.map((line) => line.type)).toEqual([
      "structure-error-line",
      "structure-error-line",
      "bracket-line",
      "anchor-line",
    ]);
  });

  it("allows anchors inside fences while keeping Anchor and Fence name spaces independent", () => {
    const document = parseDocumentStructure(":::same\n# same\ntext\n:::");
    expect(document.diagnostics).toEqual([]);
    expect(document.scenes[0]!.fences).toMatchObject([{ name: "same" }]);
    expect(document.lines.find((line) => line.type === "anchor-line")).toMatchObject({ name: "same" });
  });

  it("renders '# name @' as anchor content with the default reveal chain", () => {
    const document = parseDocumentStructure("# shown @\nnext");
    expect(document.diagnostics).toEqual([]);
    expect(document.scenes[0]!.paragraphs[0]!.bodyLines).toMatchObject([
      { type: "anchor-content-line", name: "shown", body: "shown", command: null },
      { type: "content-line", body: "next" },
    ]);
  });
});
