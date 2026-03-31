import { getCommandSemanticInfo } from "./commandCatalog";
import type {
  BlockOptions,
  CommandChainAst,
  EffectConfig,
  KMDInlineIR,
  KMDParagraphData,
  KMDToken,
  LayoutInstruction,
  ParagraphAst,
  ParagraphIR,
  ParsedCommand,
  ParserDiagnostic,
  ParserIrTransform,
} from "./types";
import { applyIrTransforms } from "./transforms";

type VisualTarget = KMDInlineIR & { kind: "text" };

function toEffectConfig(command: ParsedCommand): EffectConfig {
  return {
    name: command.name,
    params: { ...(command.params || {}) },
    blocking: command.blocking,
    level: command.level,
    line: command.line,
    range: command.range,
  };
}

function toLayoutInstruction(command: ParsedCommand, lineScope?: "pre" | "post"): LayoutInstruction {
  return {
    type: command.name,
    params: { ...(command.params || {}) },
    blocking: command.blocking,
    level: command.level,
    line: command.line,
    range: command.range,
    lineScope,
  };
}

function cloneEffect(effect: EffectConfig): EffectConfig {
  return {
    ...effect,
    params: { ...(effect.params || {}) },
    range: effect.range ? { ...effect.range } : undefined,
  };
}

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

function getVisualTargets(tokens: KMDInlineIR[]): VisualTarget[] {
  return tokens.filter((token): token is VisualTarget => {
    return token.kind === "text" && token.content.trim().length > 0;
  });
}

function collectBracedGroups(targets: VisualTarget[]): Map<number, VisualTarget[]> {
  const groups = new Map<number, VisualTarget[]>();
  targets.forEach((target) => {
    if (target.braceGroupId === undefined) return;
    if (!groups.has(target.braceGroupId)) groups.set(target.braceGroupId, []);
    groups.get(target.braceGroupId)!.push(target);
  });
  return groups;
}

function applyParagraphBroadcast(targets: VisualTarget[], effects: EffectConfig[]) {
  targets.forEach((target) => {
    target.effects.push(...effects.map(cloneEffect));
  });
}

function applyLineCommands(
  lineTokens: KMDInlineIR[],
  chains: CommandChainAst[],
  paragraphEffects: EffectConfig[],
  paragraphBroadcast: EffectConfig[],
  diagnostics: ParserDiagnostic[],
) {
  // Current line-scope routing layer:
  // - f. chains are matched against brace groups / visual targets
  // - . chains are split into line-layout and line-visual broadcasts
  // - bare chains remain line-attached layout/stage instructions
  const visualTargets = getVisualTargets(lineTokens);
  const allTargets = visualTargets.length > 0 ? visualTargets : lineTokens;
  const bracedGroups = collectBracedGroups(visualTargets);
  const bracedGroupIds = Array.from(bracedGroups.keys());

  const visualQueue: EffectConfig[][] = [];
  const dotVisualEffects: EffectConfig[] = [];
  const lineLayoutInstructions: LayoutInstruction[] = [];
  const dotLineInstructions: LayoutInstruction[] = [];

  for (const chain of chains) {
    if (chain.prefix === "f") {
      visualQueue.push(chain.commands.map(toEffectConfig));
      continue;
    }

    if (chain.prefix === "dot") {
      for (const command of chain.commands) {
        const info = getCommandSemanticInfo(command.name);
        if (info.family === "layout" || info.family === "stage") {
          dotLineInstructions.push(toLayoutInstruction(command));
        } else {
          dotVisualEffects.push(toEffectConfig(command));
        }
      }
      continue;
    }

    for (const command of chain.commands) {
      lineLayoutInstructions.push(toLayoutInstruction(command));
    }
  }

  if (lineTokens.length === 0) {
    if (dotVisualEffects.length > 0) {
      paragraphBroadcast.push(...dotVisualEffects.map(cloneEffect));
      diagnostics.push({
        severity: "warning",
        message: "Line-scoped visual command without inline targets was promoted to paragraph broadcast",
        line: chains[0]?.line ?? 0,
        range: chains[0]?.range,
        code: "line-visual-promoted",
      });
    }
    lineLayoutInstructions.forEach((instruction) => {
      paragraphEffects.push({
        name: instruction.type,
        params: { ...(instruction.params || {}) },
        blocking: instruction.blocking,
        level: "block",
        line: instruction.line,
        range: instruction.range,
      });
    });
    dotLineInstructions.forEach((instruction) => {
      paragraphEffects.push({
        name: instruction.type,
        params: { ...(instruction.params || {}) },
        blocking: instruction.blocking,
        level: "block",
        line: instruction.line,
        range: instruction.range,
      });
    });
    visualQueue.forEach((chain) => paragraphBroadcast.push(...chain.map(cloneEffect)));
    return;
  }

  const primaryTarget = visualTargets.find((target) => target.isBraced) || visualTargets[0] || lineTokens[0];
  if (primaryTarget) {
    primaryTarget.layoutInstructions.push(...lineLayoutInstructions);
  }

  if (dotLineInstructions.length > 0) {
    const firstTarget = allTargets[0];
    const lastTarget = allTargets[allTargets.length - 1];
    dotLineInstructions.forEach((instruction) => {
      if (firstTarget) firstTarget.layoutInstructions.push({ ...instruction, lineScope: "pre" });
      if (lastTarget) lastTarget.layoutInstructions.push({ ...instruction, lineScope: "post" });
    });
  }

  if (dotVisualEffects.length > 0) {
    allTargets.forEach((target) => target.effects.push(...dotVisualEffects.map(cloneEffect)));
  }

  if (visualQueue.length === 0) {
    return;
  }

  if (bracedGroupIds.length > 0) {
    if (visualQueue.length === bracedGroupIds.length) {
      bracedGroupIds.forEach((groupId, idx) => {
        bracedGroups.get(groupId)?.forEach((target) => target.effects.push(...visualQueue[idx]!.map(cloneEffect)));
      });
      return;
    }

    const firstGroup = bracedGroups.get(bracedGroupIds[0]!);
    const firstChain = visualQueue.shift();
    if (firstGroup && firstChain) {
      firstGroup.forEach((target) => target.effects.push(...firstChain.map(cloneEffect)));
    }

    const lastGroup = bracedGroups.get(bracedGroupIds[bracedGroupIds.length - 1]!);
    if (lastGroup) {
      visualQueue.forEach((chain) => lastGroup.forEach((target) => target.effects.push(...chain.map(cloneEffect))));
    }
    return;
  }

  if (visualQueue.length === 1 && visualTargets.length > 0) {
    visualTargets.forEach((target) => target.effects.push(...visualQueue[0]!.map(cloneEffect)));
    return;
  }

  const firstTarget = allTargets[0];
  const firstChain = visualQueue.shift();
  if (firstTarget && firstChain) {
    firstTarget.effects.push(...firstChain.map(cloneEffect));
  }
  const lastTarget = allTargets[allTargets.length - 1];
  if (lastTarget) {
    visualQueue.forEach((chain) => lastTarget.effects.push(...chain.map(cloneEffect)));
  }
}

