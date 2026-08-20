import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import {
  createStaticScopeCommandRegistryView,
  runtimeScopeCommandRegistryView,
} from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import type {
  BraceGroupInput,
  ResolvedCommandMember,
  ScopeCommandMatch,
} from "@kmd/core/parser/scope/types";

const TEST_REGISTRY: ScopeCommandMatch[] = [
  { name: "bold", family: "style" },
  { name: "gray", family: "style" },
  { name: "gray", family: "effect" },
  { name: "wave", family: "effect" },
  { name: "goto", family: "layout" },
  { name: "left", family: "layout" },
  { name: "up", family: "layout" },
  { name: "cam.zoom", family: "stage" },
];

const DESIGN_PROBE = join(
  import.meta.dirname,
  "__fixtures__",
  "scope-resolution",
  "b0-2-design-probe.kmd",
);

function harness(entries: readonly ScopeCommandMatch[] = TEST_REGISTRY) {
  const definitions = new DefinitionIndex();
  const registry = createStaticScopeCommandRegistryView(entries);
  const scopes = new ScopeResolver(definitions, registry);
  const subjects = new SubjectResolver(scopes);
  return { definitions, scopes, subjects };
}

function parse(source: string, baseOffset = 0) {
  const result = parseChainSyntax(source, baseOffset);
  expect(result.diagnostics).toEqual([]);
  return result.expression;
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function groups(...texts: string[]): BraceGroupInput[] {
  let offset = 0;
  return texts.map((text, index) => {
    const group = {
      id: index + 1,
      text,
      range: { start: offset, end: offset + text.length + 2 },
    };
    offset = group.range.end + 1;
    return group;
  });
}

describe("parser-scope-resolution: DefinitionIndex and D21", () => {
  it("resolves scene definitions only inside their source interval", () => {
    const { definitions, scopes } = harness();
    const sentence = parse("hero = .wave", 10).sentences[0]!;
    definitions.addSentence({ sentence, visibleUntil: { offset: 50 } });

    expect(scopes.resolve("hero", { offset: 20 }, sentence.range)).toMatchObject({
      status: "resolved",
      entity: {
        kind: "definition",
        definition: { name: "hero", level: "scene", visibleFrom: { offset: 10 } },
      },
    });
    expect(scopes.resolve("hero", { offset: 50 }, sentence.range)).toMatchObject({
      status: "unresolved",
      reason: "out-of-scope",
      diagnostics: [{ code: "scope-name-out-of-scope" }],
    });
  });

  it("collects var assignments as document definitions with a qualified name", () => {
    const { definitions, scopes, subjects } = harness();
    const expression = parse("var.opacity = 0.5", 30);
    const sentence = expression.sentences[0]!;
    const definition = definitions.addSentence({ sentence, visibleUntil: { offset: 200 } });

    expect(definition).toMatchObject({
      name: "opacity",
      qualifiedName: "var.opacity",
      kind: "var",
      level: "document",
      visibleFrom: { offset: 0 },
    });
    expect(scopes.resolve("var.opacity", { offset: 150 }, sentence.range).status).toBe("resolved");
    expect(subjects.resolveExpression(expression).sentences[0]).toMatchObject({
      subject: null,
      commandHead: null,
      beats: [],
    });
  });

  it("audits duplicate names, built-in collisions, user-command collisions, and registry collisions", () => {
    const { definitions, scopes } = harness();
    definitions.add({
      name: "hero",
      kind: "object",
      level: "scene",
      visibleFrom: { offset: 1 },
      visibleUntil: { offset: 20 },
      payload: null,
      declarationRange: { start: 1, end: 5 },
      source: "fence",
    });
    definitions.add({
      name: "hero",
      kind: "macro",
      level: "scene",
      visibleFrom: { offset: 25 },
      visibleUntil: { offset: 40 },
      payload: null,
      declarationRange: { start: 25, end: 29 },
      source: "definition",
    });
    for (const name of ["cam", "wave"]) {
      definitions.add({
        name,
        kind: "macro",
        level: "scene",
        visibleFrom: { offset: 50 },
        visibleUntil: { offset: 80 },
        payload: null,
        declarationRange: { start: 50, end: 50 + name.length },
        source: "definition",
      });
    }

    expect(new Set(codes(scopes.audit()))).toEqual(new Set([
      "scope-duplicate-definition",
      "scope-command-family-conflict",
      "scope-name-conflicts-builtin",
      "scope-name-conflicts-command",
    ]));
  });
});

describe("parser-scope-resolution: B0.1 AST consumption", () => {
  it("maps cam members to namespaced stage registrations", () => {
    const { subjects } = harness();
    const resolved = subjects.resolveExpression(parse("cam.zoom(1s)"));

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.sentences[0]).toMatchObject({
      subject: { kind: "builtin", name: "cam" },
      beats: [{
        members: [{
          role: "predicate",
          command: { name: "cam.zoom", family: "stage" },
        }],
      }],
    });
  });

  it("keeps a registry command head while resolving later predicates", () => {
    const { subjects } = harness();
    const resolved = subjects.resolveExpression(parse("bold.wave"));

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.sentences[0]).toMatchObject({
      subject: { kind: "selector", selector: { kind: "line", source: "implicit-command" } },
      commandHead: { name: "bold", family: "style" },
      beats: [{ members: [{ command: { name: "wave", family: "effect" } }] }],
    });
  });

  it("uses user objects as domain selectors and permits endpoint access", () => {
    const { definitions, subjects } = harness();
    definitions.add({
      name: "hero",
      kind: "object",
      level: "scene",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: 100 },
      payload: null,
      declarationRange: { start: 0, end: 4 },
      source: "fence",
    });

    const resolved = subjects.resolveExpression(parse("hero.start.goto"), { at: { offset: 10 } });
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.sentences[0]).toMatchObject({
      subject: {
        kind: "selector",
        selector: { kind: "access", accessor: "start", valueType: "point" },
      },
      beats: [{ members: [
        { role: "selector-accessor", command: null },
        { role: "predicate", command: { name: "goto", family: "layout" } },
      ] }],
    });
  });

  it("diagnoses ambiguous command heads without applying a family priority", () => {
    const { subjects } = harness();
    const resolved = subjects.resolveExpression(parse("gray.wave"));
    expect(codes(resolved.diagnostics)).toContain("scope-command-family-conflict");
    expect(resolved.sentences[0]!.commandHead).toBeNull();
  });

  it("diagnoses bare layout chains while accepting the explicit dot form", () => {
    const { subjects } = harness();
    const bare = subjects.resolveExpression(parse("up(100)"));
    const commandHead = subjects.resolveExpression(parse("up.left"));
    const explicit = subjects.resolveExpression(parse(".up(100)"));

    expect(codes(bare.diagnostics)).toContain("scope-bare-layout-deprecated");
    expect(codes(commandHead.diagnostics)).toContain("scope-bare-layout-deprecated");
    expect(codes(explicit.diagnostics)).not.toContain("scope-bare-layout-deprecated");
    expect(explicit.sentences[0]!.source.subject).toMatchObject({ type: "dot-subject" });
  });
});

