import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import type { KineticChar } from "../KineticChar";
import type { TokenWrapper } from "../TokenWrapper";
import type { EffectConfig } from "../parser/types";
import type { BaseCue, ChainExecutionPlan, DiagnosticEvent, LifecycleAnchor, SourceOrigin } from "../types";

export interface ParagraphExecutionLifecycle {
  isParagraphStart: boolean;
  isParagraphEnd: boolean;
  isTokenStart: boolean;
  isTokenEnd: boolean;
  isLineBreak: boolean;
}

export interface ParagraphExecutionTokenPlan {
  tokenIdx: number;
  token: TokenWrapper;
  firstItemIndex: number;
  lastItemIndex: number;
  sourceOrigin?: SourceOrigin;
  visualEffects: EffectConfig[];
  tokenEndStageInstructions: any[];
  pauseCharOverride?: number;
  chainPlan?: ChainExecutionPlan;
  cues: BaseCue[];
}

function createSourceOrigin(char: KineticChar, tokenIdx: number, charIndex?: number): SourceOrigin | undefined {
  if (char.line === undefined && tokenIdx < 0 && charIndex === undefined) return undefined;
  return {
    line: char.line,
    tokenIndex: tokenIdx >= 0 ? tokenIdx : undefined,
    charIndex,
  };
}

function inferEffectCueFamily(config: EffectConfig): BaseCue["family"] {
  if (config.name === "hold" || config.name === "pause") return "playback";
  if (styleManager.has(config.name) || effectManager.has(config.name)) return "effect";
  return "effect";
}

export function toChainStep(config: EffectConfig, tokenIdx: number, line?: number): BaseCue {
  return {
    family: inferEffectCueFamily(config),
    kind: config.name,
    origin: "lowered",
    anchor: "token_end",
    blocking: config.blocking,
    target: { kind: "token", tokenIndex: tokenIdx },
    sourceOrigin: {
      line,
      tokenIndex: tokenIdx,
    },
    payload: {
      level: config.level,
      params: { ...(config.params || {}) },
    },
  };
}

export function inferChainMode(effects: EffectConfig[]): ChainExecutionPlan["mode"] {
  if (effects.some((effect) => effect.name === "hold" && effect.level === "char")) {
    return "char_stagger";
  }
  if (effects.some((effect) => effect.level === "group" || effect.level === "block" || effect.level === "bg")) {
    return "container_only";
  }
  return "group_sync";
}

export function resolvePauseCharOverride(effects: EffectConfig[], stageInstructions: any[]): number | undefined {
  const pauseCharInStage = stageInstructions.find(
    (instruction) => instruction?.type === "pause" && instruction?.level === "char",
  );
  const pauseCharInVisual = effects.find(
    (effect) => effect.name === "pause" && effect.level === "char",
  );
  const pauseCharEffect = pauseCharInStage || pauseCharInVisual;
  if (!pauseCharEffect) return undefined;
  return Number(
    pauseCharEffect.params?.duration ??
    pauseCharEffect.params?.d ??
    pauseCharEffect.params?.[0] ??
    1,
  );
}

function createGeneratedLifecycleCue(
  kind: LifecycleAnchor,
  tokenIdx: number,
  sourceOrigin?: SourceOrigin,
): BaseCue {
  return {
    family: "lifecycle",
    kind,
    origin: "generated",
    anchor: kind,
    target: tokenIdx >= 0 ? { kind: "token", tokenIndex: tokenIdx } : undefined,
    sourceOrigin,
  };
}

function createLoweredStageCue(
  instruction: any,
  tokenIdx: number,
  sourceOrigin?: SourceOrigin,
): BaseCue {
  return {
    family: "stage",
    kind: instruction.type,
    origin: "lowered",
    anchor: "token_end",
    target: tokenIdx >= 0 ? { kind: "token", tokenIndex: tokenIdx } : { kind: "paragraph" },
    blocking: instruction.blocking,
    sourceOrigin,
    payload: {
      level: instruction.level,
      params: { ...(instruction.params || {}) },
    },
  };
}

function createLoweredPlaybackCue(
  name: string,
  params: Record<string, any>,
  tokenIdx: number,
  sourceOrigin?: SourceOrigin,
): BaseCue {
  return {
    family: "playback",
    kind: name,
    origin: "lowered",
    anchor: "token_start",
    target: tokenIdx >= 0 ? { kind: "token", tokenIndex: tokenIdx } : undefined,
    sourceOrigin,
    payload: { params: { ...params } },
  };
}

export function createItemLifecycle(
  index: number,
  itemsLength: number,
  isTokenStart: boolean,
  isTokenEnd: boolean,
  isLineBreak: boolean,
): ParagraphExecutionLifecycle {
  return {
    isParagraphStart: index === 0,
    isParagraphEnd: index === itemsLength - 1,
    isTokenStart,
    isTokenEnd,
    isLineBreak,
  };
}

