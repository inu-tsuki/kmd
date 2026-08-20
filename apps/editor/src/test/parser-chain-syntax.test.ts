import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import type {
  ChainExpressionAst,
  ChainSyntaxParseResult,
  ClauseMemberAst,
  CommandMemberAst,
  ReferenceMemberAst,
  SyntaxNodeBase,
} from "@kmd/core/parser/chainSyntax/types";

function parseOk(source: string, baseOffset = 0): ChainExpressionAst {
  const result = parseChainSyntax(source, baseOffset);
  expect(result.diagnostics).toEqual([]);
  return result.expression;
}

function diagnosticCodes(result: ChainSyntaxParseResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function expectRawInvariants(line: string, root: SyntaxNodeBase): void {
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || visited.has(value)) {
      return;
    }
    visited.add(value);
    if (
      "raw" in value
      && typeof value.raw === "string"
      && "range" in value
      && isRange(value.range)
    ) {
      expect(value.raw).toBe(line.slice(value.range.start, value.range.end));
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  };
  visit(root);
}

function isRange(value: unknown): value is { start: number; end: number } {
  return value !== null
    && typeof value === "object"
    && "start" in value
    && typeof value.start === "number"
    && "end" in value
    && typeof value.end === "number";
}

const DESIGN_PROBE = join(
  import.meta.dirname,
  "__fixtures__",
  "chain-syntax",
  "b0-1-design-probe.kmd",
);

describe("parser-chain-syntax: root classification and subject shape", () => {
  it("parses an explicit identifier subject and predicate", () => {
    const expression = parseOk("cam.zoom(1s)");
    expect(expression.sentences).toHaveLength(1);
    expect(expression.sentences[0]).toMatchObject({
      kind: "predicate",
      subject: {
        type: "identifier-subject",
        name: { type: "identifier", name: "cam" },
      },
      beats: [{ members: [{ type: "command-member", name: { name: "zoom" } }] }],
    });
  });

  it("uses an implicit subject when the first identifier carries arguments", () => {
    const sentence = parseOk("left(1self).rainbow").sentences[0]!;
    expect(sentence.subject).toBeNull();
    expect(sentence.beats[0]?.members).toMatchObject([
      { type: "command-member", name: { name: "left" } },
      { type: "command-member", name: { name: "rainbow" } },
    ]);
  });

  it("preserves the leading-dot line subject", () => {
    const sentence = parseOk(".wave").sentences[0]!;
    expect(sentence.subject).toMatchObject({ type: "dot-subject", raw: "." });
    expect(sentence.raw).toBe(".wave");
    expect(sentence.beats[0]?.members[0]).toMatchObject({
      type: "command-member",
      name: { name: "wave" },
    });
  });

  it("preserves selector subject content", () => {
    expect(parseOk("{hero}.wave").sentences[0]).toMatchObject({
      subject: { type: "selector-subject", raw: "{hero}", content: "hero" },
    });
  });

  it("classifies a bare-name definition and preserves its right-hand slice", () => {
    expect(parseOk("preset = cam.zoom(1)").sentences[0]).toMatchObject({
      kind: "definition",
      subject: null,
      beats: [],
      payload: {
        name: { type: "identifier", name: "preset", raw: "preset" },
        slice: {
          type: "expression-slice",
          raw: "cam.zoom(1)",
          delimited: "cam.zoom(1)",
        },
      },
    });
  });

  it("classifies a dotted-path assignment", () => {
    expect(parseOk("var.opacity = clamp(input, 0, 1)").sentences[0]).toMatchObject({
      kind: "assignment",
      payload: {
        path: [{ name: "var" }, { name: "opacity" }],
        slice: { raw: "clamp(input, 0, 1)" },
      },
    });
  });

  it.each([
    ["effobj.+wave(1s)", "+"],
    ["effobj.-wave", "-"],
  ])("classifies member operation %s", (source, op) => {
    const sentence = parseOk(source).sentences[0]!;
    expect(sentence.kind).toBe("member-op");
    expect(sentence.beats[0]?.members[0]).toMatchObject({
      type: "command-member",
      op,
      name: { name: "wave" },
    });
  });
});

