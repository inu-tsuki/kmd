import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChainSyntax } from "@kmd/core/parser/chainSyntax/ChainSyntaxParser";
import { extractFrontMatterBlock, linesToMetadata } from "@kmd/core/parser/frontmatter";
import { ArgumentResolver } from "@kmd/core/parser/expression/ArgumentResolver";
import { OptionTable } from "@kmd/core/parser/options/OptionTable";
import { AssignmentFolder } from "@kmd/core/parser/state/AssignmentFolder";
import { StateLowerer } from "@kmd/core/parser/state/StateLowerer";
import { DefinitionIndex } from "@kmd/core/parser/scope/DefinitionIndex";
import { createStaticScopeCommandRegistryView } from "@kmd/core/parser/scope/RuntimeScopeRegistryView";
import { ScopeResolver } from "@kmd/core/parser/scope/ScopeResolver";
import { SubjectResolver } from "@kmd/core/parser/scope/SubjectResolver";
import { SemanticLowerer } from "@kmd/core/parser/semantic/SemanticLowerer";
import { StateStore } from "@kmd/core/state/StateStore";

const PROBE = join(import.meta.dirname, "__fixtures__", "b1", "b1-design-probe.kmd");

describe("parser B1 design probe", () => {
  it("binds state, evaluates arguments, and resolves paragraph options without production wiring", () => {
    const source = readFileSync(PROBE, "utf-8").replace(/\r\n/gu, "\n");
    const frontmatter = extractFrontMatterBlock(source);
    expect(frontmatter).not.toBeNull();
    if (frontmatter === null) throw new Error("expected frontmatter");

    const metadata: Record<string, unknown> = {};
    linesToMetadata(frontmatter.lines, metadata);
    const bodyStart = source.indexOf(frontmatter.body);
    const commandLines = frontmatter.body
      .split("\n")
      .filter((line) => line.startsWith("@ "));
    const parsedLines = commandLines.map((line) => {
      const chain = line.slice(2);
      const offset = source.indexOf(chain, bodyStart);
      return { chain, offset, syntax: parseChainSyntax(chain, offset) };
    });
    expect(parsedLines.flatMap((entry) => entry.syntax.diagnostics)).toEqual([]);

    const definitions = new DefinitionIndex();
    const registry = createStaticScopeCommandRegistryView([
      { name: "wave", family: "effect", metadata: { argumentUnits: { positional: ["number"] } } },
      { name: "rotate", family: "effect", metadata: { argumentUnits: { positional: ["deg"] } } },
    ]);
    const scopes = new ScopeResolver(definitions, registry);
    const variables = metadata.variables as Record<string, unknown>;
    const stateResult = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: source.length },
      frontmatterVariables: Object.entries(variables).map(([name, value]) => ({
        name,
        value,
        range: { start: source.indexOf(name), end: source.indexOf(name) + name.length },
      })),
      sentences: parsedLines.map((entry) => ({
        sentence: entry.syntax.expression.sentences[0]!,
        sceneVisibleUntil: { offset: source.length },
      })),
    });
    expect(stateResult.complete).toBe(true);

    const state = new StateStore(stateResult.storeInitials);
    const folded = new AssignmentFolder().foldThroughOffset(
      stateResult.assignments,
      source.length,
      state,
    );
    expect(folded.complete).toBe(true);
    expect(state.entries("document")).toMatchObject([{ qualifiedName: "var.trust", value: 3 }]);
    expect(state.entries("scene")).toMatchObject([{ name: "temp", value: 5 }]);

    const commandSyntax = parsedLines[2]!.syntax;
    const resolved = new SubjectResolver(scopes).resolveExpression(commandSyntax.expression);
    const argumentResolver = new ArgumentResolver(scopes);
    const semantic = argumentResolver.resolve(new SemanticLowerer().lowerExpression(resolved));
    expect(semantic.complete).toBe(true);
    const commandMembers = semantic.semantic.sentences[0]!.beats[0]!.members;
    const evaluated = commandMembers.map((member) => {
      expect(member.type).toBe("semantic-command-member");
      if (member.type !== "semantic-command-member") throw new Error("expected command member");
      return argumentResolver.evaluate(member.args[0]!.value, state).value;
    });
    expect(evaluated).toEqual([
      { type: "number", value: 20 },
      { type: "angle", value: 3, unit: "deg", defaultUnitApplied: true },
    ]);

    const documentOptions = frontmatter.lines
      .filter((line) => line.type === "key")
      .map((line) => ({
        key: line.key!,
        value: line.parsedValue,
        range: { start: 0, end: line.raw.length },
      }));
    const options = new OptionTable({ mode: "stage", speed: 40 }, documentOptions);
    expect(options.document()).toMatchObject({
      values: { mode: "stage", speed: 50 },
      diagnostics: [],
    });
    expect(options.resolveParagraph([{
      key: "speed",
      value: 80,
      range: { start: source.indexOf("speed=80"), end: source.indexOf("speed=80") + 8 },
    }])).toMatchObject({
      values: { speed: 80 },
      diagnostics: [],
    });
    expect(options.resolveParagraph([]).values.speed).toBe(50);
  });
});
