import { Container, Graphics } from "pixi.js";
import { layout } from "../layout/LayoutEngine";
import { RuntimeValueResolver } from "../runtime/RuntimeValueResolver";
import { MemoryStageAuditPort, type StageAuditPort } from "./StageAudit";
import { PresentationManager } from "./PresentationManager";
import type { ReaderHost } from "./ReaderHost";
import { stageRuntime } from "./StageRuntimeInstance";
import type { CameraModifier, StageEffectFunction, StageSceneClearHandler } from "./StageRuntime";
import gsap from "gsap";
import type { CameraState, StageAuditEntry, StageConflictDiagnostic, StageMode, StageState } from "./types";

class StageManager {
  public world: Container;
  public backgroundLayer: Container;
  public contentLayer: Container;
  public uiLayer: Container;
  private letterbox: Graphics;

  private presentation = new PresentationManager();
  private host: ReaderHost | null = null;
  private _bgColor: string | number = 0x000000;
  private auditPort: StageAuditPort = new MemoryStageAuditPort();
  private isInitialized = false;
  private hostDisposers: Array<() => void> = [];

  constructor() {
    this.world = new Container();
    this.backgroundLayer = new Container();
    this.contentLayer = new Container();
    this.uiLayer = new Container();
    this.letterbox = new Graphics();
    this.world.addChild(this.backgroundLayer);
    this.world.addChild(this.contentLayer);
    stageRuntime.setDesignMetricsProvider(() => ({
      width: this.presentation.designWidth,
      height: this.presentation.designHeight,
    }));
    stageRuntime.setAuditPortProvider(() => this.auditPort);
  }

  public attachHost(host: ReaderHost) {
    this.clearHostBindings();
    this.host = host;
    this.host.setBackgroundColor(this._bgColor);
    if (this.isInitialized) {
      this.resize();
      this.bindHostListeners();
    }
  }

  public init(host?: ReaderHost) {
    if (host) this.attachHost(host);
    if (this.isInitialized) return;
    if (!this.host) {
      console.warn("[StageManager] init() called without a ReaderHost.");
      return;
    }

    this.host.mountStage(this.world, this.uiLayer, this.letterbox);
    this.resize();
    this.bindHostListeners();

    this.isInitialized = true;
  }

