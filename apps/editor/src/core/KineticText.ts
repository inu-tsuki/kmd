import { Container, Rectangle } from "pixi.js";
import { EffectProcessor } from "./effects/EffectProcessor";
import { TokenWrapper } from "./TokenWrapper";
import { KineticChar } from "./KineticChar";
import { TextBuilder } from "./render/text/TextBuilder";
import { TextBuildContextResolver } from "./render/text/TextBuildContextResolver";
import { TextPlayer } from "./render/text/TextPlayer";

import type { BlockOptions } from "./parser/types";
import type { MarkerMap } from "./layout/types";
import {
  createEmptyParagraphDisplayAssembly,
  type ParagraphBuildInput,
  type ParagraphDisplayAssembly,
  type TextExecutionItemPayload,
} from "./render/text/types";

export interface KineticTextOptions extends BlockOptions {
  externalMarkers: MarkerMap;
  baseOffset?: { x: number; y: number };
}
export type FullOptions = Required<KineticTextOptions>;

export class KineticText extends Container {
  public _options: FullOptions;
  public _sourceKMD: string = "";
  private _sourceStartLine: number = 0;
  public _currentOptions: KineticTextOptions;
  private _paragraphBuildInput?: ParagraphBuildInput;

  // Canonical paragraph build result. New layout/execution/runtime paths should read here first.
  public _displayAssembly: ParagraphDisplayAssembly = createEmptyParagraphDisplayAssembly();
  /** @deprecated Legacy compat mirror. Prefer `_displayAssembly.tokens`. */
  public tokens: TokenWrapper[] = [];
  public _pendingGlobalEffects: any[] = [];
  /** @deprecated Legacy compat mirror. Prefer `_displayAssembly.chars`. */
  public _allCharsCached: KineticChar[] = [];
  /** @deprecated Legacy compat mirror. Prefer `_displayAssembly.executionItems`. */
  public _executionItems: TextExecutionItemPayload[] = [];
  public _stopRequested: boolean = false;

  public logicalHeight: number = 0;
  public isAutoLayout: boolean = true;

  constructor(baseOptions: KineticTextOptions) {
    super();
    this._currentOptions = { ...baseOptions };
    this._options = Object.assign(
      {
        maxWidth: 800,
        lineHeight: 60,
        fontSize: 36,
        indent: 0,
        align: "left",
        letterSpacing: 0,
        speed: 50,
        mode: "normal",
        baseOffset: { x: 0, y: 0 },
        externalMarkers: baseOptions.externalMarkers,
      },
      baseOptions,
    ) as FullOptions;
  }

  public async init(kmdString: string, startLine: number = 0) {
    this._sourceKMD = kmdString;
    this._sourceStartLine = startLine;
    this._paragraphBuildInput = undefined;
    if ((document as any).fonts) {
      await (document as any).fonts.ready;
    }
    await TextBuilder.build(this, kmdString, startLine, TextBuildContextResolver.fromTarget);
  }

  public async initFromParagraph(input: ParagraphBuildInput) {
    this._sourceKMD = input.sourceKMD ?? "";
    this._sourceStartLine = input.paragraph.lineOffset ?? 0;
    this._paragraphBuildInput = input;
    if ((document as any).fonts) {
      await (document as any).fonts.ready;
    }
    await TextBuilder.buildFromParagraph(this, input, TextBuildContextResolver.fromTarget);
  }

  public async applyParagraphEffects() {
    await EffectProcessor.applyGroupEffects(this as any, this._pendingGlobalEffects);
  }

  public async rebuild(newOptions?: any) {
    this._currentOptions = { ...this._currentOptions, ...newOptions };
    this._options = {
      maxWidth: 800, lineHeight: 60, fontSize: 36, indent: 0,
      align: "left", letterSpacing: 0, speed: 50, mode: "normal",
      ...this._currentOptions,
    } as FullOptions;

    this.tokens.forEach((t) => t.destroy({ children: true }));
    this.removeChildren();
    this._displayAssembly = createEmptyParagraphDisplayAssembly();
    this.tokens = this._displayAssembly.tokens;
    this._allCharsCached = this._displayAssembly.chars;
    this._executionItems = this._displayAssembly.executionItems;
    if (this._paragraphBuildInput) {
      await TextBuilder.buildFromParagraph(this, this._paragraphBuildInput, TextBuildContextResolver.fromTarget);
      return;
    }
    await TextBuilder.build(this, this._sourceKMD, this._sourceStartLine, TextBuildContextResolver.fromTarget);
  }

  public async play(absStartTime: number, options: { speed?: number; mode?: string; onAdvance?: () => void } = {}): Promise<{ skipAutoPause?: boolean }> {
    this._stopRequested = false;
    return TextPlayer.play(this, this._displayAssembly, absStartTime, options);
  }

  public bakeTimeline(baseSpeed: number): number {
    return TextPlayer.bakeTimeline(this, this._displayAssembly, baseSpeed);
  }

  public stop() {
    this._stopRequested = true;
  }

  /**
   * 瞬间跳到演出结束态
   * 用于跳转后瞬间回归的存量文字
   */
  public skipToEnd() {
    this._stopRequested = true;
    TextPlayer.skipToEnd(this, this._displayAssembly);
  }

  public getLayoutHeight(): number {
    const inFlowChars = this._displayAssembly.chars.filter((c) => c.inFlow);
    if (inFlowChars.length === 0) return 0;
    let minY = Infinity, maxY = -Infinity;
    inFlowChars.forEach((c) => {
      const h = c.height;
      const top = c.layoutY - h * c.anchor.y;
      const bottom = top + h;
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, bottom);
    });
    return maxY - minY;
  }

  public getLayoutWidth(): number {
    const inFlowChars = this._displayAssembly.chars.filter((c) => c.inFlow);
    if (inFlowChars.length === 0) return 0;
    let minX = Infinity, maxX = -Infinity;
    inFlowChars.forEach((c) => {
      const w = c.width;
      const left = c.layoutX - w * c.anchor.x;
      const right = left + w;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
    });
    return maxX - minX;
  }

  public getContentBounds(): Rectangle {
    const allChars = this._displayAssembly.chars;
    if (allChars.length === 0) return new Rectangle(0, 0, 0, 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    allChars.forEach((c) => {
      const w = c.width, h = c.height;
      const left = c.layoutX - w * c.anchor.x;
      const top = c.layoutY - h * c.anchor.y;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, left + w);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, top + h);
    });
    return new Rectangle(minX, minY, maxX - minX, maxY - minY);
  }
}