describe("parser-chain-syntax: members, arguments, clauses, and references", () => {
  it("parses granularity, blocking, named values, references, and balanced expression slices", () => {
    const expression = parseOk(
      'effect:char(1s, strength=+=.5, label="a,b", target=var.x, expr=fn(1, nested(2, 3)))!',
    );
    const member = expression.sentences[0]!.beats[0]!.members[0] as CommandMemberAst;
    expect(member).toMatchObject({
      type: "command-member",
      granularity: { unit: "char" },
      blocking: true,
    });
    expect(member.args).toMatchObject([
      { name: null, value: { type: "time-quantity", value: 1, unit: "s" } },
      { name: { name: "strength" }, value: { type: "relative-quantity", value: 0.5 } },
      { name: { name: "label" }, value: { type: "string-literal", value: "a,b" } },
      {
        name: { name: "target" },
        value: { type: "name-ref", path: [{ name: "var" }, { name: "x" }] },
      },
      {
        name: { name: "expr" },
        value: { type: "expression-slice", raw: "fn(1, nested(2, 3))" },
      },
    ]);
  });

  it("parses a named string argument containing path separators before rate detection", () => {
    const expression = parseOk('bg(src="tests/assets/sample-bg.jpg")');
    const member = expression.sentences[0]!.beats[0]!.members[0] as CommandMemberAst;

    expect(member.args[0]).toMatchObject({
      name: { name: 'src' },
      value: {
        type: 'string-literal',
        value: 'tests/assets/sample-bg.jpg',
      },
    });
  });

  it("keeps relative and range equals signs inside positional literal values", () => {
    const member = parseOk("effect(+=.2, 0~>+=1)")
      .sentences[0]!.beats[0]!.members[0] as CommandMemberAst;
    expect(member.args).toMatchObject([
      {
        name: null,
        value: { type: "relative-quantity", operator: "+=", value: 0.2 },
      },
      {
        name: null,
        value: {
          type: "range-literal",
          from: { type: "number-literal", value: 0 },
          to: { type: "relative-quantity", operator: "+=", value: 1 },
        },
      },
    ]);
  });

  it("recursively parses a canonical subclause", () => {
    const sentence = parseOk("cam.wave.(bg.fade(0.7~2s~>1.0)):group!").sentences[0]!;
    const clause = sentence.beats[0]!.members[1] as ClauseMemberAst;
    expect(clause).toMatchObject({
      type: "clause-member",
      granularity: { unit: "group" },
      blocking: true,
      sentence: {
        kind: "predicate",
        subject: { type: "identifier-subject", name: { name: "bg" } },
        beats: [{ members: [{ name: { name: "fade" } }] }],
      },
    });
    const nestedCommand = clause.sentence.beats[0]!.members[0] as CommandMemberAst;
    expect(nestedCommand.args[0]?.value).toMatchObject({
      type: "range-literal",
      duration: { type: "time-quantity", value: 2, unit: "s" },
    });
  });

  it("delimits name and balanced expression references", () => {
    const sentence = parseOk(
      "cam.$preset.$(var.enabled ? shake(strength=2) : wave)",
    ).sentences[0]!;
    const [named, expression] = sentence.beats[0]!.members as ReferenceMemberAst[];
    expect(named).toMatchObject({
      type: "reference-member",
      form: "name",
      delimited: "preset",
    });
    expect(expression).toMatchObject({
      type: "reference-member",
      form: "expr",
      delimited: "var.enabled ? shake(strength=2) : wave",
    });
  });
});

