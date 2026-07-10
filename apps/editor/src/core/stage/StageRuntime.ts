import gsap from "gsap";
import { RuntimeValueResolver } from "../runtime/RuntimeValueResolver";
import type { StageAuditPort } from "./StageAudit";
import type {
  CameraState,
  StageCommandMetadata,
  StageCommandMetadataMap,
} from "./types";

export type CameraModifier = (time: number) => Partial<CameraState>;
export type StageEffectFunction = (params: any) => void | gsap.core.Tween | gsap.core.Timeline | Promise<void>;
export type StageDesignMetrics = { width: number; height: number };
export type StageSceneClearHandler = () => void | gsap.core.Tween | gsap.core.Timeline;

/**
 * Owns mutable stage execution state. Host/presentation concerns stay in StageManager.
 */
export class StageRuntime {
  public camera: CameraState = { x: 0, y: 0, zoom: 1, rotation: 0 };
  public cameraOffset: CameraState = { x: 0, y: 0, zoom: 1, rotation: 0 };
  public buildMode = false;

  private modifiers: Map<string, CameraModifier> = new Map();
  private registry: Map<string, StageEffectFunction> = new Map();
  private metadataRegistry: Map<string, StageCommandMetadata> = new Map();
  // R6-2：modifier-based stage 特效的衰减 tween（如 cam.shake 的 state.s→0 tween）。
  // clearModifiers 须一并 kill，否则旧 tween 的 onComplete（removeModifier）会在新 modifier
  // 注册后误删它。key = modifier name，value = gsap tween（§B-bis：kill 释放逐帧驱动 + 阻止 onComplete）。
  private modifierTweens: Map<string, gsap.core.Tween | gsap.core.Timeline> = new Map();
  private getDesignMetrics: () => StageDesignMetrics;
  private getAuditPort: () => StageAuditPort;
  private sceneClearHandler: StageSceneClearHandler | null = null;

  constructor(options: {
    getDesignMetrics: () => StageDesignMetrics;
    getAuditPort: () => StageAuditPort;
  }) {
    this.getDesignMetrics = options.getDesignMetrics;
    this.getAuditPort = options.getAuditPort;
  }

  public setDesignMetricsProvider(provider: () => StageDesignMetrics) {
    this.getDesignMetrics = provider;
  }

  public setAuditPortProvider(provider: () => StageAuditPort) {
    this.getAuditPort = provider;
  }

  public get designWidth() {
    return this.getDesignMetrics().width;
  }

  public get designHeight() {
    return this.getDesignMetrics().height;
  }

  public getSnapshot(): CameraState {
    return {
      x: this.camera.x,
      y: this.camera.y,
      zoom: this.camera.zoom,
      rotation: this.camera.rotation,
    };
  }

  public restoreState(camera: CameraState, cameraOffset?: CameraState) {
    this.camera = { ...camera };
    this.cameraOffset = cameraOffset
      ? { ...cameraOffset }
      : { x: 0, y: 0, zoom: 1, rotation: 0 };
  }

  public addModifier(name: string, mod: CameraModifier) {
    this.modifiers.set(name, mod);
  }

  /**
   * R6-2：注册 modifier 衰减 tween，clearModifiers 时一并 kill。cam.shake 的衰减 tween 的
   * onComplete 会 removeModifier——若不清 tween，旧 tween 完成时会误删 seek/resume 后新建的
   * 同名 modifier。key = modifier name（与 addModifier 对齐），同 name 的新 tween 覆盖旧（kill 旧的）。
   */
  public registerModifierTween(name: string, tween: gsap.core.Tween | gsap.core.Timeline) {
    const existing = this.modifierTweens.get(name);
    if (existing) existing.kill();
    this.modifierTweens.set(name, tween);
  }

  public removeModifier(name: string) {
    this.modifiers.delete(name);
    // R6-2：removeModifier（含 cam.shake tween onComplete 自删）时一并 kill + 清 tween 记录，
    // 防止已完成的 tween 记录残留 / 仍在跑的 tween 在 modifier 已移除后继续驱动 state.s。
    const tween = this.modifierTweens.get(name);
    if (tween) {
      tween.kill();
      this.modifierTweens.delete(name);
    }
  }

  public clearModifiers() {
    this.modifiers.clear();
    // R6-2：清 modifier 时 kill 所有衰减 tween。不 kill 则旧 tween 的 onComplete 会在
    // clearModifiers 后（新 modifier 已注册）误删它。kill 阻止 onComplete + 释放逐帧驱动。
    for (const tween of this.modifierTweens.values()) {
      tween.kill();
    }
    this.modifierTweens.clear();
  }

