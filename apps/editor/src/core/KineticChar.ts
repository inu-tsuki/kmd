import { Text, TextStyle } from "pixi.js";
import type { EffectConfig } from "./parser/types";
import gsap from "gsap";

// 定义一个偏移量接口
export interface TransformOffset {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  tint: number;
}

interface Modifier {
  id: string;
  type: 'anim' | 'behavior'; // 区分受控动画与实时行为
  fn: (time: number) => Partial<TransformOffset>;
}

export class KineticChar extends Text {
  // 1. Base 层 (排版决定的物理基准)
  public _layoutX: number = 0;
  public _layoutY: number = 0;

  // 1b. Display Offset 层 (视觉偏移，不影响 getLayoutHeight)
  public displayOffset: { x: number; y: number } = { x: 0, y: 0 };

  // 2. Anim 层 (受 MasterTimeline / Playhead 控制的偏移，可被 seek)
  // 此层属性由外部 GSAP 动画直接操作
  public animOffset: TransformOffset = this.createDefaultOffset();

  // 3. Behavior 层 (实时物理模拟，如 shake, wave)
  private modifiers: Map<string, Modifier> = new Map();

  public inFlow: boolean = true;
  // Compat semantic payload mirror.
  // New paragraph build / execution-plan mainline should read target._executionItems instead.
  /** @deprecated Legacy compat surface. Prefer TextExecutionItemPayload. */
  public stageInstructions: any[] = [];
  /** @deprecated Legacy compat surface. Prefer TextExecutionItemPayload. */
  public visualEffects: any[] = [];
  /** @deprecated Legacy compat surface. Prefer TextExecutionItemPayload. */
  public timingSugars: any[] = [];
  public timingResults: { delayOverride?: number; speedMultiplier?: number } = {};
  /** @deprecated Legacy compat surface. Prefer TextExecutionItemPayload / TokenWrapper.tokenIdx. */
  public tokenIdx: number = -1;
  public isNewLine: boolean = false;
  public line?: number;

  public pendingEnterConfig?: EffectConfig;

  /**
   * Base TextStyle 快照（构建时，未应用任何样式特效前）
   * 用于 seek 时 resetStyle() 还原到基准状态再重放 StyleRecord
   */
  public readonly baseStyleSnapshot: Record<string, any>;

  constructor(text: string, style: TextStyle) {
    super({ text, style });
    this.anchor.set(0.5);
    gsap.ticker.add(this.update);
    this.baseStyleSnapshot = {
      fill: style.fill,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      dropShadow: style.dropShadow,
      stroke: style.stroke,
    };
  }

  /**
   * 将 TextStyle 还原到 baseStyleSnapshot（seek 前调用，清除所有样式特效）
   */
  public resetStyle() {
    const s = this.baseStyleSnapshot;
    const st = this.style as any;
    st.fill = s.fill;
    st.fontWeight = s.fontWeight;
    st.fontStyle = s.fontStyle;
    st.fontSize = s.fontSize;
    st.fontFamily = s.fontFamily;
    st.dropShadow = s.dropShadow;
    st.stroke = s.stroke;
  }

  /**
   * 从当前 style 重新捕获 baseStyleSnapshot（R16/SA-31）。
   *
   * 用途：block/global 初始样式经 SegmentBuilder 的 applyGroupEffects 在 KineticChar 构造**之后**
   * 同步写入 char.style（SegmentBuilder.ts:242），但此时 baseStyleSnapshot 已在构造时固化
   *（R15 的 pre-hold 烘焙态）。若不重新捕获，block 样式（如 [.red:block]）只在 char.style 里、
   * 不在 baseline、不在 styleRecords → 后续动态样式 record 触发 replayStyles 时 resetStyle()
   * 回 baseline（无 block 样式）→ block 样式丢失。
   *
   * 与 R15 同模型：构建期已应用的初始样式进 baseline（而非 record 重放），避免相对样式
   * big/small 重复放大。字段集与构造函数/resetStyle 完全一致。
   */
  public recaptureBaseStyleSnapshot() {
    const st = this.style as any;
    const s = this.baseStyleSnapshot;
    s.fill = st.fill;
    s.fontWeight = st.fontWeight;
    s.fontStyle = st.fontStyle;
    s.fontSize = st.fontSize;
    s.fontFamily = st.fontFamily;
    s.dropShadow = st.dropShadow;
    s.stroke = st.stroke;
  }

