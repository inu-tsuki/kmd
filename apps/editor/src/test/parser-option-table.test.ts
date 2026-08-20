import { describe, expect, it } from "vitest";
import { OptionTable } from "@kmd/core/parser/options/OptionTable";

const range = { start: 0, end: 1 };

describe("parser-option-table", () => {
  it("cascades defaults, document options, and a non-sticky paragraph patch", () => {
    const table = new OptionTable(
      { speed: 40, align: "left", fontSize: 24 },
      [
        { key: "speed", value: 55, range },
        { key: "align", value: "center", range },
      ],
    );

    expect(table.resolveParagraph([
      { key: "speed", value: 80, range: { start: 10, end: 18 } },
    ])).toMatchObject({
      values: { speed: 80, align: "center", fontSize: 24 },
      diagnostics: [],
    });
    expect(table.resolveParagraph([]).values).toMatchObject({
      speed: 55,
      align: "center",
      fontSize: 24,
    });
  });

  it("rejects document-only startup keys in paragraph scope", () => {
    const table = new OptionTable(
      { mode: "stage", designWidth: 1920, designHeight: 1080 },
      [],
    );
    const result = table.resolveParagraph([
      { key: "mode", value: "scroll", range: { start: 20, end: 31 } },
      { key: "designWidth", value: 1280, range: { start: 32, end: 48 } },
    ]);

    expect(result.values).toMatchObject({ mode: "stage", designWidth: 1920 });
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      "option-document-only",
      "option-document-only",
    ]);
  });

  it("preserves unknown document fields and ignores unknown paragraph fields", () => {
    const table = new OptionTable(
      { speed: 40 },
      [{ key: "futureField", value: "kept", range }],
    );

    expect(table.document()).toMatchObject({
      values: { speed: 40, futureField: "kept" },
      diagnostics: [],
    });
    expect(table.resolveParagraph([
      { key: "futureField", value: "ignored", range: { start: 10, end: 20 } },
    ])).toMatchObject({
      values: { futureField: "kept" },
      diagnostics: [{ code: "option-unknown-paragraph-key", severity: "warning" }],
    });
  });

  it("normalizes the historical paged alias and gives interactive a documented fallback", () => {
    expect(new OptionTable({}, [{ key: "mode", value: "paged", range }]).document())
      .toMatchObject({
        values: { mode: "page" },
        diagnostics: [{ code: "option-normalized-alias", severity: "warning" }],
      });
    expect(new OptionTable({}, [{ key: "mode", value: "interactive", range }]).document())
      .toMatchObject({
        values: { mode: "stage" },
        diagnostics: [{ code: "option-unsupported-mode", severity: "warning" }],
      });
  });

  it("does not apply invalid numeric document or paragraph values", () => {
    const table = new OptionTable(
      { speed: 40, lineHeight: 60 },
      [{ key: "speed", value: 0, range }],
    );

    expect(table.document()).toMatchObject({
      values: { speed: 40 },
      diagnostics: [{ code: "option-invalid-value", severity: "error" }],
    });
    expect(table.resolveParagraph([
      { key: "lineHeight", value: Number.NaN, range },
    ])).toMatchObject({
      values: { lineHeight: 60 },
      diagnostics: [{ code: "option-invalid-value", severity: "error" }],
    });
  });

  it("requires kmdVersion to use the reserved string contract", () => {
    const result = new OptionTable(
      {},
      [{ key: "kmdVersion", value: 0.2, range }],
    ).document();

    expect(result.values).not.toHaveProperty("kmdVersion");
    expect(result.diagnostics).toMatchObject([
      { code: "option-invalid-value", severity: "error", range },
    ]);
  });
});
