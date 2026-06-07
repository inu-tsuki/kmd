import { Application, Assets, DefaultBatcher, Graphics, Texture, UPDATE_PRIORITY } from "pixi.js";
import {
  collectRuntimeFonts,
  resolveRuntimeAssetUrl,
  type RuntimeAssetContext,
} from "./runtime/RuntimeAssetPolicy";

declare global {
  var __PIXI_APP__: Application | undefined;
}

class ReaderApp {
  // 单例模式，保证全局只有一个渲染器
  private static instance: ReaderApp;
  public pixiApp: Application;
  public isInitialized = false;
  private loadedFontFamilies = new Set<string>();
  private domRenderProbe: HTMLDivElement | null = null;
  private pixiRenderProbe: Graphics | null = null;
  private pixiRenderProbeResizeHandler: (() => void) | null = null;
  private androidViewportContainer: HTMLElement | null = null;
  private androidViewportResizeHandler: (() => void) | null = null;
  private androidRendererStabilizerInstalled = false;

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
  public async init(container: HTMLElement, options: ReaderAppInitOptions = {}) {
    this.applyAndroidViewportSizing(container);

    if (this.isInitialized) {
      // 核心修复：如果已初始化，说明是布局重排。
      // 我们需要将原本的 canvas 搬移到新的容器节点下。
      if (this.pixiApp.canvas.parentElement !== container) {
        container.appendChild(this.pixiApp.canvas);
        // 搬家后强制触发一次 resize
        this.resizeToHost(container);
      }
      await this.loadFonts(options);
      return;
    }

    // v8 初始化方式
    await this.pixiApp.init({
      background: "#000000",
      resizeTo: container, // 自动跟随容器大小
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true, // 【关键】告诉 Pixi 调整 CSS 样式以匹配分辨率
      preference: "webgl",
      webgl: this.getWebGlOptions(),
    });

    this.stabilizeRendererForHost();

    // 预加载字体
    await this.loadFonts(options);

    // 将 Canvas 添加到 DOM
    container.appendChild(this.pixiApp.canvas);
    this.markCanvasForDebug();
    this.isInitialized = true;
  }

  private getWebGlOptions() {
    return this.isAndroidLikeHost()
      ? {
          preferWebGLVersion: 1 as const,
        }
      : {};
  }

  private stabilizeRendererForHost() {
    const renderer = this.pixiApp.renderer as any;
    const limits = renderer?.limits;
    if (!limits || !this.isAndroidLikeHost()) return;

    const stableTextureLimit = this.getAndroidBatchableTextureLimit();
    const originalMaxBatchableTextures = limits.maxBatchableTextures;
    const stableMaxBatchableTextures = Math.min(originalMaxBatchableTextures ?? stableTextureLimit, stableTextureLimit);

    if (originalMaxBatchableTextures !== stableMaxBatchableTextures) {
      limits.maxBatchableTextures = stableMaxBatchableTextures;
      this.logRuntimeDiagnostic(
        "[ReaderApp] Capped Pixi maxBatchableTextures for Android WebView compatibility:",
        {
          originalMaxBatchableTextures,
          stableMaxBatchableTextures,
          maxTextures: limits.maxTextures,
          renderer: renderer?.name,
          webGLVersion: renderer?.context?.webGLVersion,
        },
      );
    }

    this.primeAndroidBatchShader(stableMaxBatchableTextures);
    this.updateExistingBatchers(stableMaxBatchableTextures);
    this.bindEmptyTextureUnitsForAndroid(renderer);
    this.installAndroidRendererStabilizer(stableMaxBatchableTextures);
  }

  private getAndroidBatchableTextureLimit() {
    return 8;
  }

  private primeAndroidBatchShader(maxTextures: number) {
    try {
      const batcher = new DefaultBatcher({ maxTextures });
      batcher._updateMaxTextures(maxTextures);
      batcher.destroy();
    } catch (error) {
      this.logRuntimeDiagnostic("[ReaderApp] Failed to prime Android batch shader.", error);
    }
  }