describe("parser-chain-syntax: connectors and sentence separators", () => {
  it("parses hold and named-ease connectors into subsequent beats", () => {
    const sentence = parseOk("cam.fade -1s-> hold ~2s,powerIn~> zoom").sentences[0]!;
    expect(sentence.beats).toHaveLength(3);
    expect(sentence.beats[1]).toMatchObject({
      connectorBefore: {
        kind: "hold",
        raw: "-1s->",
        duration: { type: "time-quantity", value: 1, unit: "s" },
      },
      members: [{ name: { name: "hold" } }],
    });
    expect(sentence.beats[2]).toMatchObject({
      connectorBefore: {
        kind: "ease",
        duration: { value: 2, unit: "s" },
        easing: { type: "named-easing", name: { name: "powerIn" } },
      },
      members: [{ name: { name: "zoom" } }],
    });
  });

  it("distinguishes a no-whitespace hold connector from an identifier hyphen", () => {
    const sentence = parseOk("cam.fade-1s->hold").sentences[0]!;
    expect(sentence.beats).toHaveLength(2);
    expect(sentence.beats[0]!.members[0]).toMatchObject({ name: { name: "fade" } });
    expect(sentence.beats[1]).toMatchObject({
      connectorBefore: { kind: "hold", raw: "-1s->" },
      members: [{ name: { name: "hold" } }],
    });

    const hyphenated = parseOk("fade-in").sentences[0]!.beats[0]!.members[0];
    expect(hyphenated).toMatchObject({ name: { name: "fade-in" } });
  });

  it("retains a malformed no-whitespace connector as an invalid duration", () => {
    const result = parseChainSyntax("cam.fade-1ss->hold");
    expect(diagnosticCodes(result)).toContain("chain-invalid-quantity");
    expect(result.expression.sentences[0]!.beats).toHaveLength(2);
    expect(result.expression.sentences[0]!.beats[1]).toMatchObject({
      connectorBefore: {
        kind: "hold",
        duration: { type: "invalid-value", raw: "1ss" },
      },
      members: [{ name: { name: "hold" } }],
    });
  });

  it("parses the four-number Bezier form and permits y overshoot", () => {
    const connector = parseOk("cam.fade ~1s,0.1,1.2,0.9,-0.2~> zoom")
      .sentences[0]!.beats[1]!.connectorBefore!;
    expect(connector.easing).toMatchObject({
      type: "bezier-easing",
      x1: { value: 0.1 },
      y1: { value: 1.2 },
      x2: { value: 0.9 },
      y2: { value: -0.2 },
    });
  });

  it("keeps slot separators aligned with sentences", () => {
    const expression = parseOk("cam.wave   bg.fade");
    expect(expression.sentences).toHaveLength(2);
    expect(expression.separators).toEqual([
      expect.objectContaining({ kind: "slot", raw: "   " }),
    ]);
    expect(expression.sentences.length).toBe(expression.separators.length + 1);
  });

  it("preserves parallel structure and emits the reserved warning", () => {
    const result = parseChainSyntax("cam.wave + bg.fade");
    expect(result.expression.separators).toMatchObject([
      { kind: "parallel", raw: " + " },
    ]);
    expect(result.expression.sentences.length).toBe(2);
    expect(result.diagnostics).toMatchObject([
      { code: "chain-parallel-not-enabled", severity: "warning" },
    ]);
  });

  it("retains a trailing parallel separator with an error sentence", () => {
    const result = parseChainSyntax("cam.wave +   ");
    expect(result.expression.sentences.length).toBe(2);
    expect(result.expression.separators).toMatchObject([{ kind: "parallel", raw: " +" }]);
    expect(result.expression.sentences.length).toBe(result.expression.separators.length + 1);
    expect(diagnosticCodes(result)).toEqual([
      "chain-parallel-not-enabled",
      "chain-unexpected-token",
    ]);
  });
});

