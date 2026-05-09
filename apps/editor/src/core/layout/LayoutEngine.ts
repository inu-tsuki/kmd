import { Container } from "pixi.js";
import { auditBus } from "../diagnostics/AuditBus";
import { KineticText } from "../KineticText";
import type { KineticTextOptions } from "../KineticText";
import type { MarkerMap, LayoutAuditRecord } from "./types";
import { TextLayoutEngine } from "./TextLayoutEngine";
import { stageManager } from "../stage/StageManager";
import { readerLayoutHostView } from "./ReaderLayoutHostView";
import type { LayoutHostView } from "./LayoutHostView";
import gsap from "gsap";

export interface LayoutState {
  currentY: number;
  globalMarkers: Record<string, { x: number; y: number }>;
  targetScrollY: number;
}

class LayoutEngine {
  currentY: number = 0;
  public maxWidth: number = 800;
  private paragraphSpacing: number = 20;
  private startY: number = 100;
  container: Container | null = null;

  public enableManualScroll = true;
  public globalMarkers: MarkerMap = new Map();

  private hostView: LayoutHostView = readerLayoutHostView;
  private isEventsBound = false;

  /** Replace the reader host before init when running layout outside the default Pixi app. */
  public setHostView(hostView: LayoutHostView) {
    this.hostView = hostView;
  }

  public init(container: Container, startY: number = 100) {
    // 核心修复：如果容器已经一致，说明是布局重排，严禁重置状态
    if (this.container === container) {
      this.recenterAll();
      return;
    }

    this.container = container;
    this.startY = startY;
    this.maxWidth = this.hostView.getScreenSize().width * 0.8;
    this.reset(); // 仅在初次或容器变更时重置

    if (!this.isEventsBound) {
      this.hostView.onUpdate(() => this.update());
      this.hostView.onResize(() => {
        this.recenterAll();
      });
      this.isEventsBound = true;
    }
  }

  /**
   * 导出布局状态快照
   */
  public dumpState(): LayoutState {
    const markersObj: Record<string, { x: number; y: number }> = {};
    this.globalMarkers.forEach((val, key) => {
      markersObj[key] = { ...val };
    });

    return {
      currentY: this.currentY,
      targetScrollY: this.targetScrollY,
      globalMarkers: markersObj
    };
  }

  /**
   * 加载布局状态快照
   */
  public loadState(state: LayoutState) {
    this.currentY = state.currentY;
    this.targetScrollY = state.targetScrollY;

    this.globalMarkers.clear();
    Object.entries(state.globalMarkers).forEach(([key, val]) => {
      this.globalMarkers.set(key, { ...val });
    });

    if (this.container) {
      this.container.y = this.targetScrollY;
    }
  }

  private async recenterAll() {
    if (!this.container) return;

    // 1. Stage 模式保护：演戏模式下，坐标体系由设计分辨率锁定，禁止重排
    // 缩放由 StageManager 的 CSS/Matrix 变换处理
    if (stageManager.isFixedRatio) return;

    // 2. Scroll 模式：执行弹性流式布局 (Reflow)
    const screenW = this.hostView.getScreenSize().width;

    // 计算新的最大宽度 (响应式)
    const newMaxWidth = screenW * 0.8;
    const needsRebuild = Math.abs(newMaxWidth - this.maxWidth) > 10; // 增加容差，防止微小抖动

    // 记录新的全局最大宽度
    this.maxWidth = newMaxWidth;

    let flowY = this.startY;

    for (const child of this.container.children) {
      if (child instanceof KineticText && child.isAutoLayout) {
        // A. 如果宽度剧变，执行内部重排
        if (needsRebuild) {
          await child.rebuild({ maxWidth: newMaxWidth });
          child.logicalHeight = child.getLayoutHeight();
        }

        // B. 校准水平位置
        const blockWidth = child.getLayoutWidth();
        const align = (child as any)._options.align || 'left';

        if (align === 'center') {
          child.x = (screenW - blockWidth) / 2;
        } else if (align === 'right') {
          child.x = screenW - blockWidth - (screenW * 0.1);
        } else {
          child.x = screenW * 0.1;
        }

        // C. 校准垂直堆叠
        child.y = flowY;
        const step = child.logicalHeight || child.getLayoutHeight();
        flowY += step + this.paragraphSpacing;
      }
    }

    // 同步累加器
    this.currentY = flowY;
  }

  private targetScrollY: number = 0;