  public register(name: string, fn: StageEffectFunction) {
    this.registry.set(name, fn);
  }

  public registerBatch(presets: Record<string, StageEffectFunction>) {
    Object.entries(presets).forEach(([k, v]) => this.register(k, v));
  }

  public registerMetadata(name: string, metadata: StageCommandMetadata) {
    this.metadataRegistry.set(name, metadata);
  }

  public registerMetadataBatch(metadata: StageCommandMetadataMap) {
    Object.entries(metadata).forEach(([k, v]) => this.registerMetadata(k, v));
  }

  public has(name: string): boolean {
    return this.registry.has(name);
  }

  // 供 IntelliSense/诊断枚举命令名，避免外部强转访问私有 registry
  public getRegisteredNames(): string[] {
    return Array.from(this.registry.keys());
  }

  public getMetadata(name: string): StageCommandMetadata | null {
    return this.metadataRegistry.get(name) ?? null;
  }

  public setSceneClearHandler(handler?: StageSceneClearHandler) {
    this.sceneClearHandler = handler ?? null;
  }

  public runSceneClear() {
    return this.sceneClearHandler?.() ?? gsap.timeline();
  }

  public resolveValue(val: any, fallback: number): number {
    return RuntimeValueResolver.resolveNumeric(val, fallback);
  }

  public apply(name: string, params: any): any {
    const fn = this.registry.get(name);
    if (!fn) return;

    const before = this.getSnapshot();
    const resolvedParams: any = {};
    Object.entries(params || {}).forEach(([key, val]) => {
      // 非数值参数（如 cam.shake 的 static:true、嵌套对象）原样透传，不走 resolveNumeric——
      // R3 修复：原逻辑对**所有** params 调 resolveValue，boolean true → fallback 0 →
      // `p.static === true` 恒为 false（seek 静态重放失效）。仅数值/字符串参数才数值化。
      // bg-fix：字符串参数若既非 var/marker 引用又非数字（如 URL、hex 色值），resolveNumeric
      // 会把它替换成 fallback 0，丢失原始字符串 → bg(src="...") 的 src 变成 0 → startsWith 崩溃。
      // 改为：先尝试引用解析，再 parseFloat；若两者都不命中，保留原始字符串透传。
      if (typeof val === "string") {
        const referenced = RuntimeValueResolver.resolveReference(val);
        if (referenced !== undefined) {
          resolvedParams[key] = referenced;
        } else if (!Number.isNaN(parseFloat(val))) {
          resolvedParams[key] = this.resolveValue(val, (before as any)[key] ?? 0);
        } else {
          resolvedParams[key] = val;
        }
      } else if (typeof val === "number") {
        resolvedParams[key] = this.resolveValue(val, (before as any)[key] ?? 0);
      } else {
        resolvedParams[key] = val;
      }
    });

    const target = { ...before };
    if (name === "cam.move") {
      target.x = resolvedParams.x ?? resolvedParams[0] ?? before.x;
      target.y = resolvedParams.y ?? resolvedParams[1] ?? before.y;
    } else if (name === "cam.zoom") {
      target.zoom = resolvedParams.val ?? resolvedParams[0] ?? before.zoom;
    }

    this.getAuditPort().record({
      time: new Date().toLocaleTimeString(),
      effect: name,
      params: { ...resolvedParams },
      cameraBefore: before,
      cameraTarget: target,
      overwriteWarning: gsap.getTweensOf(this.camera).length > 0,
      worldState: {
        centerX: this.designWidth / 2 + before.x,
        centerY: this.designHeight / 2 + before.y,
      },
    });

    return fn(resolvedParams);
  }

  public resolveComposedCameraState(time: number): CameraState {
    let finalX = this.camera.x + this.cameraOffset.x;
    let finalY = this.camera.y + this.cameraOffset.y;
    let finalZoom = this.camera.zoom * this.cameraOffset.zoom;
    let finalRotation = this.camera.rotation + this.cameraOffset.rotation;

    this.modifiers.forEach((mod) => {
      const offset = mod(time);
      if (offset.x !== undefined) finalX += offset.x;
      if (offset.y !== undefined) finalY += offset.y;
      if (offset.zoom !== undefined) finalZoom *= offset.zoom;
      if (offset.rotation !== undefined) finalRotation += offset.rotation;
    });

    return {
      x: finalX,
      y: finalY,
      zoom: finalZoom,
      rotation: finalRotation,
    };
  }
}