function applyBlockOptionCommands(
  paragraph: ParagraphAst,
  inline: KMDInlineIR[],
  blockOptions: BlockOptions,
  paragraphEffects: EffectConfig[],
  diagnostics: ParserDiagnostic[],
) {
  // Current paragraph-scope routing layer:
  // block options become either paragraph effects (layout/stage or explicit :block)
  // or paragraph-wide visual broadcasts that preserve per-target default behavior.
  const paragraphBroadcast: EffectConfig[] = [];

  paragraph.blockOptions.forEach((entry) => {
    if (entry.type === "block-option-value") {
      (blockOptions as any)[entry.key] = entry.value;
      return;
    }

    entry.chain.commands.forEach((command) => {
      const info = getCommandSemanticInfo(command.name);
      const effect = toEffectConfig(command);
      if (info.family === "layout" || info.family === "stage") {
        paragraphEffects.push({ ...effect, level: "block" });
        return;
      }

      if (command.level === "block") {
        if (!info.containerCompatible) {
          diagnostics.push({
            severity: "warning",
            message: `Command "${command.name}" is char-only but was forced to :block`,
            line: command.line ?? entry.line,
            range: command.range,
            code: "container-incompatible",
          });
        }
        paragraphEffects.push({ ...effect, level: "block" });
        return;
      }

      paragraphBroadcast.push(effect);
    });
  });

  applyParagraphBroadcast(getVisualTargets(inline), paragraphBroadcast);
}

function lowerAstToIr(ast: ParagraphAst, diagnostics: ParserDiagnostic[]): ParagraphIR {
  const inline = buildInlineFromAst(ast, diagnostics);
  const paragraphEffects: EffectConfig[] = [];
  const paragraphBroadcast: EffectConfig[] = [];
  const blockOptions: BlockOptions = {};

  applyBlockOptionCommands(ast, inline, blockOptions, paragraphEffects, diagnostics);

  ast.lines.forEach((line) => {
    const lineTokens = inline.filter((token) => token.line === line.line && token.kind !== "newline");
    if (line.commandChains.length > 0) {
      applyLineCommands(lineTokens, line.commandChains, paragraphEffects, paragraphBroadcast, diagnostics);
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

function inlineToLegacyToken(token: KMDInlineIR): KMDToken {
  return {
    content: token.content,
    effects: token.effects.map(cloneEffect),
    commands: [...token.commands],
    params: { ...(token.params || {}) },
    layoutInstructions: token.layoutInstructions.map((instruction) => ({
      ...instruction,
      params: { ...(instruction.params || {}) },
      range: instruction.range ? { ...instruction.range } : undefined,
    })),
    isSceneClear: token.isSceneClear,
    isSugar: token.isSugar,
    isPipe: token.isPipe,
    isBraced: token.isBraced,
    braceGroupId: token.braceGroupId,
    range: token.range ? { ...token.range } : undefined,
    line: token.line,
    sugar: token.sugar.map((entry) => ({
      ...entry,
      params: { ...(entry.params || {}) },
    })),
  };
}

export function buildParagraphData(
  ast: ParagraphAst,
  diagnostics: ParserDiagnostic[],
  irTransforms: ParserIrTransform[] = [],
): KMDParagraphData {
  const baseIr = lowerAstToIr(ast, diagnostics);
  const ir = irTransforms.length > 0 ? applyIrTransforms(baseIr, irTransforms, diagnostics) : baseIr;
  return {
    blockOptions: ir.blockOptions,
    tokens: ir.inline.map(inlineToLegacyToken),
    globalEffects: ir.paragraphEffects.map(cloneEffect),
    lineOffset: ast.lineOffset,
    ast,
    ir,
    diagnostics: [...diagnostics],
  };
}
