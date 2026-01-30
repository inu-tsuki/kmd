import { Container } from "pixi.js";
import { KineticText } from "../KineticText";
import { readerApp } from "../App";

class LayoutEngine {
  private currentY: number = 0;
  private lineHeight: number = 60; // 默认行高
  private startY: number = 100; // 起始 Y 坐标
  private container: Container | null = null;

  // 初始化：设置渲染容器和起始位置
  public init(container: Container, startY: number = 100) {
    this.container = container;
    this.startY = startY;
    this.reset();

    // 监听屏幕尺寸变化
    readerApp.pixiApp.renderer.on("resize", () => {
      this.recenterAll();
    });
  }

  // 新增：重新居中所有行
  private recenterAll() {
    if (!this.container) return;

    const newCenterX = readerApp.pixiApp.screen.width / 2;

    // 遍历所有 KineticText 子对象，更新 x 坐标
    this.container.children.forEach((child) => {
      if (child instanceof KineticText) {
        child.x = newCenterX;
      }
    });
  }

  // 重置光标
  public reset() {
    this.currentY = this.startY;
  }

  // 添加一行文本 (自动居中、自动换行)
  public addLine(kmdString: string): KineticText {
    if (!this.container) throw new Error("LayoutEngine not initialized");

    const line = new KineticText(kmdString);

    // 1. 水平居中
    // 因为 KineticText.pivot 已经是中心了，所以我们把它放在屏幕中心
    const screenWidth = readerApp.pixiApp.screen.width;
    line.x = screenWidth / 2;

    // 2. 垂直排列
    line.y = this.currentY;

    // 3. 渲染
    this.container.addChild(line);

    // 4. 更新光标
    this.currentY += this.lineHeight; // 这里以后可以改成 line.height + padding

    return line;
  }
}

export const layout = new LayoutEngine();
