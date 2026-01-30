import { Text, TextStyle, Ticker } from "pixi.js";

// 定义一个偏移量接口
export interface TransformOffset {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number; // 乘法叠加
  tint: number; // 颜色叠加 (Hex)
}

interface Modifier {
  id: string;
  fn: (time: number) => Partial<TransformOffset>;
}

export class KineticChar extends Text {
  // 排版决定的基准位置 (Layout Position)
  public _layoutX: number = 0;
  public _layoutY: number = 0;

  // 使用 getter/setter 确保同步
  get layoutX() {
    return this._layoutX;
  }
  set layoutX(val: number) {
    this._layoutX = val;
    this.x = val; // 【关键】立即应用，保证 getBounds/width 计算正确
  }

  get layoutY() {
    return this._layoutY;
  }
  set layoutY(val: number) {
    this._layoutY = val;
    this.y = val; // 【关键】立即应用
  }

  // 活跃的特效修改器列表
  // 每个修改器是一个函数，每一帧返回一个 Offset
  // private modifiers: Array<(time: number) => Partial<TransformOffset>> = [];
  // 改用 Map 存储，方便按 ID 查找和覆盖
  private modifiers: Map<string, Modifier> = new Map();

  constructor(text: string, style: TextStyle) {
    super({ text, style });

    // 监听 Pixi 的全局 Ticker，每一帧更新自己的状态
    Ticker.shared.add(this.update, this);
  }

  // 注册修改器
  // id: 用于标识特效类型 (e.g. "shake", "wave")，同名特效会覆盖
  public addModifier(
    id: string,
    fn: (time: number) => Partial<TransformOffset>,
  ) {
    this.modifiers.set(id, { id, fn });
  }

  // 移除修改器
  public removeModifier(id: string) {
    this.modifiers.delete(id);
  }

  // 每一帧调用的更新函数
  private update(ticker: Ticker) {
    // 1. 重置为排版基准
    let finalX = this.layoutX;
    let finalY = this.layoutY;
    let finalRotation = 0;
    let finalScaleX = 1;
    let finalScaleY = 1;
    let finalAlpha = 1;
    let finalTint = 0xffffff;

    // 2. 累加所有修改器的结果
    // 使用 ticker.lastTime 保证动画连续性
    const time = ticker.lastTime;

    this.modifiers.forEach((mod) => {
      const offset = mod.fn(time);
      if (offset.x) finalX += offset.x;
      if (offset.y) finalY += offset.y;
      if (offset.rotation) finalRotation += offset.rotation;
      if (offset.scaleX) finalScaleX *= offset.scaleX; // 缩放通常是乘法
      if (offset.scaleY) finalScaleY *= offset.scaleY;
      if (offset.alpha !== undefined) finalAlpha *= offset.alpha;
      if (offset.tint !== undefined) finalTint = offset.tint; // 颜色直接覆盖
    });

    // 3. 应用到 Pixi 对象
    this.x = finalX;
    this.y = finalY;
    this.rotation = finalRotation;
    this.scale.set(finalScaleX, finalScaleY);
    this.alpha = finalAlpha;
    this.tint = finalTint;
  }

  // 销毁时记得移除监听，防内存泄漏
  public destroy(options?: any) {
    Ticker.shared.remove(this.update, this);
    super.destroy(options);
  }
}
