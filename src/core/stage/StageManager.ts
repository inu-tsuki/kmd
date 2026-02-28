import { Container, Graphics } from "pixi.js";
import { readerApp } from "../App";
import { layout } from "../layout/LayoutEngine";
import gsap from "gsap";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface StageState {
  camera: CameraState;
  /** Timeline 驱动的叠加偏移层（cam.offset 的 Tween 目标） */
  cameraOffset: CameraState;
  designWidth: number;
  designHeight: number;
  isFixedRatio: boolean;
  backgroundColor: string | number;
}

export type CameraModifier = (time: number) => Partial<CameraState>;
export type StageEffectFunction = (params: any) => void | gsap.core.Tween | gsap.core.Timeline | Promise<void>;

class StageManager {
  public world: Container;
  public backgroundLayer: Container;
  public contentLayer: Container;
  public uiLayer: Container;
  private letterbox: Graphics;

  // 状态
  public camera: CameraState = { x: 0, y: 0, zoom: 1, rotation: 0 };
  /** Timeline 驱动的叠加偏移层 — cam.offset 的 Tween 目标，与 camera 独立避免属性冲突 */
  public cameraOffset: CameraState = { x: 0, y: 0, zoom: 1, rotation: 0 };
  /** Build 模式标志：buildSegment() 期间为 true，禁用 overwrite:"auto" 和 immediateRender */
  public buildMode = false;
  private modifiers: Map<string, CameraModifier> = new Map();

  public designWidth: number = 1920;
  public designHeight: number = 1080;
  public isFixedRatio: boolean = false;
  private _viewport = { offsetX: 0, offsetY: 0, baseScale: 1 };
  private _bgColor: string | number = 0x000000;

  private registry: Map<string, StageEffectFunction> = new Map();
  public camAuditLog: any[] = [];
  private isInitialized = false;

  constructor() {
    this.world = new Container();
    this.backgroundLayer = new Container();
    this.contentLayer = new Container();
    this.uiLayer = new Container();
    this.letterbox = new Graphics();
    this.world.addChild(this.backgroundLayer);
    this.world.addChild(this.contentLayer);
  }

  public init() {
    if (this.isInitialized) return;
    
    const stage = readerApp.pixiApp.stage;
    stage.addChild(this.world);
    stage.addChild(this.uiLayer);
    stage.addChild(this.letterbox);
    this.resize();
    readerApp.pixiApp.renderer.on("resize", () => this.resize());
    readerApp.pixiApp.ticker.add(this.update, this);
    
    this.isInitialized = true;
  }

  /**
   * 导出当前完整状态快照
   */
  public dumpState(): StageState {
    return {
      camera: { ...this.camera },
      cameraOffset: { ...this.cameraOffset },
      designWidth: this.designWidth,
      designHeight: this.designHeight,
      isFixedRatio: this.isFixedRatio,
      backgroundColor: this._bgColor
    };
  }

  /**
   * 加载状态快照
   */
  public loadState(state: StageState) {
    this.camera = { ...state.camera };
    this.cameraOffset = state.cameraOffset ? { ...state.cameraOffset } : { x: 0, y: 0, zoom: 1, rotation: 0 };
    this.designWidth = state.designWidth;
    this.designHeight = state.designHeight;
    this.isFixedRatio = state.isFixedRatio;
    this.setBackgroundColor(state.backgroundColor);

    gsap.killTweensOf(this.camera);
    gsap.killTweensOf(this.cameraOffset);
    this.resize();
  }

  /**
   * 暴露给插件的工具：获取当前状态副本
   */
  public getSnapshot(): CameraState {
    return {
      x: this.camera.x,
      y: this.camera.y,
      zoom: this.camera.zoom,
      rotation: this.camera.rotation
    };
  }

  public addModifier(name: string, mod: CameraModifier) { this.modifiers.set(name, mod); }
  public removeModifier(name: string) { this.modifiers.delete(name); }
  public clearModifiers() { this.modifiers.clear(); }

  public resolveValue(val: any, fallback: number): number {
    if (typeof val === "number") return val;
    if (typeof val !== "string") return fallback;
    const markerMatch = val.match(/^([\w-]+)\.([\w-]+)\.([xy])$/);
    if (markerMatch) {
      const [_, name, type, coord] = markerMatch;
      const marker = layout.globalMarkers.get(`${name}.${type}`);
      if (marker) return coord === "x" ? marker.x : marker.y;
    }
    const varMatch = val.match(/^var\.([\w-]+)$/);
    if (varMatch) {
      const varKey = `var.${varMatch[1]}`;
      const variable = layout.globalMarkers.get(varKey);
      if (variable) return variable.x;
    }
    const num = parseFloat(val);
    return isNaN(num) ? fallback : num;
  }

  public register(name: string, fn: StageEffectFunction) {
    this.registry.set(name, fn);
  }

  public has(name: string): boolean {
    return this.registry.has(name);
  }

