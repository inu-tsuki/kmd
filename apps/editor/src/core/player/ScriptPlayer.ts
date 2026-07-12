import { Container } from "pixi.js";
import { readerApp } from "../App";
import { parser } from "../parser/Parser";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import type { KMDMetadata, KMDParagraphData } from "../parser/types";
import type { Segment, ParagraphUnit } from "../state/Segment";
import { ScriptBuildReporter } from "./ScriptBuildReporter";
import { ScriptSourceLoader } from "./ScriptSourceLoader";
import { stageManager } from "../stage/StageManager";
import { PlaybackController, type PlaybackRuntimeState } from "./PlaybackController";
import { SegmentBuilder } from "./SegmentBuilder";
import { TextBuildContextResolver } from "../render/text/TextBuildContextResolver";
import type {
  ReaderRuntimeCallbacks,
  ReaderRuntimeTimelineMarker,
  ReaderRuntimeTypography,
} from "../runtime";
import gsap from "gsap";

export interface ScriptPlayerConfig {
  mode?: string;
  designWidth?: number;
  designHeight?: number;
  typography?: ReaderRuntimeTypography;
}

export class ScriptPlayer {
  private container: Container;
  private metadata: KMDMetadata = {};
  public paragraphs: KMDParagraphData[] = [];
  public rawParagraphs: string[] = [];
  private activeTexts: KineticText[] = [];
  private currentMode: "stage" | "scroll" | "page" = "stage";
  private config: ScriptPlayerConfig = {};
  private runtimeCallbacks: ReaderRuntimeCallbacks = {};
  private timelineMarkers: ReaderRuntimeTimelineMarker[] = [];

