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
  private modifiers: Map<string, CameraModifier> = new Map();

  public designWidth: number = 1920;
  public designHeight: number = 1080;
  public isFixedRatio: boolean = false;
  private _viewport = { offsetX: 0, offsetY: 0, baseScale: 1 };

  private registry: Map<string, StageEffectFunction> = new Map();
  public camAuditLog: any[] = [];

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
    const stage = readerApp.pixiApp.stage;
    stage.addChild(this.world);
    stage.addChild(this.uiLayer);
    stage.addChild(this.letterbox);
    this.resize();
    readerApp.pixiApp.renderer.on("resize", () => this.resize());
    readerApp.pixiApp.ticker.add(this.update, this);
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

  public setMode(mode: "stage" | "scroll") {
    this.isFixedRatio = mode === "stage";
    gsap.killTweensOf(this.camera);
    if (this.isFixedRatio) {
      layout.maxWidth = this.designWidth * 0.8;
      this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 1; this.camera.rotation = 0;
    } else {
      gsap.to(this.camera, { x: 0, y: 0, zoom: 1, rotation: 0, duration: 0.5 });
    }
    this.resize();
  }

  public dumpCamReport() {
    fetch("http://localhost:9999/cam", {
      method: "POST",
      body: JSON.stringify(this.camAuditLog, null, 2),
      headers: { "Content-Type": "application/json" }
    });
  }

  private resize() {
    const screenW = readerApp.pixiApp.screen.width;
    const screenH = readerApp.pixiApp.screen.height;
    if (!this.isFixedRatio) {
      this._viewport = { offsetX: 0, offsetY: 0, baseScale: 1 };
      this.letterbox.clear();
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
  }

  private update() {
    const { baseScale: vs } = this._viewport;
    let finalX = this.camera.x, finalY = this.camera.y, finalZoom = this.camera.zoom, finalRotation = this.camera.rotation;
    const time = performance.now();
    this.modifiers.forEach(mod => {
      const offset = mod(time);
      if (offset.x !== undefined) finalX += offset.x;
      if (offset.y !== undefined) finalY += offset.y;
      if (offset.zoom !== undefined) finalZoom *= offset.zoom;
      if (offset.rotation !== undefined) finalRotation += offset.rotation;
    });

    if (this.isFixedRatio) {
      this.world.scale.set(vs * finalZoom);
      this.world.rotation = finalRotation;
      this.world.pivot.set((this.designWidth / 2) + finalX, (this.designHeight / 2) + finalY);
      this.world.position.set(readerApp.pixiApp.screen.width / 2, readerApp.pixiApp.screen.height / 2);
    } else {
      this.world.scale.set(1); this.world.rotation = 0; this.world.pivot.set(0, 0); this.world.position.set(0, 0);
    }
  }
}

export const stageManager = new StageManager();

import { initStagePresets } from "./stagePresets";
initStagePresets();