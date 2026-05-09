import { Container, Graphics } from "pixi.js";
import { auditBus } from "../diagnostics/AuditBus";
import type { ReaderHost } from "./ReaderHost";
import type { PresentationManager } from "./PresentationManager";
import type { CameraState } from "./types";

interface StageHostSessionOptions {
  world: Container;
  uiLayer: Container;
  letterbox: Graphics;
  presentation: PresentationManager;
  resolveComposedCameraState: (time: number) => CameraState;
  getBackgroundColor: () => string | number;
}

export class StageHostSession {
  private options: StageHostSessionOptions;
  private host: ReaderHost | null = null;
  private isInitialized = false;
  private hostDisposers: Array<() => void> = [];

  constructor(options: StageHostSessionOptions) {
    this.options = options;
  }

  public attachHost(host: ReaderHost) {
    this.clearHostBindings();
    this.host = host;
    this.host.setBackgroundColor(this.options.getBackgroundColor());
    auditBus.emit({
      phase: "runtime",
      subsystem: "stage_host",
      severity: "info",
      payload: {
        event: "stage.host.attached",
      },
    });

    if (this.isInitialized) {
      this.host.mountStage(this.options.world, this.options.uiLayer, this.options.letterbox);
      this.refresh();
      this.bindHostListeners();
    }
  }

  public init(host?: ReaderHost) {
    if (host) {
      this.attachHost(host);
    }
    if (this.isInitialized) {
      return;
    }
    if (!this.host) {
      console.warn("[StageManager] init() called without a ReaderHost.");
      return;
    }

    this.host.mountStage(this.options.world, this.options.uiLayer, this.options.letterbox);
    this.refresh();
    this.bindHostListeners();
    this.isInitialized = true;

    auditBus.emit({
      phase: "runtime",
      subsystem: "stage_host",
      severity: "info",
      payload: {
        event: "stage.host.initialized",
      },
    });
  }

  public syncBackgroundColor(color: string | number) {
    this.host?.setBackgroundColor(color);
  }

  public refresh() {
    this.resize();
  }

  private resize() {
    if (!this.host) {
      return;
    }

    const { width: screenW, height: screenH } = this.host.getScreenSize();
    const viewport = this.options.presentation.updateViewport(screenW, screenH);

    if (!this.options.presentation.isFixedRatio) {
      this.options.letterbox.clear();
      this.options.world.scale.set(1);
      this.options.world.rotation = 0;
      this.options.world.position.set(0, 0);
      this.options.world.pivot.set(0, 0);
      this.emitViewportAudit(screenW, screenH, viewport, false);
      return;
    }

    const { offsetX, offsetY } = viewport;

    this.options.letterbox.clear().fill({ color: 0x000000 });
    if (offsetY > 0) {
      this.options.letterbox
        .rect(0, 0, screenW, offsetY)
        .rect(0, screenH - offsetY, screenW, offsetY);
    }
    if (offsetX > 0) {
      this.options.letterbox
        .rect(0, 0, offsetX, screenH)
        .rect(screenW - offsetX, 0, offsetX, screenH);
    }
    this.options.letterbox.fill();

    this.updateWorldTransform();
    this.emitViewportAudit(screenW, screenH, viewport, true);
  }

  private updateWorldTransform = () => {
    if (!this.options.presentation.isFixedRatio) {
      return;
    }

    const { baseScale, offsetX, offsetY } = this.options.presentation.viewport;
    const composed = this.options.resolveComposedCameraState(performance.now());

    this.options.world.scale.set(baseScale * composed.zoom);
    this.options.world.rotation = composed.rotation;
    this.options.world.pivot.set(
      (this.options.presentation.designWidth / 2) + composed.x,
      (this.options.presentation.designHeight / 2) + composed.y,
    );
    this.options.world.position.set(
      offsetX + (this.options.presentation.designWidth * baseScale) / 2,
      offsetY + (this.options.presentation.designHeight * baseScale) / 2,
    );
  };

  private bindHostListeners() {
    if (!this.host) {
      return;
    }
    this.hostDisposers.push(this.host.onResize(() => this.resize()));
    this.hostDisposers.push(this.host.addTicker(this.updateWorldTransform));
  }

  private clearHostBindings() {
    this.hostDisposers.forEach((dispose) => dispose());
    this.hostDisposers = [];
  }

  private emitViewportAudit(
    screenWidth: number,
    screenHeight: number,
    viewport: { offsetX: number; offsetY: number; baseScale: number },
    fixedRatio: boolean,
  ) {
    auditBus.emit({
      phase: "runtime",
      subsystem: "stage_host",
      severity: "info",
      payload: {
        event: "stage.viewport.updated",
        screenWidth,
        screenHeight,
        fixedRatio,
        viewport,
      },
    });
  }
}
