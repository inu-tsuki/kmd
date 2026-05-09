import { TextStyle } from "pixi.js";
import { useEditorStore } from "../../../store/editorStore";
import type { TextBuildContext, TextBuildTarget } from "./types";

export class TextBuildContextResolver {
  /**
   * Phase 5 adapter seam:
   * UI/store-derived typography and host-derived layout options are resolved here,
   * so TextBuilder can stay focused on paragraph build orchestration.
   */
  public static fromTarget(target: TextBuildTarget): TextBuildContext {
    const store = useEditorStore();

    return {
      baseStyle: new TextStyle({
        fontSize: target._options.fontSize,
        fill: store.canvasConfig.fontColor,
        fontFamily: store.canvasConfig.fontFamily,
        padding: 0,
      }),
      layoutOptions: {
        maxWidth: target._options.maxWidth,
        lineHeight: target._options.lineHeight,
        fontSize: target._options.fontSize,
        indent: target._options.indent,
        align: target._options.align,
        letterSpacing: target._options.letterSpacing,
        externalMarkers: target._options.externalMarkers,
        baseOffset: { x: target.x, y: target.y },
      },
    };
  }
}
