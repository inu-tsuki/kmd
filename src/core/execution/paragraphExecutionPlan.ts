import type { EffectConfig } from "../parser/types";
import { TokenWrapper } from "../TokenWrapper";
import { KineticChar } from "../KineticChar";
import type { BaseCue, DiagnosticEvent, ParagraphExecutionPlan } from "../types";
import {
  buildTokenPlan,
  collectItemCues,
  createItemLifecycle,
  type ParagraphExecutionLifecycle,
  type ParagraphExecutionTokenPlan,
} from "./chainPlanning";

export interface ParagraphExecutionItem {
  char: KineticChar;
  tokenIdx: number;
  line?: number;
  isNewLine: boolean;
  visualEffects: EffectConfig[];
  timingSugars: Array<{ name: string; params: Record<string, any>; level: string }>;
  stageInstructions: any[];
  lifecycle: ParagraphExecutionLifecycle;
  cues: BaseCue[];
}

export interface RuntimeParagraphExecutionPlan
  extends ParagraphExecutionPlan<ParagraphExecutionItem, TokenWrapper> {
  tokenPlans: ParagraphExecutionTokenPlan[];
  diagnostics: DiagnosticEvent[];
}

export function createParagraphExecutionPlan(
  allChars: KineticChar[],
  tokens: TokenWrapper[],
): RuntimeParagraphExecutionPlan {
  const diagnostics: DiagnosticEvent[] = [];

  const items: ParagraphExecutionItem[] = allChars.map((char, index) => {
    const tokenIdx = char.tokenIdx;
    const isNewLine = char.isNewLine || char.text === "\n";
    const prevChar = allChars[index - 1];
    const nextChar = allChars[index + 1];
    const isTokenStart = !isNewLine && (index === 0 || !prevChar || prevChar.tokenIdx !== tokenIdx);
    const isTokenEnd = !isNewLine && (!nextChar || nextChar.tokenIdx !== tokenIdx);
    const lifecycle = createItemLifecycle(index, allChars.length, isTokenStart, isTokenEnd, isNewLine);

    const item: ParagraphExecutionItem = {
      char,
      tokenIdx,
      line: char.line,
      isNewLine,
      visualEffects: [...(char.visualEffects || [])],
      timingSugars: [...(char.timingSugars || [])],
      stageInstructions: [...(char.stageInstructions || [])],
      lifecycle,
      cues: [],
    };

    item.cues = collectItemCues(
      lifecycle,
      tokenIdx,
      item.line,
      item.timingSugars,
      item.stageInstructions,
    );

    return item;
  });

  const tokenPlans = tokens.map((token) => buildTokenPlan(token, items, diagnostics));
  const chainPlans = tokenPlans.flatMap((plan) => (plan.chainPlan ? [plan.chainPlan] : []));

  return {
    items,
    tokens,
    chainPlans,
    tokenPlans,
    diagnostics,
  };
}