  private updateExistingBatchers(maxTextures: number) {
    const renderer = this.pixiApp.renderer as any;
    const batchPipe = renderer?.renderPipes?.batch;
    if (!batchPipe) return;

    const visitBatcher = (batcher: any) => {
      if (!batcher) return;
      batcher.maxTextures = maxTextures;
      batcher._updateMaxTextures?.(maxTextures);
    };

    Object.values(batchPipe._activeBatches ?? {}).forEach(visitBatcher);
    Object.values(batchPipe._batchersByInstructionSet ?? {}).forEach((batchersByName: any) => {
      Object.values(batchersByName ?? {}).forEach(visitBatcher);
    });
  }

  private bindEmptyTextureUnitsForAndroid(renderer = this.pixiApp.renderer as any) {
    const textureSystem = renderer?.texture;
    const maxTextureUnits = Number(renderer?.limits?.maxTextures ?? 0);
    if (!textureSystem || !Number.isFinite(maxTextureUnits) || maxTextureUnits <= 0) return;

    const safeTextureUnits = Math.min(maxTextureUnits, 32);
    for (let unit = 0; unit < safeTextureUnits; unit += 1) {
      textureSystem.bind(Texture.EMPTY, unit);
    }
  }

  private installAndroidRendererStabilizer(maxTextures: number) {
    if (this.androidRendererStabilizerInstalled) return;
    this.androidRendererStabilizerInstalled = true;
    this.pixiApp.ticker.add(
      () => {
        this.updateExistingBatchers(maxTextures);
        this.bindEmptyTextureUnitsForAndroid();
      },
      undefined,
      UPDATE_PRIORITY.HIGH,
    );
  }

  private isAndroidLikeHost() {
    return /Android/i.test(globalThis.navigator?.userAgent ?? "");
  }

  private applyAndroidViewportSizing(container: HTMLElement) {
    if (!this.isAndroidLikeHost()) return;

    const apply = () => {
      const viewportHeight = Math.max(
        1,
        Math.round(globalThis.innerHeight || container.ownerDocument?.documentElement?.clientHeight || 0),
      );
      const viewportWidth = Math.max(
        1,
        Math.round(globalThis.innerWidth || container.ownerDocument?.documentElement?.clientWidth || 0),
      );

      Object.assign(container.style, {
        position: "fixed",
        left: "0",
        top: "0",
        right: "0",
        bottom: "0",
        width: `${viewportWidth}px`,
        height: `${viewportHeight}px`,
        minHeight: `${viewportHeight}px`,
        overflow: "hidden",
      });

      const doc = container.ownerDocument;
      doc.documentElement.style.height = "100%";
      doc.body.style.margin = "0";
      doc.body.style.minHeight = `${viewportHeight}px`;

      this.logRuntimeDiagnostic("[ReaderApp] Android viewport sizing applied.", {
        viewportWidth,
        viewportHeight,
        rect: {
          width: container.getBoundingClientRect().width,
          height: container.getBoundingClientRect().height,
        },
      });
    };

    this.androidViewportContainer = container;
    apply();

    if (!this.androidViewportResizeHandler) {
      this.androidViewportResizeHandler = () => {
        if (this.androidViewportContainer) {
          this.applyAndroidViewportSizing(this.androidViewportContainer);
          this.resizeToHost(this.androidViewportContainer);
        }
      };
      globalThis.addEventListener?.("resize", this.androidViewportResizeHandler);
    }
  }

  public resizeToHost(container?: HTMLElement | null) {
    const renderer = this.pixiApp.renderer as any;
    if (!renderer) return;

    const appWithResize = this.pixiApp as any;
    if (typeof appWithResize.resize === "function") {
      appWithResize.resize();
      return;
    }

    const target =
      container ??
      this.androidViewportContainer ??
      this.pixiApp.canvas?.parentElement ??
      null;
    const rect = target?.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(
        rect?.width ||
          globalThis.innerWidth ||
          this.pixiApp.canvas?.clientWidth ||
          this.pixiApp.screen.width ||
          0,
      ),
    );
    const height = Math.max(
      1,
      Math.round(
        rect?.height ||
          globalThis.innerHeight ||
          this.pixiApp.canvas?.clientHeight ||
          this.pixiApp.screen.height ||
          0,
      ),
    );

