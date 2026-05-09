import { CanvasTextMetrics, TextStyle } from "pixi.js";
import type {
  CommandLevel,
  EffectConfig,
  KMDInlineIR,
  ParagraphIR,
} from "../parser/types";
import type { LayoutCommand } from "./types";
import { EffectProcessor } from "../effects/EffectProcessor";
import { layoutManager } from "./LayoutManager";
import { stageManager } from "../stage/StageManager";
import { layout } from "./LayoutEngine";

export interface PlannedStageInstruction {
  type: string;
  params: Record<string, any>;
  blocking?: boolean;
  level?: CommandLevel;
}

export interface PlannedTimingSugar {
  name: string;
  params: Record<string, any>;
  level: CommandLevel;
}

export interface LayoutGlyphPlan {
  kind: "char" | "timing-carrier" | "instruction-carrier";
  text: string;
  style: TextStyle;
  baseStyleSnapshot: Record<string, any>;
  effects: EffectConfig[];
  timingSugars: PlannedTimingSugar[];
  tokenIdx: number;
  charIdx: number;
  width: number;
  height: number;
  ascent: number;
  descent: number;
  stageInstructions: PlannedStageInstruction[];
  line?: number;
}

export interface PlannedLayoutItem {
  isCommand?: false;
  width: number;
  height: number;
  glyphPlan: LayoutGlyphPlan;
}

export type PlannedLayoutStream = Array<LayoutCommand | PlannedLayoutItem>;

export interface LayoutPlanResult {
  stream: PlannedLayoutStream;
  allGlyphPlans: LayoutGlyphPlan[];
}

type MeasuredChar = {
  text: string;
  width: number;
  ascent: number;
  descent: number;
};

