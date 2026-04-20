import type { KMDInlineIR, KMDParagraphData, KMDToken, ParagraphAst, ParagraphIR, ParserDiagnostic } from "./types";
import { cloneEffect } from "./ScopeRouter";

export function inlineToLegacyToken(token: KMDInlineIR): KMDToken {
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

export function projectParagraphToLegacyData(
  ast: ParagraphAst,
  ir: ParagraphIR,
  diagnostics: ParserDiagnostic[],
): KMDParagraphData {
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
