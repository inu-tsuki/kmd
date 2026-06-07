import { TextStyle } from "pixi.js";
import type { ReaderRuntimeTypography } from "../../runtime";
import type { TextBuildContext, TextBuildTarget } from "./types";

export class TextBuildContextResolver {
  private static typography: ReaderRuntimeTypography = {};

  public static configure(options: { typography?: ReaderRuntimeTypography }) {
    if (options.typography) {
      TextBuildContextResolver.typography = {
        ...TextBuildContextResolver.typography,
        ...options.typography,
      };
    }
  }

  /**
   * Phase R adapter seam:
   * Host-provided typography and layout options are resolved here,
   * so TextBuilder can stay focused on paragraph build orchestration.
   */
  public static fromTarget(target: TextBuildTarget): TextBuildContext {
    const typography = TextBuildContextResolver.typography;

    return {
      baseStyle: new TextStyle({
        fontSize: typography.fontSize ?? target._options.fontSize,
        fill: typography.fill ?? "#ffffff",
        fontFamily: typography.fontFamily ?? "Sasara Regular",
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