export class LayoutPlanner {
  public static plan(paragraph: ParagraphIR, baseStyle: TextStyle): LayoutPlanResult {
    const stream: PlannedLayoutStream = [];
    const allGlyphPlans: LayoutGlyphPlan[] = [];
    const tokens = paragraph.inline as KMDInlineIR[];
    const baseStyleSnapshot = this.createBaseStyleSnapshot(baseStyle);

    const { layoutCmds: globalLayouts } = EffectProcessor.partition(paragraph.paragraphEffects);
    globalLayouts.forEach((cmd) => stream.push(cmd));

    tokens.forEach((token, tokenIdx) => {
      const {
        layoutCmds: effectLayouts,
        visualConfigs,
        stageConfigs: effectStageConfigs,
      } = EffectProcessor.partition(token.effects);
      const allRawInstructions = [
        ...token.layoutInstructions,
        ...effectLayouts.map((cmd) => ({ type: cmd.type as string, params: cmd.params })),
      ];

      const finalContent = this.resolveTokenContent(token.content);
      const measurementStyle = baseStyle.clone();
      EffectProcessor.applyInitialStylesToStyle(measurementStyle, visualConfigs);
      console.log(
        `[Layout-Diag] Measuring token "${finalContent.substring(0, 5)}" with style:`,
        measurementStyle,
      );

      this.logMeasurementDiagnostics(token.content, measurementStyle);

      const safeGlobalMetrics = this.measureFontSafe(measurementStyle);

      if ((token as any).isSugar && token.sugar && token.sugar.length > 0) {
        const glyphPlan: LayoutGlyphPlan = {
          kind: "timing-carrier",
          text: "",
          style: measurementStyle.clone(),
          baseStyleSnapshot: { ...baseStyleSnapshot },
          effects: [],
          timingSugars: token.sugar.map((s) => ({
            name: s.name,
            params: s.params,
            level: s.level,
          })),
          tokenIdx,
          charIdx: 0,
          width: 0,
          height: 0,
          ascent: safeGlobalMetrics.ascent,
          descent: safeGlobalMetrics.descent,
          stageInstructions: [],
          line: token.line,
        };
        allGlyphPlans.push(glyphPlan);
        stream.push(this.toPlannedItem(glyphPlan));
        return;
      }

      const measuredChars = this.measureChars(finalContent, measurementStyle);
      const tokenWidth = this.calculateTokenWidth(measuredChars, measurementStyle);
      const charWidths = measuredChars.map((measured) => measured.width);

      const preCmds: LayoutCommand[] = [];
      const postCmds: LayoutCommand[] = [];
      const stageInstructions: PlannedStageInstruction[] = [];

      allRawInstructions.forEach((instr) => {
        const instruction = instr as typeof instr & {
          blocking?: boolean;
          level?: CommandLevel;
          lineScope?: string;
        };
        const expander = layoutManager.getExpander(instruction.type);
        if (expander) {
          const { pre, post } = expander(instruction.params, {
            width: tokenWidth,
            charWidths,
            letterSpacing: measurementStyle.letterSpacing || 0,
            fontSize: measurementStyle.fontSize as number,
            lineHeight: measurementStyle.lineHeight || (measurementStyle.fontSize as number) * 1.2,
            markers: layout.globalMarkers,
          });
          const scope = instruction.lineScope;
          if (!scope) {
            if (pre) preCmds.push(...pre);
            if (post) postCmds.push(...post);
          } else if (scope === "pre") {
            if (pre) preCmds.push(...pre);
          } else if (scope === "post") {
            if (post) postCmds.push(...post);
          }
          return;
        }

        const scope = instruction.lineScope;
        if (scope === "post") return;

        if (stageManager.has(instruction.type)) {
          stageInstructions.push({
            type: instruction.type,
            params: instruction.params ?? {},
            blocking: instruction.blocking,
            level: instruction.level,
          });
          return;
        }

        const cmd = layoutManager.generate(instruction.type, instruction.params);
        if (cmd) preCmds.push(cmd);
      });

      effectStageConfigs.forEach((cfg) => {
        stageInstructions.push({
          type: cfg.name,
          params: cfg.params ?? {},
          blocking: cfg.blocking,
          level: cfg.level,
        });
      });

      preCmds.forEach((cmd) => stream.push(cmd));

      if (finalContent.length === 0 && stageInstructions.length > 0) {
        const glyphPlan: LayoutGlyphPlan = {
          kind: "instruction-carrier",
          text: "",
          style: measurementStyle.clone(),
          baseStyleSnapshot: { ...baseStyleSnapshot },
          effects: visualConfigs,
          timingSugars: [],
          tokenIdx,
          charIdx: 0,
          width: 0,
          height: 0,
          ascent: safeGlobalMetrics.ascent,
          descent: safeGlobalMetrics.descent,
          stageInstructions,
          line: token.line,
        };
        allGlyphPlans.push(glyphPlan);
        stream.push(this.toPlannedItem(glyphPlan));
      }

      measuredChars.forEach((measured, charIdx) => {
        const glyphPlan: LayoutGlyphPlan = {
          kind: "char",
          text: measured.text,
          style: measurementStyle.clone(),
          baseStyleSnapshot: { ...baseStyleSnapshot },
          effects: [...visualConfigs],
          timingSugars: this.collectTimingSugars(token, charIdx),
          tokenIdx,
          charIdx,
          width: measured.width,
          height: measured.ascent + measured.descent,
          ascent: measured.ascent,
          descent: measured.descent,
          stageInstructions: charIdx === measuredChars.length - 1 ? stageInstructions : [],
          line: token.line,
        };

        if (token.content.includes("重音") || token.content.includes("轻声")) {
          console.log(
            `[LayoutPlanner-Trace] Char: "${measured.text}", width: ${glyphPlan.width}, ` +
            `ascent: ${glyphPlan.ascent}, descent: ${glyphPlan.descent}, font: ${glyphPlan.style.fontFamily}`,
          );
        }

        allGlyphPlans.push(glyphPlan);
        stream.push(this.toPlannedItem(glyphPlan));
      });

      postCmds.forEach((cmd) => stream.push(cmd));
    });

    return { stream, allGlyphPlans };
  }

  private static toPlannedItem(glyphPlan: LayoutGlyphPlan): PlannedLayoutItem {
    return {
      isCommand: false,
      width: glyphPlan.width,
      height: glyphPlan.height,
      glyphPlan,
    };
  }

  private static resolveTokenContent(content: string) {
    if (!content.startsWith("var.")) return content;

    const marker = layout.globalMarkers.get(content);
    if (marker === undefined) return content;
    return String(marker.x);
  }

