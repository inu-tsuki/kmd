import { TextStyle } from "pixi.js";
import { parser } from "../../parser/Parser";
import { LayoutStreamBuilder } from "../../layout/LayoutStreamBuilder";
import { TextLayoutEngine } from "../../layout/TextLayoutEngine";
import { TokenWrapper } from "../../TokenWrapper";
import { KineticChar } from "../../KineticChar";
import { useEditorStore } from "../../../store/editorStore";
import type { KMDParagraphData } from "../../parser/types";

export class TextBuilder {
  public static async build(target: any, kmdString: string, startLine: number = 0) {
    const paragraph = parser.parseParagraph(kmdString, startLine) as KMDParagraphData;
    const { blockOptions, globalEffects, ir } = paragraph;
    target._pendingGlobalEffects = globalEffects as any[];
    Object.assign(target._options, blockOptions);

    const store = useEditorStore();
    const baseStyle = new TextStyle({ 
        fontSize: target._options.fontSize, 
        fill: store.canvasConfig.fontColor,
        fontFamily: store.canvasConfig.fontFamily,
        padding: 0
    });

    const { stream: layoutStream } = LayoutStreamBuilder.build(ir!, baseStyle);
    const layoutResults = TextLayoutEngine.calculate(layoutStream, {
      ...target._options,
      baseOffset: { x: target.x, y: target.y }
    });

    let currentWrapper: TokenWrapper | null = null;
    let currentTokenIdx = -1;
    let currentLineY = -1;

    const newTokens: TokenWrapper[] = [];

    layoutResults.forEach(({ item: data, x, y, inFlow, displayOffsetX, displayOffsetY }) => {
      const { char, effects, tokenIdx, stageInstructions, timingSugars, ascent, height, line } = data.charData;
      const isNewLine = Math.abs(y - currentLineY) > 1;

      if (!char) {
        const dummy = new KineticChar("", new TextStyle({ padding: 0 }));
        dummy.visible = false;
        dummy.layoutX = x; dummy.layoutY = y; dummy.inFlow = false;
        dummy.stageInstructions = stageInstructions || [];
        dummy.visualEffects = effects || [];
        dummy.timingSugars = timingSugars || [];
        dummy.tokenIdx = tokenIdx;
        dummy.line = line;
        const wrapper = new TokenWrapper();
        wrapper.addChild(dummy); wrapper.chars.push(dummy); wrapper.tokenIdx = tokenIdx;
        newTokens.push(wrapper); target.addChild(wrapper);
        return;
      }

      char.layoutX = x;
      char.layoutY = y;
      char.inFlow = inFlow;
      if (!char.text) char.inFlow = false;  // Sugar/空字符不参与高度计算
      if (displayOffsetX || displayOffsetY) {
        char.displayOffset = { x: displayOffsetX || 0, y: displayOffsetY || 0 };
      }
      char.line = line;
      if (height > 0) char.anchor.y = ascent / height;

      char.stageInstructions = stageInstructions || [];
      char.visualEffects = effects || [];
      char.timingSugars = timingSugars || [];
      char.tokenIdx = tokenIdx;
      char.visible = false;

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

    target.tokens = newTokens;
    target._allCharsCached = newTokens.flatMap(t => t.chars);
  }
}