describe("parser-chain-syntax: ranges and recovery", () => {
  it("folds baseOffset into every nested node range", () => {
    const prefix = "  @ ";
    const source = "cam.fade ~2s,.2,1.2,.8,-.1~> zoom";
    const line = prefix + source;
    const expression = parseOk(source, prefix.length);
    expect(expression.range).toEqual({ start: prefix.length, end: line.length });
    expectRawInvariants(line, expression);

    const [first, second] = expression.sentences[0]!.beats;
    expect(first!.range.end).toBeLessThanOrEqual(second!.range.start);
    expect(second!.range.start).toBe(second!.connectorBefore!.range.start);
  });

  it("keeps recursive clause, argument, and reference ranges in the original line coordinates", () => {
    const prefix = "@ ";
    const source = 'cam.wave.(bg.fade(label="a,b", target=var.x).$preset)!';
    const line = prefix + source;
    const expression = parseOk(source, prefix.length);
    expectRawInvariants(line, expression);

    const clause = expression.sentences[0]!.beats[0]!.members[1] as ClauseMemberAst;
    expect(clause.range.start).toBeGreaterThanOrEqual(expression.range.start);
    expect(clause.range.end).toBeLessThanOrEqual(expression.range.end);
    expect(clause.sentence.range.start).toBeGreaterThan(clause.range.start);
    expect(clause.sentence.range.end).toBeLessThan(clause.range.end);
  });

  it("diagnoses Bezier x coordinates outside the closed interval", () => {
    const result = parseChainSyntax("cam.fade ~1s,-0.1,0,1.2,1~> zoom");
    expect(diagnosticCodes(result)).toEqual([
      "chain-easing-out-of-range",
      "chain-easing-out-of-range",
    ]);
  });

  it("recovers after an empty member and retains the later member", () => {
    const result = parseChainSyntax("cam.wave..bold");
    expect(diagnosticCodes(result)).toContain("chain-empty-member");
    expect(result.expression.sentences[0]!.beats[0]!.members).toMatchObject([
      { type: "command-member", name: { name: "wave" } },
      { type: "command-member", name: { name: "bold" } },
    ]);
  });

  it("rejects bg as granularity while retaining arguments", () => {
    const result = parseChainSyntax("effect:bg(1)");
    expect(diagnosticCodes(result)).toContain("chain-invalid-granularity");
    const member = result.expression.sentences[0]!.beats[0]!.members[0] as CommandMemberAst;
    expect(member.granularity).toBeNull();
    expect(member.args[0]?.value).toMatchObject({ type: "number-literal", value: 1 });
  });

  it.each([
    ["effect(1ss)", "chain-invalid-quantity"],
    ["effect(a=)", "chain-invalid-argument"],
    ["effect(1,)", "chain-invalid-argument"],
    ["effect(1s", "chain-unclosed-argument-list"],
    ["cam.fade -1s->", "chain-missing-beat"],
    ["cam.$(a ? fn(1)", "chain-unclosed-reference"],
    ["cam.wave.(bg.fade(1s)", "chain-unclosed-subclause"],
    ['effect("oops)', "chain-unclosed-string"],
    ["cam.wave#garbage", "chain-unexpected-token"],
    ["cam.(wave)", "chain-unexpected-token"],
  ])("returns structured recovery for %s", (source, code) => {
    const result = parseChainSyntax(source);
    expect(diagnosticCodes(result)).toContain(code);
    expect(result.expression.sentences.length).toBeGreaterThan(0);
  });

  it("covers every stable diagnostic code", () => {
    const sources = [
      "effect(1s",
      "cam.wave.(bg.fade(1s)",
      "cam.$(fn(1)",
      'effect("oops)',
      "cam.wave..bold",
      "cam.fade-1s->",
      "effect:bg(1)",
      "effect(1ss)",
      "effect(a=)",
      "cam.wave#tail",
      "cam.fade~1s,-.1,0,1.1,1~>zoom",
      "cam.wave + bg.fade",
    ];
    const codes = new Set(
      sources.flatMap((source) => diagnosticCodes(parseChainSyntax(source))),
    );
    expect([...codes].sort()).toEqual([
      "chain-easing-out-of-range",
      "chain-empty-member",
      "chain-invalid-argument",
      "chain-invalid-granularity",
      "chain-invalid-quantity",
      "chain-missing-beat",
      "chain-parallel-not-enabled",
      "chain-unclosed-argument-list",
      "chain-unclosed-reference",
      "chain-unclosed-string",
      "chain-unclosed-subclause",
      "chain-unexpected-token",
    ]);
  });

  it("continues at member and sentence recovery boundaries", () => {
    const result = parseChainSyntax(
      "cam.wave:bg(1).bold   effect(a=).outline   cam.zoom#tail bg.fade",
    );
    expect(result.expression.sentences).toHaveLength(4);
    expect(result.expression.sentences[0]!.beats[0]!.members).toMatchObject([
      { type: "command-member", name: { name: "wave" } },
      { type: "command-member", name: { name: "bold" } },
    ]);
    expect(result.expression.sentences[1]!.beats[0]!.members).toMatchObject([
      { type: "command-member", name: { name: "effect" } },
      { type: "command-member", name: { name: "outline" } },
    ]);
    expect(result.expression.sentences[3]).toMatchObject({
      subject: { type: "identifier-subject", name: { name: "bg" } },
      beats: [{ members: [{ name: { name: "fade" } }] }],
    });
    expect(diagnosticCodes(result)).toEqual([
      "chain-invalid-granularity",
      "chain-invalid-argument",
      "chain-unexpected-token",
    ]);
  });
});

describe("parser-chain-syntax: B0.1 design probe", () => {
  it("parses every target-syntax chain in the narrative probe", () => {
    const lines = readFileSync(DESIGN_PROBE, "utf-8").split(/\r?\n/u);
    const chainLines = lines.filter((line) => line.startsWith("@ "));
    expect(chainLines).toHaveLength(6);

    for (const line of chainLines) {
      const result = parseChainSyntax(line.slice(2), 2);
      expect(result.diagnostics, line).toEqual([]);
      expectRawInvariants(line, result.expression);
    }
  });
});