  private static collectTimingSugars(token: KMDInlineIR, charIdx: number): PlannedTimingSugar[] {
    if (!token.sugar || token.sugar.length === 0) return [];

    return token.sugar
      .filter((sugar) => sugar.charIdx === charIdx || sugar.charIdx === undefined)
      .map((sugar) => ({
        name: sugar.name,
        params: sugar.params,
        level: sugar.level,
      }));
  }

  private static calculateTokenWidth(measuredChars: MeasuredChar[], style: TextStyle) {
    if (measuredChars.length === 0) return 0;

    const letterSpacing = Number(style.letterSpacing || 0);
    return measuredChars.reduce((total, measured, index) => {
      const spacing = index < measuredChars.length - 1 ? letterSpacing : 0;
      return total + measured.width + spacing;
    }, 0);
  }

  private static measureChars(text: string, style: TextStyle): MeasuredChar[] {
    return Array.from(text).map((charText) => {
      const metrics = this.measureTextSafe(charText, style);
      return {
        text: charText,
        width: metrics.width,
        ascent: metrics.ascent,
        descent: metrics.descent,
      };
    });
  }

  private static measureFontSafe(style: TextStyle) {
    const fontString = this.buildFontString(style);
    const fontMetrics = CanvasTextMetrics.measureFont(fontString);

    return {
      ascent: fontMetrics.ascent || (style.fontSize as number) * 0.8,
      descent: fontMetrics.descent || (style.fontSize as number) * 0.2,
    };
  }

  private static buildFontString(style: TextStyle) {
    const fontSize = typeof style.fontSize === "number" ? `${style.fontSize}px` : style.fontSize;
    const fontFamily = this.buildFontFamilyString(style.fontFamily);
    return `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${fontSize} ${fontFamily}`;
  }

  private static buildFontFamilyString(fontFamily: string | string[]) {
    if (Array.isArray(fontFamily)) {
      return fontFamily
        .map((family) => (family.includes(" ") && !family.startsWith("\"") ? `"${family}"` : family))
        .join(", ");
    }
    return fontFamily;
  }

  private static logMeasurementDiagnostics(tokenContent: string, style: TextStyle) {
    const fontString = this.buildFontString(style);
    const currentResolution = window.devicePixelRatio || 1;
    const measurementResolution = (CanvasTextMetrics as any)._canvas?.width
      ? (CanvasTextMetrics as any)._canvas.width / (CanvasTextMetrics as any)._canvas.style.width
      : "unknown";
    const firstFont = Array.isArray(style.fontFamily) ? style.fontFamily[0] : style.fontFamily;
    const fontSize = typeof style.fontSize === "number" ? `${style.fontSize}px` : style.fontSize;
    const isLoaded = (document as any).fonts?.check(`${fontSize} ${firstFont}`);

    if (tokenContent.trim()) {
      console.log(
        `[Layout-Diag] Token: "${tokenContent.substring(0, 5)}", font: "${fontString}", ` +
        `loaded: ${isLoaded}, screenRes: ${currentResolution}, measureRes: ${measurementResolution}`,
      );
    }
  }

  private static measureTextSafe(text: string, style: TextStyle) {
    const metrics = CanvasTextMetrics.measureText(text, style);
    const fontProps = metrics.fontProperties || {
      ascent: (style.fontSize as number) * 0.8,
      descent: (style.fontSize as number) * 0.2,
      fontSize: style.fontSize as number,
    };

    return {
      width: metrics.width,
      lineHeight: metrics.lineHeight || (style.fontSize as number) * 1.2,
      ascent: fontProps.ascent || (style.fontSize as number) * 0.8,
      descent: fontProps.descent || (style.fontSize as number) * 0.2,
    };
  }

  private static createBaseStyleSnapshot(baseStyle: TextStyle) {
    return {
      fill: baseStyle.fill,
      fontWeight: baseStyle.fontWeight,
      fontStyle: baseStyle.fontStyle,
      fontSize: baseStyle.fontSize,
      fontFamily: baseStyle.fontFamily,
      dropShadow: baseStyle.dropShadow,
      stroke: baseStyle.stroke,
    };
  }
}