  private createDefaultOffset(): TransformOffset {
    // 默认 alpha 为 0，确保在入场特效开始前字符是不可见的
    return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 0, tint: 0xffffff };
  }

  // 使用 getter/setter 确保同步，layoutX/Y 是 Base 层的入口
  get layoutX() { return this._layoutX; }
  set layoutX(val: number) {
    this._layoutX = val;
    this.syncProperties(); // 立即同步
  }

  get layoutY() { return this._layoutY; }
  set layoutY(val: number) {
    this._layoutY = val;
    this.syncProperties(); // 立即同步
  }

  /**
   * 强制同步属性到 Pixi 对象，防止 Ticker 延迟导致的闪烁
   */
  public syncProperties(time: number = this.getTickerTime()) {
    // 1. 起始于 Base 层 (排版坐标 + 视觉偏移)
    let finalX = this.layoutX + this.displayOffset.x;
    let finalY = this.layoutY + this.displayOffset.y;
    let finalRotation = 0;
    let finalScaleX = 1;
    let finalScaleY = 1;
    let finalAlpha = 1;
    let finalTint = 0xffffff;

    // 2. 融合 Anim 层 (这一层通常由 GSAP 直接改写本实例的 animOffset 属性)
    finalX += this.animOffset.x;
    finalY += this.animOffset.y;
    finalRotation += this.animOffset.rotation;
    finalScaleX *= this.animOffset.scaleX;
    finalScaleY *= this.animOffset.scaleY;
    finalAlpha *= this.animOffset.alpha;
    if (this.animOffset.tint !== 0xffffff) finalTint = this.animOffset.tint;

    // 3. 融合 Behavior 层 (实时物理叠加)
    this.modifiers.forEach((mod) => {
      if (mod.type === 'behavior') {
        const offset = mod.fn(time);
        if (offset.x) finalX += offset.x;
        if (offset.y) finalY += offset.y;
        if (offset.rotation) finalRotation += offset.rotation;
        if (offset.scaleX) finalScaleX *= offset.scaleX;
        if (offset.scaleY) finalScaleY *= offset.scaleY;
        if (offset.alpha !== undefined) finalAlpha *= offset.alpha;
        if (offset.tint !== undefined) finalTint = offset.tint;
      }
    });

    // 4. 最终应用到 Pixi 显示对象
    this.x = finalX;
    this.y = finalY;
    this.rotation = finalRotation;
    this.scale.set(finalScaleX, finalScaleY);
    this.alpha = finalAlpha;
    this.tint = finalTint;
  }

  /**
   * 注册修改器
   * type: 'anim' 目前由 animOffset 接管逻辑，'behavior' 继续在 update 中逐帧计算
   */
  public addModifier(
    id: string,
    type: 'anim' | 'behavior' = 'behavior',
    fn: (time: number) => Partial<TransformOffset>,
  ) {
    this.modifiers.set(id, { id, type, fn });
  }

  public removeModifier(id: string) {
    this.modifiers.delete(id);
  }

  private getTickerTime() {
    return gsap.ticker.time * 1000;
  }

  /**
   * 每一帧调用的更新函数：三层属性融合。
   *
   * 使用 GSAP ticker 而不是 Pixi shared ticker，是为了让 animOffset 的同步
   * 与 GSAP timeline 同源，避免 WebView 宿主中两个 ticker 生命周期不一致时
   * 字符已经被 timeline 推进、但 Pixi Text 仍停留在 alpha=0 的状态。
   */
  private update = () => {
    this.syncProperties(this.getTickerTime());
  };

  public destroy(options?: any) {
    gsap.ticker.remove(this.update);
    super.destroy(options);
  }
}