  /**
   * 重置排版引擎状态
   * @param clearVariables 是否连同文件头定义的变量一起清除 (默认为 false)
   */
  public reset(clearVariables: boolean = false) {
    this.currentY = this.startY;
    this.targetScrollY = 0;

    if (clearVariables) {
      this.globalMarkers.clear();
    } else {
      // 仅清理非变量标记 (即清理那些不以 var. 开头的运行时 Marker)
      for (const key of this.globalMarkers.keys()) {
        if (!key.startsWith("var.")) {
          this.globalMarkers.delete(key);
        }
      }
    }

    TextLayoutEngine.lastAuditLog = [];
  }

  private updateLineMarkers(posX: number, posY: number, width: number, isNext = false, isCurrent = false) {
    let prefix = isNext ? "next" : "prev";
    if (isCurrent) prefix = "line";
    const markers = this.globalMarkers;
    const start = { x: posX, y: posY };
    const mid = { x: posX + width / 2, y: posY };
    const end = { x: posX + width, y: posY };
    markers.set(`${prefix}.start`, start);
    markers.set(`${prefix}.mid`, mid);
    markers.set(`${prefix}.end`, end);
  }

  public async addLine(kmdString: string, options?: KineticTextOptions): Promise<KineticText> {
    const line = await this.createLine(kmdString, options);
    this.appendLine(line);
    return line;
  }

  public get remainingHeight(): number {
    const screenHeight = stageManager.isFixedRatio ? stageManager.designHeight : this.hostView.getScreenSize().height;
    const bottomPadding = 100;
    return screenHeight - bottomPadding - this.currentY;
  }

  public async createLine(kmdString: string, options?: KineticTextOptions): Promise<KineticText> {
    const logicalScreenWidth = stageManager.isFixedRatio ? stageManager.designWidth : this.hostView.getScreenSize().width;
    const posX = (logicalScreenWidth - this.maxWidth) / 2;

    this.updateLineMarkers(posX, this.currentY, this.maxWidth, false, true);
    this.updateLineMarkers(posX, this.currentY + 60, this.maxWidth, true);

    const finalOptions: KineticTextOptions = {
      maxWidth: this.maxWidth,
      align: "left",
      externalMarkers: this.globalMarkers,
      baseOffset: { x: posX, y: this.currentY },
      ...options,
    };

    const line = new KineticText(finalOptions);
    await line.init(kmdString);

    line.x = posX;
    line.y = this.currentY;
    return line;
  }

  public appendLine(line: KineticText) {
    if (!this.container) return;

    if (Math.abs(line.y - this.currentY) > 0.1) {
      const logicalScreenWidth = stageManager.isFixedRatio ? stageManager.designWidth : this.hostView.getScreenSize().width;
      const posX = (logicalScreenWidth - this.maxWidth) / 2;
      line.x = posX;
      line.y = this.currentY;
      line.rebuild({ baseOffset: { x: posX, y: this.currentY } });
    }

    this.container.addChild(line);
    // line.applyParagraphEffects(); // 由策略模式调用

    const logicalHeight = line.getLayoutHeight();
    line.logicalHeight = logicalHeight; // 持久化
    const logicalWidth = line.getLayoutWidth();
    this.updateLineMarkers(line.x, this.currentY, logicalWidth, false);

    if (logicalHeight > 0) {
      this.currentY += logicalHeight + this.paragraphSpacing;
    }
  }

  public dumpReport(): LayoutAuditRecord[] {
    const logs = TextLayoutEngine.lastAuditLog;
    console.warn("[LayoutEngine] dumpReport() is deprecated; prefer unified audit snapshot.");
    auditBus.emit({
      phase: "layout",
      subsystem: "layout",
      severity: "warn",
      payload: {
        event: "layout.audit.dump",
        recordCount: logs.length,
      },
    });
    return logs;
  }

  private update() {
    if (!this.container || stageManager.isFixedRatio) return;
    const screenHeight = this.hostView.getScreenSize().height;
    const containerY = this.container.y;
    this.container.children.forEach((child) => {
      const absY = child.y + containerY;
      const isVisible = absY + child.height > 0 && absY < screenHeight;
      child.renderable = isVisible;
    });
  }

  public scrollBy(delta: number) {
    if (!this.container || stageManager.isFixedRatio) return;
    if (Math.abs(this.container.y - this.targetScrollY) > 50) {
      this.targetScrollY = this.container.y;
    }
    const newY = this.targetScrollY - delta;
    const minY = -this.currentY + this.hostView.getScreenSize().height;
    const effectiveMin = Math.min(minY, 0);
    this.targetScrollY = Math.max(Math.min(newY, 0), effectiveMin);
    gsap.to(this.container, {
      y: this.targetScrollY,
      duration: 0.5,
      ease: "power2.out",
      overwrite: "auto"
    });
  }
}

export const layout = new LayoutEngine();
