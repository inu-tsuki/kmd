import { Container, Graphics } from "pixi.js";
import { auditBus } from "../diagnostics/AuditBus";
import { layout } from "../layout/LayoutEngine";
import { RuntimeValueResolver } from "../runtime/RuntimeValueResolver";
import { UnifiedStageAuditPort, type StageAuditPort } from "./StageAudit";
import { StageHostSession } from "./StageHostSession";
import { PresentationManager } from "./PresentationManager";
import type { ReaderHost } from "./ReaderHost";
import { stageRuntime } from "./StageRuntimeInstance";
import type { CameraModifier, StageEffectFunction, StageSceneClearHandler } from "./StageRuntime";
import gsap from "gsap";
import type {
  CameraState,
  StageAuditEntry,
  StageAuditSnapshot,
  StageCommandMetadata,
  StageCommandMetadataMap,
  StageConflictDiagnostic,
  StageMode,
  StageState,
} from "./types";

class StageManager {
  public world: Container;
  public backgroundLayer: Container;
  public contentLayer: Container;
  public uiLayer: Container;
  private letterbox: Graphics;

  private presentation = new PresentationManager();
  private hostSession: StageHostSession;
  private _bgColor: string | number = 0x000000;
  private auditPort: StageAuditPort = new UnifiedStageAuditPort();

  constructor() {
    this.world = new Container();
    this.backgroundLayer = new Container();
    this.contentLayer = new Container();
    this.uiLayer = new Container();
    this.letterbox = new Graphics();
    this.world.addChild(this.backgroundLayer);
    this.world.addChild(this.contentLayer);
    this.hostSession = new StageHostSession({
      world: this.world,
      uiLayer: this.uiLayer,
      letterbox: this.letterbox,
      presentation: this.presentation,
      resolveComposedCameraState: (time) => stageRuntime.resolveComposedCameraState(time),
      getBackgroundColor: () => this._bgColor,
    });
    stageRuntime.setDesignMetricsProvider(() => ({
      width: this.presentation.designWidth,
      height: this.presentation.designHeight,
    }));
    stageRuntime.setAuditPortProvider(() => this.auditPort);
  }

  public attachHost(host: ReaderHost) {
    this.hostSession.attachHost(host);
  }

  public detachHost() {
    this.hostSession.detachHost();
  }

  public init(host?: ReaderHost) {
    this.hostSession.init(host);
  }

  public disposeSession() {
    gsap.killTweensOf(stageRuntime.camera);
    gsap.killTweensOf(stageRuntime.cameraOffset);
    stageRuntime.buildMode = false;
    stageRuntime.clearModifiers();
    stageRuntime.setSceneClearHandler(undefined);
    stageRuntime.restoreState(
      { x: 0, y: 0, zoom: 1, rotation: 0 },
      { x: 0, y: 0, zoom: 1, rotation: 0 },
    );
    this.contentLayer.removeChildren();
    this.hostSession.dispose();
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
    this.hostSession.refresh();
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

  public getAuditSnapshot(): StageAuditSnapshot {
    return {
      entries: this.auditPort.getEntries(),
      conflicts: this.auditPort.getConflicts(),
    };
  }

  public clearAuditSnapshot() {
    this.auditPort.clear();
  }

  /**
   * @deprecated 兼容期 getter。未来请改用 `getAuditSnapshot().entries`。
   */
  public get camAuditLog(): StageAuditEntry[] {
    return this.getAuditSnapshot().entries;
  }

  /**
   * @deprecated 兼容期 getter。未来请改用 `getAuditSnapshot().conflicts`。
   */
  public get stageConflictDiagnostics(): StageConflictDiagnostic[] {
    return this.getAuditSnapshot().conflicts;
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

  public registerMetadata(name: string, metadata: StageCommandMetadata) {
    stageRuntime.registerMetadata(name, metadata);
  }

  public registerMetadataBatch(metadata: StageCommandMetadataMap) {
    stageRuntime.registerMetadataBatch(metadata);
  }

  public has(name: string): boolean { return stageRuntime.has(name); }

  public getCommandMetadata(name: string): StageCommandMetadata | null {
    return stageRuntime.getMetadata(name);
  }

  public apply(name: string, params: any): any { return stageRuntime.apply(name, params); }

  public setDesignResolution(width: number, height: number) {
    this.presentation.setDesignResolution(width, height);
    this.hostSession.refresh();
  }

  public setBackgroundColor(color: string | number) {
    this._bgColor = color;
    this.hostSession.syncBackgroundColor(color);
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
    this.hostSession.refresh();
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
    const snapshot = this.getAuditSnapshot();
    console.warn("[StageManager] dumpCamReport() is deprecated; prefer unified audit export.");
    auditBus.emit({
      phase: "runtime",
      subsystem: "stage",
      severity: "warn",
      payload: {
        event: "stage.audit.dump",
        entryCount: snapshot.entries.length,
        conflictCount: snapshot.conflicts.length,
      },
    });
    return snapshot.entries;
  }
}

export const stageManager = new StageManager();

import { stageCommandMetadata, stagePresets } from "./stagePresets";
stageManager.registerBatch(stagePresets);
stageManager.registerMetadataBatch(stageCommandMetadata);
export type { CameraState, StageAuditEntry, StageAuditSnapshot, StageConflictDiagnostic, StageMode, StageState } from "./types";
export type { CameraModifier, StageEffectFunction } from "./StageRuntime";