    if (typeof renderer.resize === "function") {
      renderer.resize(width, height);
    }
  }

  public renderOnce() {
    const appWithRender = this.pixiApp as any;
    if (typeof appWithRender.render === "function") {
      appWithRender.render();
      return;
    }

    const renderer = this.pixiApp.renderer as any;
    if (typeof renderer?.render === "function") {
      renderer.render(this.pixiApp.stage);
    }
  }

  public async loadFonts(options: ReaderAppInitOptions = {}) {
    const fonts = collectRuntimeFonts(options)
      .filter((font) => !this.loadedFontFamilies.has(font.family))
      .map((font) => ({
        alias: font.family,
        src: resolveRuntimeAssetUrl(font.url, options),
      }));

    if (fonts.length === 0) return;

    // 先使用原生 FontFace API 加载，这对 Canvas 渲染中文字体最稳健
    const assetFallbackFonts: typeof fonts = [];
    for (const f of fonts) {
      try {
        this.logRuntimeDiagnostic(`[ReaderApp] Native loading: ${f.alias} from ${f.src}`);
        const fontFace = new FontFace(f.alias, `url(${f.src})`);
        const loadedFace = await fontFace.load();
        (document as any).fonts.add(loadedFace);
        this.logRuntimeDiagnostic(`[ReaderApp] Font ${f.alias} registered via FontFace API.`);
        this.loadedFontFamilies.add(f.alias);
      } catch (e) {
        console.warn(`[ReaderApp] Native load failed for ${f.alias}, will try Pixi Assets:`, e);
        assetFallbackFonts.push(f);
      }
    }

    if (assetFallbackFonts.length === 0) return;

    assetFallbackFonts.forEach((f) => {
      this.logRuntimeDiagnostic(
        `[ReaderApp] Registering font asset: alias="${f.alias}", src="${f.src}"`,
      );
      Assets.add({ alias: f.alias, src: f.src });
    });

    try {
      this.logRuntimeDiagnostic("[ReaderApp] Assets.load fallback sequence starting...");
      const loaded = await Assets.load(assetFallbackFonts.map((f) => f.alias));
      this.logRuntimeDiagnostic(
        "[ReaderApp] Font fallback assets loaded successfully:",
        Object.keys(loaded),
      );
      assetFallbackFonts.forEach((f) => this.loadedFontFamilies.add(f.alias));
    } catch (e) {
      console.warn(
        "[ReaderApp] Font loading failed, falling back to system fonts.",
        e,
      );
    }
  }

  private logRuntimeDiagnostic(message: string, details?: unknown) {
    if (!this.shouldInstallRenderDebugProbes()) return;
    if (details === undefined) {
      console.info(message);
    } else {
      console.info(message, details);
    }
  }

  public installRenderDebugProbes(container: HTMLElement, reason = "manual") {
    if (!this.shouldInstallRenderDebugProbes()) return;

    this.markCanvasForDebug();
    this.installDomRenderProbe(container, reason);
    this.installPixiRenderProbe(reason);

    console.info("[KmdRuntimeProbe] Render probes installed.", {
      reason,
      domProbe: Boolean(this.domRenderProbe?.isConnected),
      pixiProbe: Boolean(this.pixiRenderProbe?.parent),
      screen: {
        width: this.pixiApp.screen.width,
        height: this.pixiApp.screen.height,
      },
      canvas: {
        width: this.pixiApp.canvas?.width,
        height: this.pixiApp.canvas?.height,
        cssWidth: this.pixiApp.canvas?.style.width,
        cssHeight: this.pixiApp.canvas?.style.height,
      },
    });
  }

  private shouldInstallRenderDebugProbes() {
    const runtimeConfig = (globalThis as any).KmdRuntimeConfig;
    if (runtimeConfig?.debugOverlay === true || runtimeConfig?.settings?.debugOverlay === true) {
      return true;
    }

    try {
      const params = new URLSearchParams(globalThis.location?.search ?? "");
      return params.get("kmdDebugProbe") === "1";
    } catch {
      return false;
    }
  }

  private installDomRenderProbe(container: HTMLElement, reason: string) {
    const computedPosition = globalThis.getComputedStyle?.(container).position ?? "";
    if (!container.style.position && (!computedPosition || computedPosition === "static")) {
      container.style.position = "relative";
    }

    if (!this.domRenderProbe) {
      this.domRenderProbe = document.createElement("div");
      this.domRenderProbe.setAttribute("data-kmd-runtime-probe", "dom");
      this.domRenderProbe.style.cssText = [
        "position:absolute",
        "left:24px",
        "right:24px",
        "top:42%",
        "z-index:2147483647",
        "pointer-events:none",
        "min-height:56px",
        "padding:10px 12px",
        "border:4px solid #00e5ff",
        "background:#fff100",
        "color:#111111",
        "font:800 16px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        "letter-spacing:0",
        "border-radius:4px",
        "box-shadow:0 0 0 4px rgba(255,0,128,0.9)",
      ].join(";");
    }

    this.domRenderProbe.textContent = `KMD DOM probe ${reason} ${globalThis.innerWidth}x${globalThis.innerHeight}`;
    if (this.domRenderProbe.parentElement !== container) {
      container.appendChild(this.domRenderProbe);
    }
  }

  private installPixiRenderProbe(reason: string) {
    if (!this.pixiRenderProbe) {
      this.pixiRenderProbe = new Graphics();
      this.pixiRenderProbe.name = "kmd-runtime-pixi-render-probe";
      this.pixiRenderProbe.eventMode = "none";
    }

    this.pixiApp.stage.addChild(this.pixiRenderProbe);
    this.drawPixiRenderProbe(reason);

    if (!this.pixiRenderProbeResizeHandler) {
      this.pixiRenderProbeResizeHandler = () => {
        this.drawPixiRenderProbe("resize");
      };
      this.pixiApp.renderer.on("resize", this.pixiRenderProbeResizeHandler);
    }
  }

  private drawPixiRenderProbe(reason: string) {
    if (!this.pixiRenderProbe) return;

    const screenWidth = this.pixiApp.screen.width || 0;
    const screenHeight = this.pixiApp.screen.height || 0;
    const width = Math.max(120, Math.min(220, screenWidth * 0.46));
    const height = Math.max(76, Math.min(130, screenHeight * 0.16));
    const x = Math.max(12, (screenWidth - width) / 2);
    const y = Math.max(96, (screenHeight - height) / 2);

    this.pixiRenderProbe
      .clear()
      .rect(x, y, width, height)
      .fill({ color: 0x00ff66, alpha: 1 })
      .rect(x + 12, y + 12, Math.max(1, width - 24), Math.max(1, height - 24))
      .fill({ color: 0xff2bd6, alpha: 1 })
      .rect(x, y, width, height)
      .stroke({ color: 0xffffff, width: 6, alpha: 1 });

    console.info("[KmdRuntimeProbe] Pixi probe redrawn.", {
      reason,
      x,
      y,
      width,
      height,
      stageChildren: this.pixiApp.stage.children.length,
    });
  }

  private markCanvasForDebug() {
    if (!this.shouldInstallRenderDebugProbes()) return;
    const canvas = this.pixiApp.canvas;
    if (!canvas) return;

    canvas.style.outline = "6px solid #ff0033";
    canvas.style.outlineOffset = "-6px";
    canvas.style.background = "#00331a";
    canvas.style.position = "relative";
    canvas.style.zIndex = "1";
    console.info("[KmdRuntimeProbe] Canvas marked.", {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.style.width,
      cssHeight: canvas.style.height,
      display: canvas.style.display,
      outline: canvas.style.outline,
    });
  }

  // 销毁（用于组件卸载时）
  public destroy() {
    // 这里的处理视情况而定，通常单例App不轻易销毁，
    // 但如果路由切换需要释放资源，可以调用 this.pixiApp.destroy()
  }
}

export type ReaderAppInitOptions = RuntimeAssetContext;

export const readerApp = ReaderApp.getInstance();