export function collectItemCues(
  lifecycle: ParagraphExecutionLifecycle,
  tokenIdx: number,
  line?: number,
  timingSugars: Array<{ name: string; params: Record<string, any>; level: string }> = [],
  stageInstructions: any[] = [],
): BaseCue[] {
  const origin: SourceOrigin | undefined = {
    line,
    tokenIndex: tokenIdx >= 0 ? tokenIdx : undefined,
  };
  const cues: BaseCue[] = [];

  if (lifecycle.isParagraphStart) cues.push(createGeneratedLifecycleCue("paragraph_start", tokenIdx, origin));
  if (lifecycle.isParagraphEnd) cues.push(createGeneratedLifecycleCue("paragraph_end", tokenIdx, origin));
  if (lifecycle.isTokenStart) cues.push(createGeneratedLifecycleCue("token_start", tokenIdx, origin));
  if (lifecycle.isTokenEnd) cues.push(createGeneratedLifecycleCue("token_end", tokenIdx, origin));
  if (lifecycle.isLineBreak) cues.push(createGeneratedLifecycleCue("line_break", tokenIdx, origin));

  for (const sugar of timingSugars) {
    cues.push(createLoweredPlaybackCue(sugar.name, sugar.params || {}, tokenIdx, origin));
  }

  for (const instruction of stageInstructions) {
    cues.push(createLoweredStageCue(instruction, tokenIdx, origin));
  }

  return cues;
}

export function buildTokenPlan(
  token: TokenWrapper,
  items: Array<{
    char: KineticChar;
    tokenIdx: number;
    isNewLine: boolean;
    visualEffects: EffectConfig[];
    timingSugars: Array<{ name: string; params: Record<string, any>; level: string }>;
    stageInstructions: any[];
    cues: BaseCue[];
    lifecycle: ParagraphExecutionLifecycle;
  }>,
  diagnostics: DiagnosticEvent[],
): ParagraphExecutionTokenPlan {
  const firstItemIndex = items.findIndex((item) => item.tokenIdx === token.tokenIdx);
  const lastItemIndex = [...items].reverse().findIndex((item) => item.tokenIdx === token.tokenIdx);
  const resolvedLastItemIndex = lastItemIndex === -1 ? -1 : items.length - 1 - lastItemIndex;
  const tokenItems = items.filter((item) => item.tokenIdx === token.tokenIdx);
  const lastVisualItem = [...tokenItems].reverse().find((item) => item.visualEffects.length > 0);
  const visualEffects = [...(lastVisualItem?.visualEffects || [])];

  const tokenEndStageInstructions = tokenItems
    .filter((item) => !item.isNewLine && item.char.text.trim())
    .flatMap((item) => item.stageInstructions.filter((instruction) => instruction?.type !== "pause"));

  const pauseCharOverride = resolvePauseCharOverride(
    visualEffects,
    tokenItems.flatMap((item) => item.stageInstructions),
  );
  const hasHoldCharEffect = visualEffects.some(
    (effect) => effect.name === "hold" && effect.level === "char",
  );

  let chainPlan: ChainExecutionPlan | undefined;
  if (visualEffects.length > 0) {
    const sourceLine = lastVisualItem?.char.line;
    chainPlan = {
      id: `token-${token.tokenIdx}`,
      mode: inferChainMode(visualEffects),
      anchor: "token_end",
      target: { kind: "token", tokenIndex: token.tokenIdx },
      steps: visualEffects.map((effect) => toChainStep(effect, token.tokenIdx, sourceLine)),
      sourceOrigin: sourceLine !== undefined ? { line: sourceLine, tokenIndex: token.tokenIdx } : undefined,
    };
  }

  if (hasHoldCharEffect && (!chainPlan || chainPlan.mode !== "char_stagger")) {
    diagnostics.push({
      severity: "warning",
      code: "execution.missing_char_stagger_plan",
      subsystem: "execution",
      message: `Token ${token.tokenIdx} contains hold:char timing but did not resolve to char_stagger plan.`,
      origin: tokenItems[0]
        ? createSourceOrigin(tokenItems[0].char, token.tokenIdx)
        : { tokenIndex: token.tokenIdx },
    });
  }

  const cues = tokenItems.flatMap((item) => item.cues);

  return {
    tokenIdx: token.tokenIdx,
    token,
    firstItemIndex,
    lastItemIndex: resolvedLastItemIndex,
    sourceOrigin: tokenItems[0] ? createSourceOrigin(tokenItems[0].char, token.tokenIdx) : undefined,
    visualEffects,
    tokenEndStageInstructions,
    pauseCharOverride,
    chainPlan,
    cues,
  };
}
