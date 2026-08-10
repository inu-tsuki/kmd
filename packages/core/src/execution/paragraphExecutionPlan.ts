import type { EffectConfig } from "../parser/types";
import { TokenWrapper } from "../TokenWrapper";
import { KineticChar } from "../KineticChar";
import type { ParagraphDisplayAssembly } from "../render/text/types";
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
  assembly: Pick<ParagraphDisplayAssembly, "tokens" | "executionItems">,
): RuntimeParagraphExecutionPlan {
  const diagnostics: DiagnosticEvent[] = [];
  const sourceItems = assembly.executionItems;
  const tokens = assembly.tokens;

  const items: ParagraphExecutionItem[] = sourceItems.map((sourceItem, index) => {
    const { char, tokenIdx, line, isNewLine } = sourceItem;
    const prevItem = sourceItems[index - 1];
    const nextItem = sourceItems[index + 1];
    const isTokenStart = !isNewLine && (index === 0 || !prevItem || prevItem.tokenIdx !== tokenIdx);
    const isTokenEnd = !isNewLine && (!nextItem || nextItem.tokenIdx !== tokenIdx);
    const lifecycle = createItemLifecycle(index, sourceItems.length, isTokenStart, isTokenEnd, isNewLine);

    const item: ParagraphExecutionItem = {
      char,
      tokenIdx,
      line,
      isNewLine,
      visualEffects: [...sourceItem.visualEffects],
      timingSugars: [...sourceItem.timingSugars],
      stageInstructions: [...sourceItem.stageInstructions],
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
