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
    // R15/SA-30：baseStyleSnapshot 必须等于构建期烘焙后的真实起始态，而非原始 base。
    // glyphPlan.style（= measurementStyle）已含 pre-hold 初始样式（LayoutPlanner:88
    // applyInitialStylesToStyle 烘焙）。KineticChar 构造时已用 glyphPlan.style 初始化
    // baseStyleSnapshot（KineticChar 构造函数从 style 字段捕获），但此处旧代码又用
    // glyphPlan.baseStyleSnapshot（LayoutPlanner:70 在 applyInitialStylesToStyle 之前捕获的原始 base）
    // 覆盖回 raw base → resetStyle() 会清回原始 base 而丢失 pre-hold 烘焙样式。
    // 修复：不再用 glyphPlan.baseStyleSnapshot 覆盖——保留 KineticChar 构造时从 glyphPlan.style
    // 捕获的快照（= pre-hold 烘焙态）。glyphPlan.baseStyleSnapshot 字段保留不删（避免改
    // LayoutPlanner 类型 + 多分支涟漪），仅在此处停止用作 reset baseline。
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
