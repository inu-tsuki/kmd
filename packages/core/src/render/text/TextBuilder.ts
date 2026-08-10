import { TextStyle } from "pixi.js";
import { parser } from "../../parser/Parser";
import { LayoutPlanner } from "../../layout/LayoutPlanner";
import { TextLayoutEngine } from "../../layout/TextLayoutEngine";
import type { KMDParagraphData } from "../../parser/types";
import { CompatBinder } from "./CompatBinder";
import { DisplayAssembler } from "./DisplayAssembler";
import type {
  ParagraphWithIr,
  TextBuildContextFactory,
  ParagraphBuildInput,
  PositionedLegacyLayoutResult,
  TextBuildTarget,
} from "./types";

export class TextBuilder {
  public static async build(
    target: TextBuildTarget,
    kmdString: string,
    startLine: number = 0,
    buildContextFactory: TextBuildContextFactory,
  ) {
    const paragraph = parser.parseParagraph(kmdString, startLine) as KMDParagraphData;
    return this.buildFromParagraph(target, {
      paragraph,
      sourceKMD: kmdString,
    }, buildContextFactory);
  }

  public static async buildFromParagraph(
    target: TextBuildTarget,
    input: ParagraphBuildInput,
    buildContextFactory: TextBuildContextFactory,
  ) {
    const paragraph = this.resolveParagraphInput(input);
    return this.buildResolvedParagraph(target, paragraph, buildContextFactory);
  }

  private static async buildResolvedParagraph(
    target: TextBuildTarget,
    paragraph: ParagraphWithIr,
    buildContextFactory: TextBuildContextFactory,
  ) {
    const { ir } = paragraph;
    CompatBinder.bindParagraphTarget(target, paragraph);
    const buildContext = buildContextFactory(target);
    const layoutPlan = LayoutPlanner.plan(ir!, buildContext.baseStyle.clone() as TextStyle);
    const { stream: layoutStream } = DisplayAssembler.materializePlan(layoutPlan);
    const layoutResults = TextLayoutEngine.calculate(
      layoutStream,
      buildContext.layoutOptions,
    );
    const assembly = DisplayAssembler.assembleLayoutResults(
      target,
      layoutResults as PositionedLegacyLayoutResult[],
    );
    CompatBinder.bindTargetCollections(target, assembly);
  }

  private static resolveParagraphInput(input: ParagraphBuildInput): ParagraphWithIr {
    if (input.paragraph.ir) return input.paragraph as ParagraphWithIr;
    if (!input.sourceKMD) {
      throw new Error(
        `TextBuilder received paragraph input without IR or sourceKMD (lineOffset=${input.paragraph.lineOffset ?? 0}).`,
      );
    }

    const reparsed = parser.parseParagraph(
      input.sourceKMD,
      input.paragraph.lineOffset ?? 0,
    ) as KMDParagraphData;

    if (!reparsed.ir) {
      throw new Error(
        `TextBuilder requires paragraph IR before layout planning (lineOffset=${input.paragraph.lineOffset ?? 0}).`,
      );
    }

    return reparsed as ParagraphWithIr;
  }
}
