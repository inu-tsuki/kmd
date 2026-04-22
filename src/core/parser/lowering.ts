import type { CommandRegistryView } from "./commandCatalog";
import type {
  BlockOptions,
  EffectConfig,
  KMDInlineIR,
  KMDParagraphData,
  ParagraphAst,
  ParagraphIR,
  ParserDiagnostic,
  ParserIrTransform,
} from "./types";
import { applyIrTransforms } from "./transforms";
import { applyBlockOptionCommands, applyLineCommands, applyParagraphBroadcast, getVisualTargets } from "./ScopeRouter";
import { projectParagraphToLegacyData } from "./CompatProjector";

function createEmptyToken(kind: KMDInlineIR["kind"], line: number, range: { start: number; end: number }): KMDInlineIR {
  return {
    kind,
    line,
    range,
    content: "",
    effects: [],
    commands: [],
    params: {},
    layoutInstructions: [],
    sugar: [],
    isSugar: kind === "sugar",
    isPipe: kind === "pause",
    isSceneClear: kind === "scene-clear",
  };
}

function buildInlineFromAst(paragraph: ParagraphAst, diagnostics: ParserDiagnostic[]): KMDInlineIR[] {
  // Transitional inline IR. It is already detached from the old scanner output,
  // but layout and playback cues are still partially mixed here for runtime compatibility.
  const inline: KMDInlineIR[] = [];

  const pushNode = (node: any, heading: boolean) => {
    if (node.type === "group") {
      node.children.forEach((child: any) => pushNode(child, heading));
      return;
    }

    if (node.type === "text") {
      const effects: EffectConfig[] = [];
      const sugar: KMDInlineIR["sugar"] = [];
      if (node.marks.includes("bold")) {
        effects.push({ name: "bold", params: {}, level: "char", line: node.line, range: node.range });
        sugar.push({ name: "slow", params: {}, level: "char" });
      }
      if (node.marks.includes("italic")) {
        effects.push({ name: "thin", params: {}, level: "char", line: node.line, range: node.range });
        effects.push({ name: "dim", params: {}, level: "char", line: node.line, range: node.range });
        sugar.push({ name: "fast", params: {}, level: "char" });
      }
      if (heading) {
        effects.push({ name: "special", params: {}, level: "char", line: node.line, range: node.range });
      }
      inline.push({
        kind: "text",
        line: node.line,
        range: node.range,
        content: node.text,
        effects,
        commands: [],
        params: {},
        layoutInstructions: [],
        sugar,
        isBraced: node.groupId !== undefined,
        braceGroupId: node.groupId,
      });
      return;
    }

    if (node.type === "sugar") {
      const token = createEmptyToken("sugar", node.line, node.range);
      token.sugar.push({
        name: node.name,
        params: { ...(node.params || {}) },
        level: node.level,
      });
      inline.push(token);
      return;
    }

    if (node.type === "pause") {
      const token = createEmptyToken("pause", node.line, node.range);
      token.layoutInstructions.push({
        type: "pause",
        params: { ...(node.params || {}) },
        blocking: true,
        line: node.line,
        range: node.range,
      });
      inline.push(token);
      return;
    }

    diagnostics.push({
      severity: "warning",
      message: `Unhandled inline node "${node.type}"`,
      line: node.line,
      range: node.range,
      code: "unhandled-inline",
    });
  };

  paragraph.lines.forEach((line, idx) => {
    if (line.kind === "scene-clear") {
      const token = createEmptyToken("scene-clear", line.line, line.range);
      token.layoutInstructions.push({
        type: "scene.clear",
        params: {},
        blocking: false,
        line: line.line,
        range: { start: 0, end: line.raw.length },
      });
      token.layoutInstructions.push({
        type: "pause",
        params: { 0: 0.5 },
        blocking: true,
        line: line.line,
        range: { start: 0, end: line.raw.length },
      });
      inline.push(token);
      if (idx < paragraph.lines.length - 1) {
        inline.push({
          ...createEmptyToken("newline", line.line, { start: line.raw.length, end: line.raw.length }),
          content: "\n",
        });
      }
      return;
    }

    if (line.kind === "empty") {
      if (idx < paragraph.lines.length - 1) {
        inline.push({
          ...createEmptyToken("newline", line.line, { start: 0, end: 0 }),
          content: "\n",
        });
      }
      return;
    }

    line.body.forEach((node) => pushNode(node, line.heading));
    if (idx < paragraph.lines.length - 1 && line.body.length > 0) {
      inline.push({
        ...createEmptyToken("newline", line.line, { start: line.raw.length, end: line.raw.length }),
        content: "\n",
      });
    }
  });

  return inline;
}

function lowerAstToIr(
  ast: ParagraphAst,
  diagnostics: ParserDiagnostic[],
  registryView: CommandRegistryView,
): ParagraphIR {
  const inline = buildInlineFromAst(ast, diagnostics);
  const paragraphEffects: EffectConfig[] = [];
  const paragraphBroadcast: EffectConfig[] = [];
  const blockOptions: BlockOptions = {};

  applyBlockOptionCommands(ast, inline, blockOptions, paragraphEffects, diagnostics, registryView);

  ast.lines.forEach((line) => {
    const lineTokens = inline.filter((token) => token.line === line.line && token.kind !== "newline");
    if (line.commandChains.length > 0) {
      applyLineCommands(lineTokens, line.commandChains, paragraphEffects, paragraphBroadcast, diagnostics, registryView);
    }
  });

  if (paragraphBroadcast.length > 0) {
    applyParagraphBroadcast(getVisualTargets(inline), paragraphBroadcast);
  }

  return {
    blockOptions,
    inline,
    paragraphEffects,
    diagnostics,
  };
}

export function buildParagraphData(
  ast: ParagraphAst,
  diagnostics: ParserDiagnostic[],
  irTransforms: ParserIrTransform[] = [],
  registryView: CommandRegistryView,
): KMDParagraphData {
  const baseIr = lowerAstToIr(ast, diagnostics, registryView);
  const ir = irTransforms.length > 0 ? applyIrTransforms(baseIr, irTransforms, diagnostics) : baseIr;
  return projectParagraphToLegacyData(ast, ir, diagnostics);
}