describe("parser-scope-resolution: selectors and spatial accessors", () => {
  it("binds sequential selectors and permits additional content selectors", () => {
    const { subjects } = harness();
    const resolved = subjects.resolveExpression(
      parse("{}.bold {}.wave {真}.bold"),
      { braceGroups: groups("真相", "答案") },
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.sentences[0]).toMatchObject({
      subject: { kind: "selector", selector: { mode: "sequence", group: { id: 1 } } },
    });
    expect(resolved.sentences[1]).toMatchObject({
      subject: { kind: "selector", selector: { mode: "sequence", group: { id: 2 } } },
    });
    expect(resolved.sentences[2]).toMatchObject({
      subject: { kind: "selector", selector: { mode: "content", group: { id: 1 } } },
    });
  });

  it("reports sequential-count mismatch and ambiguous content prefixes", () => {
    const { subjects } = harness();
    const mismatch = subjects.resolveExpression(parse("{}.wave"), {
      braceGroups: groups("甲", "乙"),
    });
    const ambiguous = subjects.resolveExpression(parse("{真}.wave"), {
      braceGroups: groups("真相", "真话"),
    });

    expect(codes(mismatch.diagnostics)).toContain("selector-group-count-mismatch");
    expect(codes(ambiguous.diagnostics)).toContain("selector-content-ambiguous");
  });

  it("uses one-based ordinal disambiguation for prefix matches", () => {
    const { subjects } = harness();
    const resolved = subjects.resolveExpression(parse("{真:2}.wave"), {
      braceGroups: groups("真相", "真话"),
    });

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.sentences[0]).toMatchObject({
      subject: { kind: "selector", selector: { group: { id: 2 }, occurrence: 2 } },
    });
  });

  it("constructs mark/range selectors and applies type-checked accessors", () => {
    const { subjects } = harness();
    const mark = subjects.resolveExpression(parse("mark(p).line.wave"));
    const range = subjects.resolveExpression(parse("range(a,b).wave"));
    const invalid = subjects.resolveExpression(parse("{甲}.line.wave"), {
      braceGroups: groups("甲"),
    });

    expect(mark.diagnostics).toEqual([]);
    expect(mark.sentences[0]).toMatchObject({
      subject: { kind: "selector", selector: { kind: "access", valueType: "domain", accessor: "line" } },
      beats: [{ members: [
        { role: "selector-constructor" },
        { role: "selector-accessor" },
        { role: "predicate", command: { name: "wave" } },
      ] }],
    });
    expect(range.sentences[0]).toMatchObject({
      subject: { kind: "selector", selector: { kind: "range", valueType: "domain" } },
    });
    expect(codes(invalid.diagnostics)).toContain("selector-invalid-accessor");
  });

  it("exposes one runtime family per command as required by D21", () => {
    expect(runtimeScopeCommandRegistryView.find("gray").map((entry) => entry.family)).toEqual(["style"]);
    expect(runtimeScopeCommandRegistryView.find("grayscale").map((entry) => entry.family)).toEqual(["effect"]);
    expect(runtimeScopeCommandRegistryView.find("cam.zoom")).toMatchObject([
      { name: "cam.zoom", family: "stage" },
    ]);
  });
});

