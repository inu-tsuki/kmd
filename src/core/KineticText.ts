import { Container, Rectangle } from "pixi.js";
import { EffectProcessor } from "./effects/EffectProcessor";
import { TokenWrapper } from "./TokenWrapper"; 
import { KineticChar } from "./KineticChar"; 
import { TextBuilder } from "./render/text/TextBuilder";
import { TextPlayer } from "./render/text/TextPlayer";

import type { BlockOptions } from "./parser/types";
import type { MarkerMap } from "./layout/types";

export interface KineticTextOptions extends BlockOptions {
  externalMarkers: MarkerMap;
  baseOffset?: { x: number; y: number };
}
export type FullOptions = Required<KineticTextOptions>;

export class KineticText extends Container {
  public _options: FullOptions;
  public _sourceKMD: string = "";
  public _currentOptions: KineticTextOptions;

  public tokens: TokenWrapper[] = [];
  public _pendingGlobalEffects: any[] = [];
  public _allCharsCached: KineticChar[] = [];
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
    if ((document as any).fonts) {
        await (document as any).fonts.ready;
    }
    await TextBuilder.build(this, kmdString, startLine);
  }

  public async applyParagraphEffects() {
    await EffectProcessor.applyGroupEffects(this as any, this._pendingGlobalEffects);
  }

  public async rebuild(newOptions?: any, startLine: number = 0) {
    this._currentOptions = { ...this._currentOptions, ...newOptions };
    this._options = {
      maxWidth: 800, lineHeight: 60, fontSize: 36, indent: 0,
      align: "left", letterSpacing: 0, speed: 50, mode: "normal",
      ...this._currentOptions,
    } as FullOptions;
    
    this.tokens.forEach((t) => t.destroy({ children: true }));
    this.removeChildren();
    await TextBuilder.build(this, this._sourceKMD, startLine);
  }

  public async play(absStartTime: number, options: { speed?: number; mode?: string; onAdvance?: () => void } = {}): Promise<{ skipAutoPause?: boolean }> {
    this._stopRequested = false;
    return TextPlayer.play(this, this._allCharsCached, this.tokens, absStartTime, options);
  }

  public bakeTimeline(baseSpeed: number): number {
    return TextPlayer.bakeTimeline(this, this._allCharsCached, baseSpeed);
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
    TextPlayer.skipToEnd(this, this._allCharsCached, this.tokens);
  }

  public getLayoutHeight(): number {
    const inFlowChars = this._allCharsCached.filter((c) => c.inFlow);
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
    const inFlowChars = this._allCharsCached.filter((c) => c.inFlow);
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
    const allChars = this._allCharsCached;
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
