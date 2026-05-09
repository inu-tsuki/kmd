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

  public removeModifier(name: string) {
    this.modifiers.delete(name);
  }

  public clearModifiers() {
    this.modifiers.clear();
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
      if (["duration", "d", "2"].includes(key) || (name !== "cam.move" && key === "1")) {
        resolvedParams[key] = this.resolveValue(val, 0);
      } else {
        resolvedParams[key] = this.resolveValue(val, (before as any)[key] ?? 0);
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
