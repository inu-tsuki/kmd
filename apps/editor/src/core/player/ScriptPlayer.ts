import { Container } from "pixi.js";
import { parser } from "../parser/Parser";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import type { KMDMetadata, KMDParagraphData } from "../parser/types";
import type { Segment, ParagraphUnit } from "../state/Segment";
import { ScriptBuildReporter } from "./ScriptBuildReporter";
import { ScriptSourceLoader } from "./ScriptSourceLoader";
import { stageManager } from "../stage/StageManager";
import { useEditorStore } from "../../store/editorStore";
import { PlaybackController, type PlaybackRuntimeState } from "./PlaybackController";
import { SegmentBuilder } from "./SegmentBuilder";
import gsap from "gsap";

export class ScriptPlayer {
  private container: Container;
  private metadata: KMDMetadata = {};
  public paragraphs: KMDParagraphData[] = [];
  public rawParagraphs: string[] = [];
  private activeTexts: KineticText[] = [];
  private currentMode: "stage" | "scroll" | "page" = "stage";

  // ═══════════════════════════════════════════════════════════
  //  Segment-based 播放引擎 (Phase A)
  // ═══════════════════════════════════════════════════════════
  private segment: Segment | null = null;
  private playbackState: PlaybackRuntimeState = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    onTimeUpdate: (timeMs) => {
      const store = useEditorStore();
      store.currentTime = timeMs;
    },
  };

  // Legacy 字段 (保留给向后兼容的方法)
  private autoPlayTimer: any = null;

  constructor(container: Container) {
    this.container = container;
  }

  // ═══════════════════════════════════════════════════════════
  //  Load & Build
  // ═══════════════════════════════════════════════════════════

  public async load(kmdSource: string) {
    ScriptBuildReporter.beginBuildSession();
    stageManager.clearAuditSnapshot();
    let finalSource = kmdSource;
    try {
      finalSource = (await ScriptSourceLoader.resolve(kmdSource)).source;
    } catch (err) {
      ScriptBuildReporter.reportLoadFailure(kmdSource, err);
      return;
    }

    const result = parser.parse(finalSource);
    ScriptBuildReporter.reportParseResult(result, result.metadata.mode ?? this.currentMode);

    this.metadata = result.metadata;
    this.paragraphs = result.paragraphs;
    this.rawParagraphs = result.rawParagraphs;
    if (this.metadata.mode) this.setMode(this.metadata.mode);

    stageManager.setDesignResolution(
      this.metadata.designWidth || 1920,
      this.metadata.designHeight || 1080
    );

    if (this.metadata.variables) {
      Object.entries(this.metadata.variables).forEach(([k, v]) => {
        const val = Number(v);
        layout.globalMarkers.set(`var.${k}`, { x: val, y: val });
      });
    }

    // Phase A: 构建 Segment（替代旧的 bakeAll）
    this.segment = await this.buildSegment();

    const store = useEditorStore();
    store.totalDuration = this.segment.duration * 1000; // 秒→毫秒
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

    const store = useEditorStore();
    store.timelineMarkers = buildResult.timelineMarkers;
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
    PlaybackController.playSegment(this.segment, this.playbackState);
  }

  /**
   * 暂停播放
   */
  public pauseSegment() {
    PlaybackController.pauseSegment(this.segment, this.playbackState);
  }

  /**
   * 精确时间跳转 (秒)
   *
   * Timeline.seek() 让 GSAP 自动插值所有动画到目标时间的中间状态，
   * 包括字符入场、舞台 Tween (cam.move 等)。
   * Behavior 特效通过 registerBehaviors() 重新注册。
   */
  public seekToTime(seconds: number) {
    PlaybackController.seekToTime(this.segment, seconds, this.playbackState);
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

    console.log(`[ScriptPlayer] seekTo(p[${index}]) → seekToTime(${unit.offsetInSegment.toFixed(2)}s)`);
    this.seekToTime(unit.offsetInSegment);

    // 如果之前在播放，继续播放
    if (this.playbackState.isAutoPlaying) {
      this.playSegment();
    }
  }

  public get getMetadata() {
    return this.metadata;
  }

  public get mode() {
    return this.currentMode;
  }

  public updateConfig(config: { mode?: string; designWidth?: number; designHeight?: number }) {
    if (config.mode) {
      this.setMode(config.mode as any);
    }
    if (config.designWidth || config.designHeight) {
      stageManager.setDesignResolution(
        config.designWidth || this.metadata.designWidth || 1920,
        config.designHeight || this.metadata.designHeight || 1080
      );
    }
  }

  public setMode(mode: "stage" | "scroll" | "page") {
    this.currentMode = mode;
    stageManager.setMode(mode === "stage" ? "stage" : "scroll");
  }

  public async stop() {
    this.playbackState.isAutoPlaying = false;
    clearTimeout(this.autoPlayTimer);

    if (this.segment) {
      this.segment.timeline.pause();
      this.segment.timeline.seek(0);

      // F1: 重置 layout 和 stage 到入口状态，防止重播时 Y 偏移
      layout.reset();
      stageManager.loadState(this.segment.entryCheckpoint.stage);
    }

    PlaybackController.clearBehaviors(this.playbackState);

    // 清理显示对象
    this.activeTexts.forEach(kt => kt.destroy({ children: true }));
    this.activeTexts = [];
    this.segment = null;
  }

  public async clearScreen() {
    if (this.activeTexts.length === 0) return;
    this.activeTexts.forEach(kt => kt.stop());
    await Promise.all(this.activeTexts.map(kt =>
      gsap.to(kt, { alpha: 0, duration: 0.3 }).then(() => kt.destroy({ children: true }))
    ));
    this.activeTexts = [];
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
      console.log("[ScriptPlayer] No more paragraphs to advance to.");
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
