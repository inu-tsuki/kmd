import { Application } from "pixi.js";

class ReaderApp {
  // 单例模式，保证全局只有一个渲染器
  private static instance: ReaderApp;
  public pixiApp: Application;
  public isInitialized = false;

  private constructor() {
    this.pixiApp = new Application();
  }

  public static getInstance(): ReaderApp {
    if (!ReaderApp.instance) {
      ReaderApp.instance = new ReaderApp();
    }
    return ReaderApp.instance;
  }

  // 初始化 Pixi 应用
  public async init(container: HTMLElement) {
    if (this.isInitialized) return;

    // v8 初始化方式
    await this.pixiApp.init({
      background: "#000000", //以此颜色测试，方便看清画布边界
      resizeTo: window, // 自动跟随容器大小
      antialias: true, // 抗锯齿
      resolution: window.devicePixelRatio || 1, // 使用设备像素比
      autoDensity: true, // 【关键】告诉 Pixi 调整 CSS 样式以匹配分辨率
    });

    // 将 Canvas 添加到 DOM
    container.appendChild(this.pixiApp.canvas);
    this.isInitialized = true;
  }

  // 销毁（用于组件卸载时）
  public destroy() {
    // 这里的处理视情况而定，通常单例App不轻易销毁，
    // 但如果路由切换需要释放资源，可以调用 this.pixiApp.destroy()
  }
}

export const readerApp = ReaderApp.getInstance();