  public apply(name: string, params: any): any {
    const fn = this.registry.get(name);
    if (fn) {
      const before = this.getSnapshot();
      
      // 参数预解析
      const resolvedParams: any = {};
      Object.entries(params).forEach(([key, val]) => {
        if (["duration", "d", "2"].includes(key) || (name !== "cam.move" && key === "1")) {
           resolvedParams[key] = this.resolveValue(val, 0);
        } else {
           resolvedParams[key] = this.resolveValue(val, (before as any)[key] ?? 0);
        }
      });

      // 简单的审计预测 (仅覆盖核心基础指令)
      const target = { ...before };
      if (name === "cam.move") {
        target.x = resolvedParams.x ?? resolvedParams[0] ?? before.x;
        target.y = resolvedParams.y ?? resolvedParams[1] ?? before.y;
      } else if (name === "cam.zoom") {
        target.zoom = resolvedParams.val ?? resolvedParams[0] ?? before.zoom;
      }

      this.camAuditLog.push({
        time: new Date().toLocaleTimeString(),
        effect: name,
        params: { ...resolvedParams },
        cameraBefore: before,
        cameraTarget: target,
        overwriteWarning: gsap.getTweensOf(this.camera).length > 0,
        worldState: { centerX: this.designWidth / 2 + before.x, centerY: this.designHeight / 2 + before.y }
      });

      // 执行模块化的指令实现
      return fn(resolvedParams);
    }
  }

  public setDesignResolution(width: number, height: number) {
    this.designWidth = width;
    this.designHeight = height;
    this.resize();
  }

  public setBackgroundColor(color: string | number) {
    this._bgColor = color;
    if (readerApp.pixiApp && readerApp.pixiApp.renderer) {
      readerApp.pixiApp.renderer.background.color = color;
    }
  }

  public setMode(mode: "stage" | "scroll") {
    this.isFixedRatio = mode === "stage";
    gsap.killTweensOf(this.camera);
    gsap.killTweensOf(this.cameraOffset);
    if (this.isFixedRatio) {
      layout.maxWidth = this.designWidth * 0.8;
      this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 1; this.camera.rotation = 0;
      this.cameraOffset.x = 0; this.cameraOffset.y = 0; this.cameraOffset.zoom = 1; this.cameraOffset.rotation = 0;
    } else {
      gsap.to(this.camera, { x: 0, y: 0, zoom: 1, rotation: 0, duration: 0.5 });
      this.cameraOffset.x = 0; this.cameraOffset.y = 0; this.cameraOffset.zoom = 1; this.cameraOffset.rotation = 0;
    }
    this.resize();
  }

  public get viewport() {
    return this._viewport;
  }

  public get config() {
    return {
      designWidth: this.designWidth,
      designHeight: this.designHeight,
      isFixedRatio: this.isFixedRatio
    };
  }

  public dumpCamReport() {
    fetch("http://localhost:9999/cam", {
      method: "POST",
      body: JSON.stringify(this.camAuditLog, null, 2),
      headers: { "Content-Type": "application/json" }
    });
  }

  private resize() {
    // 使用逻辑像素尺寸 (Screen)，它已经考虑了 resolution 和 autoDensity
    const screenW = readerApp.pixiApp.screen.width;
    const screenH = readerApp.pixiApp.screen.height;

    if (!this.isFixedRatio) {
      this._viewport = { offsetX: 0, offsetY: 0, baseScale: 1 };
      this.letterbox.clear();
      this.world.scale.set(1);
      this.world.position.set(0, 0);
      this.world.pivot.set(0, 0);
      return;
    }

    const scale = Math.min(screenW / this.designWidth, screenH / this.designHeight);
    const offsetX = (screenW - this.designWidth * scale) / 2;
    const offsetY = (screenH - this.designHeight * scale) / 2;
    this._viewport = { offsetX, offsetY, baseScale: scale };

    this.letterbox.clear().fill({ color: 0x000000 });
    if (offsetY > 0) {
      this.letterbox.rect(0, 0, screenW, offsetY).rect(0, screenH - offsetY, screenW, offsetY);
    }
    if (offsetX > 0) {
      this.letterbox.rect(0, 0, offsetX, screenH).rect(screenW - offsetX, 0, offsetX, screenH);
    }
    this.letterbox.fill();

    this.updateWorldTransform();
  }

  private updateWorldTransform() {
    const { baseScale: vs, offsetX, offsetY } = this._viewport;
    if (!this.isFixedRatio) return;

    // 三层合成：base camera + Timeline offset + Ticker modifiers
    const co = this.cameraOffset;
    let finalX = this.camera.x + co.x;
    let finalY = this.camera.y + co.y;
    let finalZoom = this.camera.zoom * co.zoom;
    let finalRotation = this.camera.rotation + co.rotation;

    const time = performance.now();

    this.modifiers.forEach(mod => {
      const offset = mod(time);
      if (offset.x !== undefined) finalX += offset.x;
      if (offset.y !== undefined) finalY += offset.y;
      if (offset.zoom !== undefined) finalZoom *= offset.zoom;
      if (offset.rotation !== undefined) finalRotation += offset.rotation;
    });

    // 核心修正：缩放应该叠加基础比例和相机缩放
    this.world.scale.set(vs * finalZoom);
    this.world.rotation = finalRotation;
    // Pivot 依然在设计空间的中心
    this.world.pivot.set((this.designWidth / 2) + finalX, (this.designHeight / 2) + finalY);
    // Position 始终对齐画布物理中心
    this.world.position.set(offsetX + (this.designWidth * vs) / 2, offsetY + (this.designHeight * vs) / 2);
  }

  private update() {
    this.updateWorldTransform();
  }
}

export const stageManager = new StageManager();

import { initStagePresets } from "./stagePresets";
initStagePresets();