describe("parser-scope-resolution: B0.2 design probe", () => {
  it("keeps every target chain consumable by the B0.1 parser", () => {
    const lines = readFileSync(DESIGN_PROBE, "utf-8").split(/\r?\n/u);
    const chains = lines.flatMap((line) => {
      const marker = line.indexOf("@ ");
      return marker < 0 ? [] : [{ source: line.slice(marker + 2), baseOffset: marker + 2 }];
    });
    expect(chains).toHaveLength(7);

    for (const chain of chains) {
      expect(parseChainSyntax(chain.source, chain.baseOffset).diagnostics).toEqual([]);
    }
  });

  it("covers every stable B0.2 diagnostic code", () => {
    const { definitions, scopes, subjects } = harness();
    definitions.add({
      name: "hero",
      kind: "object",
      level: "scene",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: 10 },
      payload: null,
      declarationRange: { start: 0, end: 4 },
      source: "fence",
    });
    definitions.add({
      name: "hero",
      kind: "macro",
      level: "scene",
      visibleFrom: { offset: 20 },
      visibleUntil: { offset: 20 },
      payload: null,
      declarationRange: { start: 20, end: 24 },
      source: "definition",
    });
    definitions.add({
      name: "cam",
      kind: "macro",
      level: "scene",
      visibleFrom: { offset: 30 },
      visibleUntil: { offset: 40 },
      payload: null,
      declarationRange: { start: 30, end: 33 },
      source: "definition",
    });
    definitions.add({
      name: "sceneOnly",
      kind: "object",
      level: "scene",
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: 10 },
      payload: null,
      declarationRange: { start: 50, end: 59 },
      source: "fence",
    });
    definitions.add({
      name: "wave",
      kind: "macro",
      level: "scene",
      visibleFrom: { offset: 40 },
      visibleUntil: { offset: 50 },
      payload: null,
      declarationRange: { start: 40, end: 44 },
      source: "definition",
    });

    const allDiagnostics = [
      ...scopes.audit(),
      ...scopes.resolve("sceneOnly", { offset: 15 }, { start: 0, end: 9 }).diagnostics,
      ...scopes.resolve("missing", { offset: 15 }, { start: 0, end: 7 }).diagnostics,
      ...subjects.resolveExpression(parse(".missing")).diagnostics,
      ...subjects.resolveExpression(parse("up(1)")).diagnostics,
      ...subjects.resolveExpression(parse("{}.wave"), { braceGroups: groups("甲", "乙") }).diagnostics,
      ...subjects.resolveExpression(parse("{无}.wave"), { braceGroups: groups("甲") }).diagnostics,
      ...subjects.resolveExpression(parse("{真}.wave"), { braceGroups: groups("真相", "真话") }).diagnostics,
      ...subjects.resolveExpression(parse("{真:3}.wave"), { braceGroups: groups("真相", "真话") }).diagnostics,
      ...subjects.resolveExpression(parse("{真:0}.wave"), { braceGroups: groups("真相") }).diagnostics,
      ...subjects.resolveExpression(parse("{甲}.line.wave"), { braceGroups: groups("甲") }).diagnostics,
      ...subjects.resolveExpression(parse("mark().wave")).diagnostics,
    ];

    expect([...new Set(codes(allDiagnostics))].sort()).toEqual([
      "scope-bare-layout-deprecated",
      "scope-command-family-conflict",
      "scope-duplicate-definition",
      "scope-invalid-definition-interval",
      "scope-name-conflicts-builtin",
      "scope-name-conflicts-command",
      "scope-name-out-of-scope",
      "scope-unknown-command",
      "scope-unknown-name",
      "selector-constructor-argument",
      "selector-content-ambiguous",
      "selector-content-not-found",
      "selector-group-count-mismatch",
      "selector-invalid-accessor",
      "selector-invalid-ordinal",
      "selector-ordinal-out-of-range",
    ]);
  });
});
