import { Container, Text, Graphics, Rectangle } from "pixi.js";

export class TokenWrapper extends Container {
  public chars: Text[] = []; // 存储内部的字符
  public bgGraphics: Graphics; // 专门用于画背景、边框

  constructor() {
    super();
    // 初始化背景层，放在最底层 (zIndex = 0)
    this.bgGraphics = new Graphics();
    this.addChild(this.bgGraphics);
  }

  // 添加字符并自动排版
  public addChars(textObjects: Text[]) {
    let currentX = 0;
    let maxHeight = 0;

    textObjects.forEach((textObj) => {
      // 1. 设置字符在 Token 内部的相对位置
      textObj.anchor.set(0.5); // 保持中心锚点

      // 2. 字符的 y 设为 0 (相对于 Token 中心线的垂直偏移)
      // 注意：Text(anchor=0.5) 的 (0,0) 就是字符中心
      // 这里的 currentX 是字符左边界，所以 x 要加上半宽
      textObj.x = currentX + textObj.width / 2;
      textObj.y = textObj.height / 2; // 暂定：垂直居中于行高一半

      this.addChild(textObj);
      this.chars.push(textObj);

      currentX += textObj.width;
      maxHeight = Math.max(maxHeight, textObj.height);
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
    // 简单计算：宽度是最后一个字的右边缘，高度取第一个字的高度(假设等高)
    // 更严谨的做法是遍历计算 max bounds
    if (this.chars.length === 0) return new Rectangle(0, 0, 0, 0);

    const first = this.chars[0];
    const last = this.chars[this.chars.length - 1];

    const width = (last?.x ?? 0) + (last?.width ?? 0) / 2;
    const height = first?.height ?? 0; // 简略
    return new Rectangle(0, 0, width, height);
  }
}
