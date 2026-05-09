import { TextStyle } from "pixi.js";
import type { ParagraphIR } from "../parser/types";
import { LayoutPlanner } from "./LayoutPlanner";
import { DisplayAssembler } from "../render/text/DisplayAssembler";

export class LayoutStreamBuilder {
  /**
   * Compat facade during Phase 5.
   * Pure layout planning now lives in LayoutPlanner; display object materialization now
   * lives in DisplayAssembler. This façade remains for callers that still expect a
   * legacy charData/LayoutStream bundle from the old single builder entrypoint.
   */
  public static build(
    paragraph: ParagraphIR,
    baseStyle: TextStyle,
  ) {
    return DisplayAssembler.materializePlan(LayoutPlanner.plan(paragraph, baseStyle));
  }
}
