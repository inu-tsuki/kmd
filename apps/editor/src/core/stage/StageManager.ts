import { Container, Graphics, Sprite, Assets, Texture } from "pixi.js";
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
  private _bgSprite: Sprite | null = null;
  private _bgSpriteUrl: string | null = null;
  // Bug 7: 纪元号——并发 bg(src) 时丢弃过期 resolve
  private _bgEpoch = 0;
  private _pendingBgUnloads: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // Bug 6: 背景就绪回调——:bg filter target 解析在 build 期同步发生，Assets.load 异步 resolve
  // 晚于 build。注册回调后，sprite 加载完成时通知调用方（SegmentBuilder 可据此延后 apply）。
  //
  // SA-46: 原为 Set<fn>，但每次 seek 注册的是不同闭包实例 → Set 无法按内容去重。
  // bg 未 resolve 时连续 seek 两次，两个闭包都留在 set 中，resolve 后全部执行 →
  // 同一 behavior/instant 被 apply 两次，产生重复 filter + ticker。
  // 改为 Map<id, fn>，onBackgroundReady 返回 { cancel } 句柄；PlaybackController 在
  // 每次 seek/play 周期开头取消上一轮的 pending 句柄，保证同一 record 只 apply 一次。
  private _bgReadyCallbacks: Map<number, (sprite: Sprite) => void> = new Map();
  private _bgReadyNextId = 0;
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
    this.setBackgroundSprite(null);
    this._bgReadyCallbacks.clear();
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
      backgroundColor: this._bgColor,
      bgSpriteUrl: this._bgSpriteUrl,  // Bug 4: 快照背景图 URL 供 restore 重新加载
    };
  }

  /**
   * 加载状态快照
   */
  public loadState(state: StageState) {
    stageRuntime.restoreState(state.camera, state.cameraOffset);
    this.presentation.loadState(state);
    this.setBackgroundColor(state.backgroundColor);

    // Bug 4: 恢复背景图——若快照有 bgSpriteUrl 则重新加载（异步）。
    // 若快照无 bgSpriteUrl 但当前有 sprite，清除（恢复到无背景图状态）。
    if (state.bgSpriteUrl) {
      this.loadBackgroundFromUrl(state.bgSpriteUrl);
    } else {
      // 恢复到无图 checkpoint 时也要取消待 resolve 的 bg(src)。
      // stop 可能发生在 Assets.load resolve 前，此时 _bgSprite 仍为 null。
      this.setBackgroundSprite(null);
    }

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

  public getRegisteredNames(): string[] { return stageRuntime.getRegisteredNames(); }

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

  // B2/B3: 背景图精灵管理。bg(src) 加载图片 cover-fit 后通过此方法挂到 backgroundLayer；
  // :bg filter 路由通过 getBackgroundSprite() 获取当前精灵作为 DIP filter target。
  public getBackgroundSprite(): Sprite | null {
    return this._bgSprite;
  }

  // Bug 3: 不在 destroy 时销毁 texture——Assets 缓存可能被同 URL 复用。
  // 改用 Assets.unload(url) 释放缓存引用；sprite 自身的 texture 引用在 destroy({ texture: false }) 时断开。
  // Bug 6: sprite 加载完成后触发 _bgReadyCallbacks，通知等待中的 :bg filter apply。
  public setBackgroundSprite(
    sprite: Sprite | null,
    url?: string | null,
    options?: { unloadTexture?: boolean },
  ) {
    const previousUrl = this._bgSpriteUrl;
    if (this._bgSprite) {
      this.backgroundLayer.removeChild(this._bgSprite);
      this._bgSprite.destroy({ children: true, texture: false });
      // Bug 3: 释放旧 URL 的 Assets 缓存引用；同 URL 替换时不能卸载，因为新 sprite
      // 通常复用同一 Texture。卸载同 URL 会让新背景丢纹理，只剩 renderer clear color。
      if (sprite !== null && previousUrl && previousUrl !== url) {
        this.scheduleBackgroundUnload(previousUrl);
      }
    }
    // SA-40: 清除 sprite 时推进纪元，使任何待 resolve 的异步 Assets.load 丢弃。
    // 否则 bg(src) 启动异步加载 → bg(color) 同步清除 sprite → 异步 resolve 到达时
    // epoch 仍匹配 → sprite 被重新挂上，bg(color) 的清除被静默撤销。
    if (sprite === null) {
      this._bgEpoch++;
      this._bgReadyCallbacks.clear();
      if (previousUrl && options?.unloadTexture !== false) {
        this.scheduleBackgroundUnload(previousUrl);
      }
    }
    this._bgSprite = sprite;
    this._bgSpriteUrl = url ?? null;
    if (sprite) {
      if (url) this.cancelBackgroundUnload(url);
      this.backgroundLayer.addChild(sprite);
      // Bug 6: 通知等待中的 :bg filter apply
      for (const cb of this._bgReadyCallbacks.values()) {
        cb(sprite);
      }
      this._bgReadyCallbacks.clear();
    }
  }

  // Bug 6: 注册背景就绪回调。若 sprite 已存在则立即调用；否则存入 Map，加载完成后触发。
  // SegmentBuilder / PlaybackController 在 :bg target 解析时调用此方法注册延后 apply 回调。
  //
  // SA-46: 返回 { cancel } 句柄。bg 未 resolve 时连续 seek 会多次注册不同闭包；旧 Set 无法
  // 去重这些闭包，resolve 后全部执行导致重复 apply。PlaybackController 在每次周期开头取消
  // 上一轮的 pending 句柄，保证同一 record 只 apply 一次。
  public onBackgroundReady(callback: (sprite: Sprite) => void): { cancel: () => void } {
    if (this._bgSprite) {
      callback(this._bgSprite);
      return { cancel: () => {} };
    }
    const id = this._bgReadyNextId++;
    this._bgReadyCallbacks.set(id, callback);
    return {
      cancel: () => { this._bgReadyCallbacks.delete(id); },
    };
  }

  // Bug 7: 纪元号守卫——并发 bg(src) 时，仅最新纪元的 resolve 生效。
  public nextBgEpoch(): number {
    return ++this._bgEpoch;
  }

  public get currentBgEpoch(): number {
    return this._bgEpoch;
  }

  /**
   * SA-46: 清除所有 pending 的 onBackgroundReady 回调（不推进纪元、不动 sprite）。
   *
   * seek 时 registerBehaviors/registerInstantEffects 会重新注册 :bg 延后 apply。
   * 若不清除，build 期注册的回调（sprite 未 resolve 时仍留在 map）与 seek 路径的回调
   * 共存，resolve 后全部执行导致重复 apply。PlaybackController.clearPendingBgCallbacks
   * 调此方法统一清空，保证每轮 seek 只有一组 :bg apply 闭包。
   */
  public clearBgReadyCallbacks() {
    this._bgReadyCallbacks.clear();
  }

  // Bug 4: bg sprite URL 快照——seek/restore 时通过 URL 重新加载图片恢复背景。
  public get bgSpriteUrl(): string | null {
    return this._bgSpriteUrl;
  }

  // 共享的背景图加载逻辑（stagePresets bg preset + loadState restore 复用）。
  // 返回纪元号供调用方做过期判断（Bug 7）。
  public loadBackgroundFromUrl(url: string): number {
    this.cancelBackgroundUnload(url);
    const epoch = this.nextBgEpoch();
    Assets.load(url)
      .then((texture: Texture) => {
        if (this.currentBgEpoch !== epoch) return;  // Bug 7: 过期 resolve 丢弃
        const sprite = new Sprite(texture);
        const dw = this.designWidth;
        const dh = this.designHeight;
        const scale = Math.max(dw / texture.width, dh / texture.height);
        sprite.scale.set(scale);
        sprite.anchor.set(0.5);
        sprite.x = dw / 2;
        sprite.y = dh / 2;
        this.setBackgroundSprite(sprite, url);
      })
      .catch((err: any) => {
        if (this.currentBgEpoch !== epoch) return;
        console.error("[StageManager] failed to load background image:", url, err);
      });
    return epoch;
  }

  private scheduleBackgroundUnload(url: string) {
    if (this._pendingBgUnloads.has(url)) return;
    const timer = setTimeout(() => {
      this._pendingBgUnloads.delete(url);
      if (this._bgSpriteUrl === url) return;
      Assets.unload(url).catch(() => {});
    }, 0);
    this._pendingBgUnloads.set(url, timer);
  }

  private cancelBackgroundUnload(url: string) {
    const timer = this._pendingBgUnloads.get(url);
    if (!timer) return;
    clearTimeout(timer);
    this._pendingBgUnloads.delete(url);
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
