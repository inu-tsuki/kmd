import type { KMDParagraphData } from "../../parser/types";
import type { KineticChar } from "../../KineticChar";
import type {
    LegacyCharData,
    ParagraphDisplayAssembly,
    PositionedLegacyLayoutResult,
    TextBuildTarget,
} from "./types";

export class CompatBinder {
  public static bindParagraphTarget(target: TextBuildTarget, paragraph: KMDParagraphData) {
    target._pendingGlobalEffects = paragraph.globalEffects as any[];
    Object.assign(target._options, paragraph.blockOptions);
  }

  public static bindPositionedChar(
    char: KineticChar,
    positioned: PositionedLegacyLayoutResult,
    charData: LegacyCharData,
  ) {
    const {
      x,
      y,
      inFlow,
      displayOffsetX,
      displayOffsetY,
    } = positioned;
    const {
      effects,
      stageInstructions,
      timingSugars,
      tokenIdx,
      ascent,
      height,
      line,
    } = charData;

    char.layoutX = x;
    char.layoutY = y;
    char.inFlow = inFlow;
    if (!char.text) char.inFlow = false;

    if (displayOffsetX || displayOffsetY) {
      char.displayOffset = {
        x: displayOffsetX || 0,
        y: displayOffsetY || 0,
      };
    }

    char.line = line;
    if (height > 0) char.anchor.y = ascent / height;
    // Legacy compat mirror only. Core execution paths should consume target._executionItems instead.
    char.stageInstructions = stageInstructions || [];
    char.visualEffects = effects || [];
    char.timingSugars = timingSugars || [];
    char.tokenIdx = tokenIdx;
    char.visible = false;
  }

  public static bindTargetCollections(
    target: TextBuildTarget,
    assembly: ParagraphDisplayAssembly,
  ) {
    target._displayAssembly = assembly;
    target.tokens = assembly.tokens;
    target._executionItems = assembly.executionItems;
    target._allCharsCached = assembly.chars;
  }
}
