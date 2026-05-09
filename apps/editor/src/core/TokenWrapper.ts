import { Container, Graphics, Rectangle } from "pixi.js";
import { KineticChar } from "./KineticChar"; // 引入新类

export class TokenWrapper extends Container {
  public chars: KineticChar[] = []; // 存储内部的字符
  public tokenIdx: number = -1; // 【新增】Token 原始索引，用于边界判定
  // public bgGraphics: Graphics; // 专门用于画背景、边框
  private graphicsLayers: Map<string, Graphics> = new Map();

  constructor() {
    super();
  }

  // 添加字符并自动排版
  public addChars(charObjects: KineticChar[]) {
    let currentX = 0;
    let maxHeight = 0;

    charObjects.forEach((charObj) => {
      // 1. 设置字符在 Token 内部的相对位置
      charObj.anchor.set(0.5); // 保持中心锚点

      // 2. 字符的 y 设为 0 (相对于 Token 中心线的垂直偏移)
      charObj.layoutX = currentX + charObj.width / 2;
      charObj.layoutY = charObj.height / 2; // 暂定：垂直居中于行高一半

      this.addChild(charObj);
      this.chars.push(charObj);

      currentX += charObj.width;
      maxHeight = Math.max(maxHeight, charObj.height);
    });

    // --- 核心修正：设置 Token 自身的 Pivot ---

    const totalWidth = currentX;
    const totalHeight = maxHeight;

    // 将 Pivot 设为几何中心
    this.pivot.x = totalWidth / 2;
    this.pivot.y = totalHeight / 2;

    // 重要：Pixi 中修改 pivot 会导致视觉位移
    // 我们不需要在这里补偿 x/y，而是在 KineticText 排版时考虑这个 pivot
  }

  // 获取排版宽度 (不受 pivot 影响的逻辑宽度)
  public getLayoutWidth(): number {
    return this.width * this.scale.x; // 考虑缩放
  }

  // 辅助方法：获取内容包围盒 (不包含特效造成的位移)
  public getContentBounds(): Rectangle {
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    if (this.chars.length === 0) return new Rectangle(0, 0, 0, 0);

    this.chars.forEach((c) => {
      // 这里取 layoutX/Y 比较稳，取 x/y 可能会因为震动导致框乱跳
      const halfW = c.width / 2;
      const halfH = c.height / 2;
      minX = Math.min(minX, c.layoutX - halfW);
      maxX = Math.max(maxX, c.layoutX + halfW);
      minY = Math.min(minY, c.layoutY - halfH);
      maxY = Math.max(maxY, c.layoutY + halfH);
    });

    return new Rectangle(minX, minY, maxX - minX, maxY - minY);
  }

  // 获取指定名字的层，如果不存在就创建
  public getGraphicsLayer(name: string): Graphics {
    if (!this.graphicsLayers.has(name)) {
      const g = new Graphics();
      this.addChildAt(g, 0); // 始终放在最底层
      this.graphicsLayers.set(name, g);
    }
    return this.graphicsLayers.get(name)!;
  }
}
