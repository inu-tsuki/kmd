import { TextStyle } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import { TokenWrapper } from "../../TokenWrapper";
import { CompatBinder } from "./CompatBinder";
import type {
  AssembledDisplayResult,
  LayoutGlyphPlan,
  LayoutPlanResult,
  LegacyCharData,
  MaterializedLayoutAssembly,
  PositionedLegacyLayoutResult,
  TextExecutionItemPayload,
  TextBuildTarget,
} from "./types";

export class DisplayAssembler {
  public static materializePlan(plan: LayoutPlanResult): MaterializedLayoutAssembly {
    const allCharsData: LegacyCharData[] = [];
    const stream = plan.stream.map((node) => {
      if (node.isCommand) return node;

      const charData = this.materializeGlyphPlan(node.glyphPlan);
      allCharsData.push(charData);
      return {
        isCommand: false as const,
        width: node.width,
        height: node.height,
        charData,
      };
    });

    return { stream, allCharsData };
  }

  public static assembleLayoutResults(
    target: TextBuildTarget,
    layoutResults: PositionedLegacyLayoutResult[],
  ): AssembledDisplayResult {
    let currentWrapper: TokenWrapper | null = null;
    let currentTokenIdx = -1;
    let currentLineY = -1;

    const newTokens: TokenWrapper[] = [];
    const chars: KineticChar[] = [];
    const executionItems: TextExecutionItemPayload[] = [];

    layoutResults.forEach((positioned) => {
      const {
        y,
        item: data,
      } = positioned;
      const {
        char,
        tokenIdx,
      } = data.charData;
      const isNewLine = Math.abs(y - currentLineY) > 1;

      if (!char) {
        const dummy = new KineticChar("", new TextStyle({ padding: 0 }));
        CompatBinder.bindPositionedChar(dummy, positioned, {
          ...data.charData,
          char: dummy,
        });
        const wrapper = new TokenWrapper();
        wrapper.addChild(dummy);
        wrapper.chars.push(dummy);
        wrapper.tokenIdx = tokenIdx;
        newTokens.push(wrapper);
        target.addChild(wrapper);
        chars.push(dummy);
        executionItems.push(this.createExecutionItemPayload(dummy, data.charData));
        return;
      }

      CompatBinder.bindPositionedChar(char, positioned, data.charData);
      chars.push(char);
      executionItems.push(this.createExecutionItemPayload(char, data.charData));

      if (tokenIdx !== currentTokenIdx || isNewLine) {
        currentWrapper = new TokenWrapper();
        currentWrapper.tokenIdx = tokenIdx;
        currentTokenIdx = tokenIdx;
        currentLineY = y;
        newTokens.push(currentWrapper);
        target.addChild(currentWrapper);
      }

      currentWrapper!.addChild(char);
      currentWrapper!.chars.push(char);
    });

    return { tokens: newTokens, chars, executionItems };
  }

  private static materializeGlyphPlan(glyphPlan: LayoutGlyphPlan): LegacyCharData {
    if (glyphPlan.kind === "instruction-carrier") {
      return {
        char: null,
        effects: glyphPlan.effects,
        timingSugars: glyphPlan.timingSugars,
        tokenIdx: glyphPlan.tokenIdx,
        charIdx: glyphPlan.charIdx,
        width: glyphPlan.width,
        height: glyphPlan.height,
        ascent: glyphPlan.ascent,
        descent: glyphPlan.descent,
        stageInstructions: glyphPlan.stageInstructions,
        line: glyphPlan.line,
      };
    }

    const char = new KineticChar(glyphPlan.text, glyphPlan.style);
    Object.assign((char as any).baseStyleSnapshot, glyphPlan.baseStyleSnapshot);
    if (glyphPlan.text === "\n") char.isNewLine = true;

    return {
      char,
      effects: glyphPlan.effects,
      timingSugars: glyphPlan.timingSugars,
      tokenIdx: glyphPlan.tokenIdx,
      charIdx: glyphPlan.charIdx,
      width: glyphPlan.width,
      height: glyphPlan.height,
      ascent: glyphPlan.ascent,
      descent: glyphPlan.descent,
      stageInstructions: glyphPlan.stageInstructions,
      line: glyphPlan.line,
    };
  }

  private static createExecutionItemPayload(
    char: KineticChar,
    charData: LegacyCharData,
  ): TextExecutionItemPayload {
    return {
      char,
      tokenIdx: charData.tokenIdx,
      line: charData.line,
      isNewLine: char.isNewLine || char.text === "\n",
      visualEffects: [...(charData.effects || [])],
      timingSugars: [...(charData.timingSugars || [])],
      stageInstructions: [...(charData.stageInstructions || [])],
    };
  }
}