  /**
   * 导出当前完整状态快照
   */
  public dumpState(): StageState {
    return {
      camera: { ...stageRuntime.camera },
      cameraOffset: { ...stageRuntime.cameraOffset },
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
    stageRuntime.restoreState(state.camera, state.cameraOffset);
    this.presentation.loadState(state);
    this.setBackgroundColor(state.backgroundColor);

    gsap.killTweensOf(stageRuntime.camera);
    gsap.killTweensOf(stageRuntime.cameraOffset);
    this.resize();
  }

  /**
   * 暴露给插件的工具：获取当前状态副本
   */
  public getSnapshot(): CameraState {
    return stageRuntime.getSnapshot();
  }

  public get camera() {
    return stageRuntime.camera;
  }

  public get cameraOffset() {
    return stageRuntime.cameraOffset;
  }

  public get buildMode() {
    return stageRuntime.buildMode;
  }

  public set buildMode(value: boolean) {
    stageRuntime.buildMode = value;
  }

  public addModifier(name: string, mod: CameraModifier) { stageRuntime.addModifier(name, mod); }
  public removeModifier(name: string) { stageRuntime.removeModifier(name); }
  public clearModifiers() { stageRuntime.clearModifiers(); }
  public setSceneClearHandler(handler?: StageSceneClearHandler) { stageRuntime.setSceneClearHandler(handler); }

  public resolveValue(val: any, fallback: number): number {
    return RuntimeValueResolver.resolveNumeric(val, fallback);
  }

  public get designWidth() {
    return this.presentation.designWidth;
  }

  public get designHeight() {
    return this.presentation.designHeight;
  }

  public get isFixedRatio() {
    return this.presentation.isFixedRatio;
  }

  public get viewport() {
    return this.presentation.viewport;
  }

  public get camAuditLog(): StageAuditEntry[] {
    return this.auditPort.getEntries();
  }

  public get stageConflictDiagnostics(): StageConflictDiagnostic[] {
    return this.auditPort.getConflicts();
  }

  public setAuditPort(port: StageAuditPort) {
    this.auditPort = port;
    stageRuntime.setAuditPortProvider(() => this.auditPort);
  }

  public reportConflictDiagnostic(diagnostic: StageConflictDiagnostic) {
    this.auditPort.reportConflict(diagnostic);
  }

  public register(name: string, fn: StageEffectFunction) { stageRuntime.register(name, fn); }

  public registerBatch(presets: Record<string, StageEffectFunction>) { stageRuntime.registerBatch(presets); }

  public has(name: string): boolean { return stageRuntime.has(name); }

  public apply(name: string, params: any): any { return stageRuntime.apply(name, params); }

  public setDesignResolution(width: number, height: number) {
    this.presentation.setDesignResolution(width, height);
    this.resize();
  }

  public setBackgroundColor(color: string | number) {
    this._bgColor = color;
    this.host?.setBackgroundColor(color);
  }

  public setMode(mode: StageMode) {
    this.presentation.setMode(mode);
    gsap.killTweensOf(stageRuntime.camera);
    gsap.killTweensOf(stageRuntime.cameraOffset);
    if (this.isFixedRatio) {
      layout.maxWidth = this.designWidth * 0.8;
      stageRuntime.restoreState(
        { x: 0, y: 0, zoom: 1, rotation: 0 },
        { x: 0, y: 0, zoom: 1, rotation: 0 },
      );
    } else {
      gsap.to(stageRuntime.camera, { x: 0, y: 0, zoom: 1, rotation: 0, duration: 0.5 });
      stageRuntime.cameraOffset.x = 0;
      stageRuntime.cameraOffset.y = 0;
      stageRuntime.cameraOffset.zoom = 1;
      stageRuntime.cameraOffset.rotation = 0;
    }
    this.resize();
  }

  public get config() {
    return {
      designWidth: this.designWidth,
      designHeight: this.designHeight,
      isFixedRatio: this.isFixedRatio
    };
  }

  /**
   * @deprecated 兼容期导出入口。未来应改走统一 AuditBus / DiagnosticsCollector。
   */
  public dumpCamReport() {
    console.warn("[StageManager] dumpCamReport() is deprecated; prefer unified audit export.");
    fetch("http://localhost:9999/cam", {
      method: "POST",
      body: JSON.stringify(this.camAuditLog, null, 2),
      headers: { "Content-Type": "application/json" }
    });
  }

  private resize() {
    if (!this.host) return;

    // 使用逻辑像素尺寸 (Screen)，它已经考虑了 resolution 和 autoDensity
    const { width: screenW, height: screenH } = this.host.getScreenSize();
    const viewport = this.presentation.updateViewport(screenW, screenH);

    if (!this.isFixedRatio) {
      this.letterbox.clear();
      this.world.scale.set(1);
      this.world.position.set(0, 0);
      this.world.pivot.set(0, 0);
      return;
    }

    const { offsetX, offsetY } = viewport;

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
    const { baseScale: vs, offsetX, offsetY } = this.viewport;
    if (!this.isFixedRatio) return;

    const composed = stageRuntime.resolveComposedCameraState(performance.now());

    // 核心修正：缩放应该叠加基础比例和相机缩放
    this.world.scale.set(vs * composed.zoom);
    this.world.rotation = composed.rotation;
    // Pivot 依然在设计空间的中心
    this.world.pivot.set((this.designWidth / 2) + composed.x, (this.designHeight / 2) + composed.y);
    // Position 始终对齐画布物理中心
    this.world.position.set(offsetX + (this.designWidth * vs) / 2, offsetY + (this.designHeight * vs) / 2);
  }

  private bindHostListeners() {
    if (!this.host) return;
    this.hostDisposers.push(this.host.onResize(() => this.resize()));
    this.hostDisposers.push(this.host.addTicker(this.update, this));
  }

  private clearHostBindings() {
    this.hostDisposers.forEach((dispose) => dispose());
    this.hostDisposers = [];
  }

  private update() {
    this.updateWorldTransform();
  }
}

export const stageManager = new StageManager();

import { stagePresets } from "./stagePresets";
stageManager.registerBatch(stagePresets);
export type { CameraState, StageAuditEntry, StageConflictDiagnostic, StageMode, StageState } from "./types";
export type { CameraModifier, StageEffectFunction } from "./StageRuntime";