  // ═══════════════════════════════════════════════════════════
  //  Segment-based 播放引擎 (Phase A)
  // ═══════════════════════════════════════════════════════════
  private segment: Segment | null = null;
  private playbackState: PlaybackRuntimeState = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [],
    onTimeUpdate: (timeMs) => {
      this.emitProgress({ timeMs });
    },
    onLineUpdate: (line) => {
      this.emitProgress({ line });
    },
    onPlaybackComplete: () => {
      this.emitPlaybackState("ended", false);
    },
  };

  // Legacy 字段 (保留给向后兼容的方法)
  private autoPlayTimer: any = null;

  constructor(container: Container) {
    this.container = container;
  }

  public setRuntimeCallbacks(callbacks: ReaderRuntimeCallbacks = {}) {
    this.runtimeCallbacks = callbacks;
  }

  private get workId() {
    return this.metadata.title || "editor-script";
  }

  private emitProgress(update: { timeMs?: number; line?: number }) {
    const durationMs = this.segment ? this.segment.duration * 1000 : undefined;
    const progress = durationMs && update.timeMs !== undefined && durationMs > 0
      ? Math.max(0, Math.min(1, update.timeMs / durationMs))
      : 0;

    this.runtimeCallbacks.onProgress?.({
      workId: this.workId,
      progress,
      timeMs: update.timeMs,
      durationMs,
      line: update.line,
    });
  }

  private emitPlaybackState(state: "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error", isPlaying: boolean) {
    this.runtimeCallbacks.onPlaybackStateChanged?.({
      workId: this.workId,
      isPlaying,
      state,
    });
  }

  private scheduleRenderDiagnostics(reason: string, delays: number[]) {
    if (!this.shouldLogRenderDiagnostics()) return;
    this.logRenderDiagnostics(`${reason}:now`);
    delays.forEach((delay) => {
      globalThis.setTimeout?.(() => {
        this.logRenderDiagnostics(`${reason}:${delay}ms`);
      }, delay);
    });
  }

  private shouldLogRenderDiagnostics() {
    const runtimeConfig = (globalThis as any).KmdRuntimeConfig;
    if (runtimeConfig?.debugOverlay === true || runtimeConfig?.settings?.debugOverlay === true) {
      return true;
    }

    try {
      const params = new URLSearchParams(globalThis.location?.search ?? "");
      return params.get("kmdDebugProbe") === "1" || params.get("kmdRuntimeDiag") === "1";
    } catch {
      return false;
    }
  }

  private logRenderDiagnostics(reason: string) {
    try {
      const app = readerApp.pixiApp;
      const renderer = app.renderer as any;
      const canvas = app.canvas as HTMLCanvasElement | undefined;
      const gl = renderer?.gl ?? renderer?.context?.gl;
      const charGroups = this.activeTexts.map((text) => (
        ((text as any)._displayAssembly?.chars ?? []) as any[]
      ));
      const chars = charGroups.flat();
      const sampleChars = chars
        .filter((char) => String(char.text ?? "").trim().length > 0)
        .slice(0, 3)
        .map((char) => ({
          text: String(char.text ?? ""),
          visible: Boolean(char.visible),
          renderable: Boolean(char.renderable),
          alpha: Number(char.alpha ?? 0).toFixed(3),
          animAlpha: Number(char.animOffset?.alpha ?? 0).toFixed(3),
          x: Number(char.x ?? 0).toFixed(1),
          y: Number(char.y ?? 0).toFixed(1),
          layoutX: Number(char.layoutX ?? 0).toFixed(1),
          layoutY: Number(char.layoutY ?? 0).toFixed(1),
          fill: String((char.style as any)?.fill ?? ""),
        }));

      const snapshot = {
        reason,
        workId: this.workId,
        mode: this.currentMode,
        durationMs: this.durationMs,
        app: {
          initialized: readerApp.isInitialized,
          screen: {
            width: app.screen.width,
            height: app.screen.height,
          },
          canvas: {
            width: canvas?.width,
            height: canvas?.height,
            cssWidth: canvas?.style.width,
            cssHeight: canvas?.style.height,
          },
        },
        renderer: {
          type: renderer?.type,
          name: renderer?.name,
          webGLVersion: renderer?.context?.webGLVersion,
          limits: {
            maxTextures: renderer?.limits?.maxTextures,
            maxBatchableTextures: renderer?.limits?.maxBatchableTextures,
            maxUniformBindings: renderer?.limits?.maxUniformBindings,
          },
          maxTextureUnits: gl?.getParameter?.(gl.MAX_TEXTURE_IMAGE_UNITS),
          maxCombinedTextureUnits: gl?.getParameter?.(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
          contextLost: gl?.isContextLost?.(),
        },
        environment: {
          userAgent: globalThis.navigator?.userAgent,
          devicePixelRatio: globalThis.devicePixelRatio,
        },
        stage: {
          stageChildren: app.stage.children.length,
          contentLayerChildren: this.container.children.length,
        },
        text: {
          activeTexts: this.activeTexts.length,
          chars: chars.length,
          visibleChars: chars.filter((char) => char.visible).length,
          alphaChars: chars.filter((char) => Number(char.alpha ?? 0) > 0.01).length,
          animAlphaChars: chars.filter((char) => Number(char.animOffset?.alpha ?? 0) > 0.01).length,
          sampleChars,
        },
      };

      console.info(`[KmdRuntimeDiag] ${JSON.stringify(snapshot)}`);
    } catch (error) {
      console.warn("[KmdRuntimeDiag] failed", error);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Load & Build
  // ═══════════════════════════════════════════════════════════

  public async load(kmdSource: string) {
    ScriptBuildReporter.beginBuildSession();
    stageManager.clearAuditSnapshot();
    this.emitPlaybackState("loading", false);
    // 先清旧 segment（INV-4: stop-before-build）。editorStore.ts:140 外部已 stop，
    // 但 runtime 公共入口不保证——ScriptPlayer 层兜底。loadSourceContent 同理。
    // suppressIdle：stop 会发 idle，但 load 流程已发 loading → idle → ready 会让宿主 UI 闪烁。
    await this.stop({ suppressIdle: true });
    let finalSource = kmdSource;
    try {
      finalSource = (await ScriptSourceLoader.resolve(kmdSource)).source;
    } catch (err) {
      ScriptBuildReporter.reportLoadFailure(kmdSource, err);
      this.emitPlaybackState("error", false);
      this.runtimeCallbacks.onError?.({
        workId: this.workId,
        code: "SOURCE_LOAD_FAILED",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
      return;
    }

    await this.loadFinalSource(finalSource);
  }

  public async loadSourceContent(source: string) {
    ScriptBuildReporter.beginBuildSession();
    stageManager.clearAuditSnapshot();
    this.emitPlaybackState("loading", false);
    // 先清旧 segment：释放旧 timeline、显示对象、behavior ticker/filter、entrance filter、
    // stage modifier。若不先清，连续两次 loadScript 会让旧 timeline/对象/资源残留 stage/GPU/ticker。
    // 编辑器包装层（ReaderCanvas.vue）在调用前已 stop，但 runtime 公共入口（loadScript/loadSource
    // 经 protocol dispatch）不保证——此处在 ScriptPlayer 层兜底，保证"先清旧再建新"不变量。
    // suppressIdle：stop 会发 idle，但 load 流程已发 loading → idle → ready 会让宿主 UI 闪烁。
    await this.stop({ suppressIdle: true });
    await this.loadFinalSource(source);
  }

  private async loadFinalSource(finalSource: string) {
    const result = parser.parse(finalSource);
    ScriptBuildReporter.reportParseResult(result, result.metadata.mode ?? this.currentMode);

    this.metadata = result.metadata;
    this.paragraphs = result.paragraphs;
    this.rawParagraphs = result.rawParagraphs;
    if (this.metadata.mode) this.setMode(this.metadata.mode);

    stageManager.setDesignResolution(
      this.metadata.designWidth || this.config.designWidth || 1920,
      this.metadata.designHeight || this.config.designHeight || 1080
    );

    if (this.metadata.variables) {
      Object.entries(this.metadata.variables).forEach(([k, v]) => {
        const val = Number(v);
        layout.globalMarkers.set(`var.${k}`, { x: val, y: val });
      });
    }

    // Phase A: 构建 Segment（替代旧的 bakeAll）
    this.segment = await this.buildSegment();

    const durationMs = this.segment.duration * 1000; // 秒→毫秒
    this.runtimeCallbacks.onReady?.({
      workId: this.workId,
      durationMs,
      timelineMarkers: this.timelineMarkers,
    });
    this.scheduleRenderDiagnostics("after-build", [250]);
    this.emitProgress({ timeMs: 0 });
    this.emitPlaybackState("ready", false);
    ScriptBuildReporter.reportSegmentBuilt(this.segment);
  }

  /**
   * Phase A 核心：构建 Segment
   *
   * 将所有段落的 KineticText + TextPlayer.buildTimeline() 合成到一个
   * 统一的 gsap.Timeline 中。Timeline 支持 seek(t) 实现即时跳转。
   *
   * 关键设计：
   * - stagePresets 返回的 Tween 在创建和 captureTween 之间是同步的，
   *   GSAP 不会在同一 tick 内渲染，所以 camera 状态不会被改变。
   * - 所有 KineticText 实例在 build 阶段就创建好并挂到 container。
   * - 字符初始 visible=false，由 Timeline 中的 tl.set() 在正确时间点显示。
   */
  private async buildSegment(): Promise<Segment> {
    const buildResult = await SegmentBuilder.build({
      container: this.container,
      metadata: this.metadata,
      paragraphs: this.paragraphs,
      rawParagraphs: this.rawParagraphs,
      currentMode: this.currentMode,
      playbackState: this.playbackState,
    });

    this.timelineMarkers = buildResult.timelineMarkers;
    this.runtimeCallbacks.onTimelineChanged?.(this.timelineMarkers);
    this.activeTexts = buildResult.activeTexts;
    return buildResult.segment;
  }

  // ═══════════════════════════════════════════════════════════
  //  Playback Control
  // ═══════════════════════════════════════════════════════════

  /**
   * 开始/恢复播放
   */
  public playSegment() {
    if (!this.segment) return;
    PlaybackController.playSegment(this.segment, this.playbackState);
    this.scheduleRenderDiagnostics("after-play", [100, 500, 1500]);
    this.emitPlaybackState("playing", true);
  }

  /**
   * 暂停播放
   */
  public pauseSegment() {
    if (!this.segment) return;
    PlaybackController.pauseSegment(this.segment, this.playbackState);
    this.emitPlaybackState("paused", false);
  }

  /**
   * 精确时间跳转 (秒)
   *
   * Timeline.seek() 让 GSAP 自动插值所有动画到目标时间的中间状态，
   * 包括字符入场、舞台 Tween (cam.move 等)。
   * Behavior 特效通过 registerBehaviors() 重新注册。
   * Stage modifier（cam.shake/cam.drift）在 seek 前清掉——cam.drift 无 tween、
   * modifier 永久残留，seek 离开后不清会持续（INV: stage modifier 在 seek 清理）。
   * 注意：seek 不调 loadState——camera position 由时间线插值恢复，不应重置。
   */
  public seekToTime(seconds: number) {
    stageManager.clearModifiers();
    PlaybackController.seekToTime(this.segment, seconds, this.playbackState);
    // R7-1：seek 落点 = ended（progress>=1）必须落地 ended 状态，而非只"读"判定阻止 resume。
    // F-2 的 derivePhase 只识别"现在哪种状态"，没有路径把识别出的 ended 写回——
    // isAutoPlaying 仍 true（§B-bis：GSAP seek(duration) 不触发 onComplete 不改它）、
    // segmentTl 不 pause、emitPlaybackState("ended") 不发 → UI/宿主以为还在播。
    // settled ended 后：onPlaybackComplete 复用自然播完的链路（设 isAutoPlaying=false + pause + emit ended）。
    const phase = PlaybackController.derivePhase(this.segment, this.playbackState);
    if (phase === "ended") {
      this.settleEnded();
      return;
    }
    // F-2：resume 条件过 derivePhase 单一真相源（phase === "playing" = isAutoPlaying && progress<1），
    // 不散落 `isAutoPlaying && progress<1` 字面量。
    // - playing（isAutoPlaying && progress<1）：seek 落在播放中 → resume playSegment（live replay，R5-1）。
    // - paused（!isAutoPlaying && progress<1）：不 resume，seek 停留（暂停态）。
    if (phase === "playing") {
      this.playSegment();
    }
  }

  /**
   * R7-1：把"已达结尾"状态落地为 ended（seek 到尾、自然播完共用）。
   *
   * 与 SegmentBuilder 的 segmentTl.onComplete 对称（自然播完路径）：设 isAutoPlaying=false、
   * 显式 pause（BUG-14：播完不 pause 则 seek 后会从该处继续推进）、emit ended。
   * seek 到尾时 §B-bis：GSAP seek(duration) 不触发 onComplete，故需此路径显式落地——
   * 否则 derivePhase 识别出 ended 但状态没写回，isAutoPlaying 仍 true、不发 ended，
   * 后续 playSegment（对 ended 是 restart 语义）会从 0 重播。
   *
   * 集中此逻辑避免 seek 路径与 onComplete 路径各写一份 ended 落地（INV-7 同构：状态落地单一真相源）。
   */
  private settleEnded() {
    if (!this.segment) return;
    this.playbackState.isAutoPlaying = false;
    this.segment.timeline.pause();
    this.emitPlaybackState("ended", false);
  }

  // ═══════════════════════════════════════════════════════════
  //  Public API (兼容旧接口)
  // ═══════════════════════════════════════════════════════════

  /**
   * 跳转到指定段落（兼容旧接口）
   * 内部转为 seekToTime
   */
  public async seekTo(index: number) {
    if (!this.segment || index < 0 || index >= this.segment.paragraphs.length) return;
    const unit = this.segment.paragraphs[index];
    if (!unit) return;

    if (this.shouldLogRenderDiagnostics()) {
      console.log(`[ScriptPlayer] seekTo(p[${index}]) -> seekToTime(${unit.offsetInSegment.toFixed(2)}s)`);
    }
    this.seekToTime(unit.offsetInSegment);

    // seekToTime 内部已按 isAutoPlaying 恢复 playSegment（R5-1），此处不再重复 resume。
  }

  public get getMetadata() {
    return this.metadata;
  }

  public get mode() {
    return this.currentMode;
  }

  public get durationMs() {
    return this.segment ? this.segment.duration * 1000 : 0;
  }

  public updateConfig(config: ScriptPlayerConfig) {
    this.config = {
      ...this.config,
      ...config,
      typography: {
        ...this.config.typography,
        ...config.typography,
      },
    };
    if (config.mode) {
      this.setMode(config.mode as any);
    }
    if (config.typography) {
      TextBuildContextResolver.configure({ typography: config.typography });
    }
    if (config.designWidth || config.designHeight) {
      stageManager.setDesignResolution(
        config.designWidth || this.metadata.designWidth || 1920,
        config.designHeight || this.metadata.designHeight || 1080
      );
    }
  }

  /** Rebuilds rendered text for host typography without replacing the runtime session. */
  public async rebuildForTypography() {
    const segment = this.segment;
    if (!segment) return;
    const time = segment.timeline.time();
    const wasPlaying = this.playbackState.isAutoPlaying;
    await this.stop({ suppressIdle: true });
    this.segment = await this.buildSegment();
    this.seekToTime(time);
    if (wasPlaying && this.segment) {
      PlaybackController.playSegment(this.segment, this.playbackState);
    }
  }

  public setMode(mode: "stage" | "scroll" | "page") {
    this.currentMode = mode;
    stageManager.setMode(mode === "stage" ? "stage" : "scroll");
  }

  public async stop(options?: { suppressIdle?: boolean }) {
    this.playbackState.isAutoPlaying = false;
    clearTimeout(this.autoPlayTimer);

    if (this.segment) {
      this.segment.timeline.pause();
      this.segment.timeline.seek(0);
      this.segment.timeline.kill();

      // F1: 重置 layout 和 stage 到入口状态，防止重播时 Y 偏移
      layout.reset();
      stageManager.loadState(this.segment.entryCheckpoint.stage);
      // 清理 stage modifier（cam.shake/cam.drift 等）：loadState 只 restore camera +
      // killTweensOf，不 clearModifiers。cam.shake 的 modifier 靠 tween onComplete 移除，
      // kill timeline 后 onComplete 不触发 → 残留；cam.drift 无 tween、modifier 永久残留。
      stageManager.clearModifiers();
    }

    PlaybackController.clearBehaviors(this.playbackState);
    // 先销毁 instant filter 实例（释放 GPU 资源），再 destroy 文本容器
    // （§B-bis：Pixi v8 Container.destroy 不自动销毁 target.filters 中的 filter）
    PlaybackController.clearInstantEffects(this.playbackState);
    // 入场特效 filter（blurIn 等）：从 segment.entranceFilters 清理，必须在 segment = null 之前。
    PlaybackController.clearEntranceFilters(this.segment);

    // 清理显示对象
    this.activeTexts.forEach(kt => kt.destroy({ children: true }));
    this.activeTexts = [];
    this.segment = null;
    this.timelineMarkers = [];
    this.runtimeCallbacks.onTimelineChanged?.([]);
    this.emitProgress({ timeMs: 0 });
    // suppressIdle：load/loadSourceContent 在 stop 前已发 loading，stop 的 idle 会让宿主 UI
    // 闪烁（loading → idle → ready）。非 load 路径正常发 idle。
    if (!options?.suppressIdle) {
      this.emitPlaybackState("idle", false);
    }
  }

  public async dispose() {
    await this.stop();
    this.setRuntimeCallbacks({});
  }

  public async clearScreen() {
    if (this.activeTexts.length === 0) return;
    // 与 stop 对称：先 kill 时间线（释放入场 tween + 防止 orphan tween 动画已 destroy
    // 的 target），再清理 behavior/instant/entrance filter，最后 fade destroy 文本容器。
    // 置空 segment——clearScreen 已 kill timeline + destroy 所有显示对象，segment 引用的
    // 是死对象，后续 playSegment/seekToTime/next 用它会崩。与 stop 对齐。
    if (this.segment) {
      this.segment.timeline.pause();
      this.segment.timeline.kill();
      // F1: 重置 layout 和 stage 到入口状态（与 stop 对称）
      layout.reset();
      stageManager.loadState(this.segment.entryCheckpoint.stage);
      stageManager.clearModifiers();
    }

    PlaybackController.clearBehaviors(this.playbackState);
    // 先销毁 instant filter 实例（释放 GPU 资源），再 destroy 文本容器
    // （§B-bis：Pixi v8 Container.destroy 不自动销毁 target.filters 中的 filter）
    PlaybackController.clearInstantEffects(this.playbackState);
    // 入场特效 filter（blurIn 等）：从 segment.entranceFilters 清理。
    PlaybackController.clearEntranceFilters(this.segment);

    this.activeTexts.forEach(kt => kt.stop());
    await Promise.all(this.activeTexts.map(kt =>
      gsap.to(kt, { alpha: 0, duration: 0.3 })
        .then(() => {
          // killTweensOf 兜底：防止 fade tween 被 stop()/clearScreen() 并发打断后 orphan。
          gsap.killTweensOf(kt);
          kt.destroy({ children: true });
        })
    ));
    this.activeTexts = [];
    this.segment = null;
    this.timelineMarkers = [];
    this.runtimeCallbacks.onTimelineChanged?.([]);
    this.emitProgress({ timeMs: 0 });
    this.emitPlaybackState("idle", false);
  }

  /**
   * 下一段落（兼容旧接口 — 在 Segment 模式下跳到下一段的起始位置）
   */
  public async next(force: boolean = false) {
    if (!this.segment) return;

    // 找到当前时间所在的段落
    const currentTimeS = this.segment.timeline.time();
    let nextUnit: ParagraphUnit | null = null;

    for (const pu of this.segment.paragraphs) {
      if (pu.offsetInSegment > currentTimeS + 0.01) {
        nextUnit = pu;
        break;
      }
    }

    if (nextUnit) {
      this.seekToTime(nextUnit.offsetInSegment);
      if (this.playbackState.isAutoPlaying || force) {
        this.playSegment();
      }
    } else {
      if (this.shouldLogRenderDiagnostics()) {
        console.log("[ScriptPlayer] No more paragraphs to advance to.");
      }
    }
  }

  public get autoPlay(): boolean {
    return this.playbackState.isAutoPlaying;
  }

  /**
   * 设置播放速度（timeScale）
   */
  public setTimeScale(speed: number) {
    if (this.segment) {
      this.segment.timeline.timeScale(speed);
    }
  }

  /**
   * 切换自动播放
   */
  public toggleAutoPlay(force?: boolean) {
    const shouldPlay = force ?? !this.playbackState.isAutoPlaying;
    if (shouldPlay) {
      this.playSegment();
    } else {
      this.pauseSegment();
    }
  }
}

export const scriptPlayer = new ScriptPlayer(stageManager.contentLayer);
