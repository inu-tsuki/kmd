import { getCommandSemanticInfo, runtimeCommandRegistryView, type CommandRegistryView } from "./commandCatalog";
import type {
  BlockOptions,
  CommandChainAst,
  EffectConfig,
  KMDInlineIR,
  LayoutInstruction,
  ParagraphAst,
  ParsedCommand,
  ParserDiagnostic,
} from "./types";

type VisualTarget = KMDInlineIR & { kind: "text" };

export function toEffectConfig(command: ParsedCommand): EffectConfig {
  return {
    name: command.name,
    params: { ...(command.params || {}) },
    blocking: command.blocking,
    level: command.level,
    line: command.line,
    range: command.range,
  };
}

export function toLayoutInstruction(command: ParsedCommand, lineScope?: "pre" | "post"): LayoutInstruction {
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

export function cloneEffect(effect: EffectConfig): EffectConfig {
  return {
    ...effect,
    params: { ...(effect.params || {}) },
    range: effect.range ? { ...effect.range } : undefined,
  };
}

export function getVisualTargets(tokens: KMDInlineIR[]): VisualTarget[] {
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

export function applyParagraphBroadcast(targets: VisualTarget[], effects: EffectConfig[]) {
  targets.forEach((target) => {
    target.effects.push(...effects.map(cloneEffect));
  });
}

export function applyLineCommands(
  lineTokens: KMDInlineIR[],
  chains: CommandChainAst[],
  paragraphEffects: EffectConfig[],
  paragraphBroadcast: EffectConfig[],
  diagnostics: ParserDiagnostic[],
  registryView: CommandRegistryView = runtimeCommandRegistryView,
) {
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
        const info = getCommandSemanticInfo(command.name, registryView);
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

  if (visualQueue.length === 0) return;

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

export function applyBlockOptionCommands(
  paragraph: ParagraphAst,
  inline: KMDInlineIR[],
  blockOptions: BlockOptions,
  paragraphEffects: EffectConfig[],
  diagnostics: ParserDiagnostic[],
  registryView: CommandRegistryView = runtimeCommandRegistryView,
) {
  const paragraphBroadcast: EffectConfig[] = [];

  paragraph.blockOptions.forEach((entry) => {
    if (entry.type === "block-option-value") {
      (blockOptions as any)[entry.key] = entry.value;
      return;
    }

    entry.chain.commands.forEach((command) => {
      const info = getCommandSemanticInfo(command.name, registryView);
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
