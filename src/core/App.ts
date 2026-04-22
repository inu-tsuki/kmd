import { Application, Assets } from "pixi.js";
import { PixiReaderHost } from "./stage/ReaderHost";
import { stageManager } from "./stage/StageManager";

declare global {
  var __PIXI_APP__: Application | undefined;
}

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
      globalThis.__PIXI_APP__ = ReaderApp.instance.pixiApp;
    }
    return ReaderApp.instance;
  }

  // 初始化 Pixi 应用
  public async init(container: HTMLElement) {
    if (this.isInitialized) {
      // 核心修复：如果已初始化，说明是布局重排。
      // 我们需要将原本的 canvas 搬移到新的容器节点下。
      if (this.pixiApp.canvas.parentElement !== container) {
        container.appendChild(this.pixiApp.canvas);
        // 搬家后强制触发一次 resize
        this.pixiApp.resize();
      }
      return;
    }

    // v8 初始化方式
    await this.pixiApp.init({
      background: "#000000",
      resizeTo: container, // 自动跟随容器大小
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true, // 【关键】告诉 Pixi 调整 CSS 样式以匹配分辨率
    });

    // 预加载字体
    await this.loadFonts();

    // 初始化舞台管理器（预设已通过模块顶层自动注册）
    stageManager.init(new PixiReaderHost(this.pixiApp));

    // 将 Canvas 添加到 DOM
    container.appendChild(this.pixiApp.canvas);
    this.isInitialized = true;
  }

  private async loadFonts() {
    // 这里可以定义需要加载的字体
    // 建议用户将字体放置在 public/fonts 目录下
    const fonts = [
      { alias: "LXGW WenKai", src: "/fonts/LXGWWenKai-Regular.ttf" },
      { alias: "Sasara Regular", src: "/fonts/SarasaGothicSC-Regular.ttf" },
      { alias: "Smiley Sans", src: "/fonts/SmileySans-Oblique.ttf" },
      { alias: "Fira Code", src: "/fonts/FiraCode-Regular.ttf" },
      // 在此处添加更多字体...
    ];

    // 先使用原生 FontFace API 加载，这对 Canvas 渲染中文字体最稳健
    for (const f of fonts) {
      try {
        console.log(`[ReaderApp] Native loading: ${f.alias} from ${f.src}`);
        const fontFace = new FontFace(f.alias, `url(${f.src})`);
        const loadedFace = await fontFace.load();
        (document as any).fonts.add(loadedFace);
        console.log(`[ReaderApp] Font ${f.alias} registered via FontFace API.`);
      } catch (e) {
        console.warn(`[ReaderApp] Native load failed for ${f.alias}, will try Pixi Assets:`, e);
      }
    }

    fonts.forEach((f) => {
      console.log(
        `[ReaderApp] Registering font asset: alias="${f.alias}", src="${f.src}"`,
      );
      Assets.add({ alias: f.alias, src: f.src });
    });

    try {
      console.log("[ReaderApp] Assets.load sequence starting...");
      const loaded = await Assets.load(fonts.map((f) => f.alias));
      console.log(
        "[ReaderApp] Assets loaded successfully:",
        Object.keys(loaded),
      );
    } catch (e) {
      console.warn(
        "[ReaderApp] Font loading failed, falling back to system fonts.",
        e,
      );
    }
  }

  // 销毁（用于组件卸载时）
  public destroy() {
    // 这里的处理视情况而定，通常单例App不轻易销毁，
    // 但如果路由切换需要释放资源，可以调用 this.pixiApp.destroy()
  }
}

export const readerApp = ReaderApp.getInstance();
