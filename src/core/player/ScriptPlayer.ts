import { Container } from "pixi.js";
import { parser } from "../parser/Parser";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import { TextPlayer } from "../render/text/TextPlayer";
import { EffectProcessor } from "../effects/EffectProcessor";
import { effectManager } from "../effects/EffectManager";
import { MODIFIER_BASED_COMMANDS } from "../stage/stagePresets";
import type { KMDParseResult, KMDParagraphData } from "../parser/types";
import type { Segment, ParagraphUnit, Checkpoint, InFlightAnimation } from "../state/Segment";
import type { BehaviorRecord, StyleRecord } from "../render/text/TextPlayer";
import { stageManager } from "../stage/StageManager";
import { styleManager } from "../effects/StyleManager";
import { useEditorStore } from "../../store/editorStore";
import gsap from "gsap";

/** A6: 从舞台指令参数中提取 Tween 目标属性和终值 */
function extractTweenTargets(command: string, params: any): Record<string, number> {
  switch (command) {
    case "cam.move":
      return { x: params.x ?? params[0] ?? 0, y: params.y ?? params[1] ?? 0 };
    case "cam.offset":
      return { x: params.x ?? params[0] ?? 0, y: params.y ?? params[1] ?? 0 };
    case "cam.zoom":
      return { zoom: params.val ?? params[0] ?? 1 };
    case "cam.rotate":
      return { rotation: params.val ?? params[0] ?? 0 };
    case "cam.reset":
      return { x: 0, y: 0, zoom: 1, rotation: 0 };
    default:
      return {};
  }
}

/** Property key for stage tween conflict detection */
function getStagePropertyKey(command: string): string | null {
  switch (command) {
    case "cam.move":
    case "cam.focus": return "camera.xy";
    case "cam.zoom": return "camera.zoom";
    case "cam.rotate": return "camera.rotation";
    case "cam.offset": return "offset.xy";
    default: return null;
  }
}

type ActiveStageTweenEntry = {
  tween: gsap.core.Tween | gsap.core.Timeline;
  startPosition: number;
  originalDuration: number;
  ease: string;
  fromValues: Record<string, number>;
  toValues: Record<string, number>;
  target: any;
};

/**
 * Trim an active stage tween to end at cutTime.
 * Removes the original tween from the timeline and inserts a shortened
 * fromTo replacement that ends at the ease-interpolated intermediate values.
 * Returns the intermediate values, or null if the tween had already finished.
 */
function trimActiveStageTween(
  tl: gsap.core.Timeline,
  entry: ActiveStageTweenEntry,
  cutTime: number
): Record<string, number> | null {
  if (cutTime >= entry.startPosition + entry.originalDuration) {
    return null; // Old tween already finished; no conflict
  }
  if (cutTime <= entry.startPosition) {
    tl.remove(entry.tween);
    return { ...entry.fromValues }; // Never started; return initial values
  }
  // Compute intermediate values at cutTime using ease interpolation
  const trimDur = cutTime - entry.startPosition;
  const cutRatio = trimDur / entry.originalDuration;
  const easeFn = gsap.parseEase(entry.ease);
  const progress = easeFn(cutRatio);
  const cutValues: Record<string, number> = {};
  for (const [prop, fromVal] of Object.entries(entry.fromValues)) {
    cutValues[prop] = fromVal + ((entry.toValues[prop] ?? fromVal) - fromVal) * progress;
  }
  // Remove old tween and add trimmed fromTo replacement
  tl.remove(entry.tween);
  const replacement = gsap.fromTo(entry.target,
    { ...entry.fromValues },
    { ...cutValues, duration: trimDur, ease: entry.ease, overwrite: false, immediateRender: false }
  );
  tl.add(replacement, entry.startPosition);
  return cutValues;
}

export class ScriptPlayer {
  private container: Container;
  private metadata: any = {};
  public paragraphs: KMDParagraphData[] = [];
  public rawParagraphs: string[] = [];
  private activeTexts: KineticText[] = [];
  private currentMode: "stage" | "scroll" | "page" = "stage";

  // ═══════════════════════════════════════════════════════════
  //  Segment-based 播放引擎 (Phase A)
  // ═══════════════════════════════════════════════════════════
  private segment: Segment | null = null;
  private activeBehaviorCleanups: Array<{ char: any; modName: string }> = [];

  // Legacy 字段 (保留给向后兼容的方法)
  private isAutoPlaying: boolean = false;
  private autoPlayTimer: any = null;

  constructor(container: Container) {
    this.container = container;
  }

  // ═══════════════════════════════════════════════════════════
  //  Load & Build
  // ═══════════════════════════════════════════════════════════

  public async load(kmdSource: string) {
    let finalSource = kmdSource;
    const looksLikeFilePath = !kmdSource.includes("\n") && (
      kmdSource.endsWith(".kmd") || kmdSource.startsWith("/")
    );
    if (looksLikeFilePath) {
      try {
        const response = await fetch(kmdSource);
        const blob = await response.blob();
        finalSource = await blob.text();
      } catch (err) {
        console.error("[ScriptPlayer] Failed to fetch KMD source:", err);
        return;
      }
    }

    const result: KMDParseResult = parser.parse(finalSource);
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
    console.log(
      `[ScriptPlayer] Segment built. Duration: ${this.segment.duration.toFixed(2)}s, ` +
      `Paragraphs: ${this.segment.paragraphs.length}, ` +
      `Behaviors: ${this.segment.behaviors.length}`
    );
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
    const store = useEditorStore();

    // F1: 防御性重置，确保从 Y=0 开始
    layout.reset();

    const segmentTl = gsap.timeline({ paused: true });
    const allBehaviors: BehaviorRecord[] = [];
    const allStyleRecords: StyleRecord[] = [];
    const paragraphUnits: ParagraphUnit[] = [];
    const markers: any[] = [];
    const stageTweenRecords: InFlightAnimation[] = []; // A6: 跟踪舞台 Tween 元数据

    // 入口 Checkpoint
    const entryCheckpoint: Checkpoint = {
      stage: stageManager.dumpState(),
      layout: layout.dumpState(),
      activeParagraphs: []
    };

    let segmentCursor = 0; // 秒
    let activeParagraphIndices: Array<{ index: number; x: number; y: number }> = [];

    // A6: Build 模式 — 禁用 overwrite:"auto" 和 immediateRender，防止后创建的 Tween 杀死先创建的
    stageManager.buildMode = true;

    // Bug 2 fix: Track active stage tweens for property-conflict trimming.
    // When a new tween targets the same camera property as an in-flight tween,
    // the old tween is trimmed to the new tween's start time to prevent
    // the "flash-jump" when the shorter tween completes and the longer reasserts.
    const activeStageTweens = new Map<string, ActiveStageTweenEntry>();
    const virtualCam = { ...stageManager.camera };
    const virtualOff = { ...stageManager.cameraOffset };

    for (let i = 0; i < this.paragraphs.length; i++) {
      const pData = this.paragraphs[i];
      const rawText = this.rawParagraphs[i];
      if (!pData || rawText === undefined) continue;

      // 向后兼容：保存 snapshot (legacy seekTo 可能仍然用到)
      pData.snapshot = {
        stage: stageManager.dumpState(),
        layout: layout.dumpState(),
        activeParagraphs: [...activeParagraphIndices]
      };

      // ── 场景清除 ──
      const isSceneClear = this.currentMode === "page" || pData.tokens.some(t => t.isSceneClear);
      if (isSceneClear) {
        // 在 Timeline 上隐藏之前所有在场段落
        for (const pu of paragraphUnits) {
          if (activeParagraphIndices.some(ap => ap.index === pu.paragraphIndex)) {
            segmentTl.set(pu.kineticText, { visible: false }, segmentCursor);
          }
        }
        activeParagraphIndices = [];
      }

      // ── 创建 KineticText ──
      const dWidth = stageManager.designWidth;
      const kt = new KineticText({
        maxWidth: this.metadata.maxWidth || dWidth * 0.8,
        ...pData.blockOptions,
        externalMarkers: layout.globalMarkers,
        baseOffset: { x: 0, y: 0 },
      });

      await kt.init(rawText, pData.lineOffset || 0);

      // ── 定位 ──
      const align = pData.blockOptions.align || "left";
      const maxWidth = pData.blockOptions.maxWidth || dWidth * 0.8;
      const dHeight = stageManager.designHeight;
      let posX: number, posY: number;

      if (this.currentMode === "stage" || this.currentMode === "scroll") {
        kt.isAutoLayout = true;
        posX = align === "center" ? (dWidth - maxWidth) / 2 : dWidth * 0.1;
        posY = layout.currentY;
      } else {
        kt.isAutoLayout = false;
        posX = align === "center" ? (dWidth - kt.getLayoutWidth()) / 2 : dWidth * 0.1;
        posY = dHeight * 0.7;
      }

      kt.x = posX;
      kt.y = posY;

      // Rebuild with correct positioning (baseOffset 影响排版中的绝对定位)
      await kt.rebuild({
        baseOffset: { x: posX, y: posY },
        externalMarkers: layout.globalMarkers
      }, pData.lineOffset || 0);

      // ── 段落级 globalEffects → Timeline ──
      const { visualConfigs, stageConfigs } = EffectProcessor.partition(pData.globalEffects);

      // 舞台指令 → Tween 挂到 Segment Timeline
      for (const cfg of stageConfigs) {
        if (cfg.name === "pause") {
          const dur = Number(cfg.params?.duration ?? cfg.params?.d ?? cfg.params?.[0] ?? 1);
          segmentCursor += dur;
        } else if (MODIFIER_BASED_COMMANDS.has(cfg.name)) {
          const cfgCopy = { name: cfg.name, params: { ...(cfg.params || {}) } };
          segmentTl.call(() => {
            stageManager.apply(cfgCopy.name, cfgCopy.params);
          }, [], segmentCursor);
        } else {
          // Bug 2 fix: Trim conflicting in-flight stage tweens before creating new one
          const propKey = getStagePropertyKey(cfg.name);
          if (cfg.name === "cam.reset") {
            // cam.reset conflicts with ALL active stage tweens
            for (const [, entry] of activeStageTweens) {
              trimActiveStageTween(segmentTl, entry, segmentCursor);
            }
            activeStageTweens.clear();
            Object.assign(virtualCam, { x: 0, y: 0, zoom: 1, rotation: 0 });
            Object.assign(virtualOff, { x: 0, y: 0, zoom: 1, rotation: 0 });
          } else if (propKey) {
            const existing = activeStageTweens.get(propKey);
            if (existing) {
              const cutVals = trimActiveStageTween(segmentTl, existing, segmentCursor);
              if (cutVals) {
                Object.assign(propKey.startsWith("offset") ? virtualOff : virtualCam, cutVals);
              }
              activeStageTweens.delete(propKey);
            }
          }

          const result = stageManager.apply(cfg.name, cfg.params);
          this.captureTween(segmentTl, result, segmentCursor);

          // Bug 2 fix: Record new active stage tween for future conflict detection
          if (propKey && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
            const dur = result.duration();
            if (dur > 0) {
              const toValues = extractTweenTargets(cfg.name, cfg.params);
              const vs = propKey.startsWith("offset") ? virtualOff : virtualCam;
              const fromValues: Record<string, number> = {};
              for (const k of Object.keys(toValues)) fromValues[k] = (vs as any)[k] ?? 0;
              activeStageTweens.set(propKey, {
                tween: result,
                startPosition: segmentCursor,
                originalDuration: dur,
                ease: "power2.inOut",
                fromValues,
                toValues,
                target: propKey.startsWith("offset") ? stageManager.cameraOffset : stageManager.camera,
              });
              Object.assign(vs, toValues);
            }
          }

          // A6: 跟踪舞台 Tween 元数据（Phase B 跨 Segment 衔接用）
          if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
            const dur = result.duration();
            if (dur > 0) {
              stageTweenRecords.push({
                command: cfg.name,
                targets: extractTweenTargets(cfg.name, cfg.params),
                totalDuration: dur,
                startTimeInSegment: segmentCursor,
                ease: dur > 0 ? "power2.inOut" : "none",
              });
            }
          }
          // F5: 阻塞指令推进 segmentCursor，使后续段落内容等待动画完成
          if (cfg.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
            segmentCursor += result.duration();
          }
        }
      }

      // 视觉 globalEffects → 回调（bg, border 等组级特效）
      if (visualConfigs.length > 0) {
        const vCopy = [...visualConfigs];
        segmentTl.call(() => {
          EffectProcessor.applyGroupEffects(kt, vCopy);
        }, [], segmentCursor);
      }

      // ── 构建段落子 Timeline ──
      const buildResult = TextPlayer.buildTimeline(
        kt, kt._allCharsCached, kt.tokens,
        { speed: this.metadata.speed }
      );

      // 放到 Segment Timeline 上（不 pause 子 Timeline —— GSAP 3 规则）
      const childCount = buildResult.timeline.getChildren().length;
      if (childCount > 0) {
        segmentTl.add(buildResult.timeline, segmentCursor);
      }
      console.log(
        `[BuildSegment] p[${i}] chars=${kt._allCharsCached.length} ` +
        `tlChildren=${childCount} dur=${buildResult.duration.toFixed(2)}s ` +
        `offset=${segmentCursor.toFixed(2)}s behaviors=${buildResult.behaviors.length}`
      );

      // ── 挂到显示树 ──
      this.container.addChild(kt);
      this.activeTexts.push(kt);

      // 初始隐藏所有字符（Timeline 中的 tl.set(char, {visible:true}) 控制显示时机）
      kt._allCharsCached.forEach(c => { c.visible = false; });
      // KineticText 本身需要可见（场景清除时通过 set visible=false 隐藏）
      kt.visible = true;

      // ── 收集 Behaviors + 前向播放自动激活回调 ──
      for (const b of buildResult.behaviors) {
        const absTime = b.timePosition + segmentCursor;
        allBehaviors.push({
          ...b,
          timePosition: absTime
        });
        // F3: 在 Timeline 上注册回调，前向播放时在正确时间点激活 behavior
        const bChar = b.char;
        const bName = b.effectName;
        const bParams = { ...b.params };
        segmentTl.call(() => {
          if (!this.isAutoPlaying) return; // seek 期间跳过（由 registerBehaviors 处理）
          effectManager.apply(bChar, bName, bParams, true);
          this.activeBehaviorCleanups.push({ char: bChar, modName: bName });
        }, [], absTime);
      }

      // ── 收集 StyleRecords ──
      for (const sr of buildResult.styleRecords) {
        allStyleRecords.push({ ...sr, timePosition: sr.timePosition + segmentCursor });
      }

      // ── 段落单元记录 ──
      const unit: ParagraphUnit = {
        paragraphIndex: i,
        kineticText: kt,
        offsetInSegment: segmentCursor,
        behaviors: buildResult.behaviors,
        duration: buildResult.duration
      };
      paragraphUnits.push(unit);

      // ── Timeline Markers (用于 TimeLordBar 的可视化) ──
      const absStartMs = segmentCursor * 1000;
      pData.absStartTime = absStartMs;
      pData.estimatedDuration = buildResult.duration * 1000;

      pData.tokens.forEach(t => {
        if (t.startTime !== undefined && (t.content.trim() || t.isSceneClear)) {
          const absStart = absStartMs + t.startTime;
          const nextToken = pData.tokens[pData.tokens.indexOf(t) + 1];
          const endTime = nextToken
            ? absStartMs + nextToken.startTime!
            : absStartMs + buildResult.duration * 1000;

          markers.push({
            line: (t.line || 0) + 1,
            startTime: absStart,
            duration: Math.max(50, endTime - absStart),
            content: t.isSceneClear ? "--- SCENE CLEAR ---" : t.content,
            type: t.isSceneClear ? "scene" : "text"
          });
        }
      });

      // ── 步进布局 ──
      activeParagraphIndices.push({ index: i, x: posX, y: posY });
      const h = kt.getLayoutHeight();
      layout.currentY += h + 20;

      // ── 步进 Segment 游标 ──
      if (buildResult.advanceTime !== undefined) {
        // >>> 提前推进：下一段落从 advanceTime 开始（与当前段落并行）
        segmentCursor += buildResult.advanceTime;
      } else {
        segmentCursor += buildResult.duration;
        // 场景清除段落不加呼吸间隔，直接衔接下一段
        if (!isSceneClear) {
          segmentCursor += 2; // 段落间呼吸间隔 (2秒)
        }
      }
    }

    // A6: 关闭 Build 模式
    stageManager.buildMode = false;

    // F6: 末尾占位，确保 segmentTl.duration() >= segmentCursor
    segmentTl.set({}, {}, segmentCursor);

    // 出口 Checkpoint — A6: 计算在途动画
    const inFlight = stageTweenRecords.filter(record => {
      const endTime = record.startTimeInSegment + record.totalDuration;
      return endTime > segmentCursor;
    });
    const exitCheckpoint: Checkpoint = {
      stage: stageManager.dumpState(),
      layout: layout.dumpState(),
      activeParagraphs: [...activeParagraphIndices],
      inFlightAnimations: inFlight.length > 0 ? inFlight : undefined,
    };

    // 设置 Timeline 进度回调
    segmentTl.eventCallback("onUpdate", () => {
      store.currentTime = segmentTl.time() * 1000;
    });

    segmentTl.eventCallback("onComplete", () => {
      this.isAutoPlaying = false;
      console.log("[ScriptPlayer] Segment playback complete.");
    });

    // 诊断日志
    console.log(
      `[BuildSegment] FINAL: segmentTl.duration()=${segmentTl.duration().toFixed(2)}s ` +
      `segmentTl.getChildren().length=${segmentTl.getChildren().length} ` +
      `calculatedDuration=${segmentCursor.toFixed(2)}s`
    );

    // 写入 markers
    store.timelineMarkers = markers;

    return {
      id: "main",
      paragraphs: paragraphUnits,
      timeline: segmentTl,
      behaviors: allBehaviors,
      styleRecords: allStyleRecords,
      stageTweenRecords,
      entryCheckpoint,
      exitCheckpoint,
      // F6: 使用实际 Timeline duration 和计算值的最大值
      duration: Math.max(segmentTl.duration(), segmentCursor)
    };
  }

  /**
   * 捕获 stageManager.apply() 返回的 Tween，挂到 Timeline
   * 不 pause —— GSAP 3 中 paused 子项不受父 Timeline 驱动
   */
  private captureTween(tl: gsap.core.Timeline, result: any, position: number) {
    if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
      tl.add(result, position);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Playback Control
  // ═══════════════════════════════════════════════════════════

  /**
   * 开始/恢复播放
   */
  public playSegment() {
    if (!this.segment) return;
    const tl = this.segment.timeline;

    // 注册 Behaviors（从当前播放位置开始）
    this.registerBehaviors(tl.time());

    if (tl.progress() >= 1) {
      // 已播放完，从头开始
      tl.restart();
    } else {
      // F2: 无参数 play()，从当前位置继续（避免 seek 后跳回 0s）
      tl.play();
    }

    this.isAutoPlaying = true;
  }

  /**
   * 暂停播放
   */
  public pauseSegment() {
    if (!this.segment) return;
    this.segment.timeline.pause();
    this.isAutoPlaying = false;
  }

  /**
   * 精确时间跳转 (秒)
   *
   * Timeline.seek() 让 GSAP 自动插值所有动画到目标时间的中间状态，
   * 包括字符入场、舞台 Tween (cam.move 等)。
   * Behavior 特效通过 registerBehaviors() 重新注册。
   */
  public seekToTime(seconds: number) {
    if (!this.segment) return;
    const clamped = Math.max(0, Math.min(seconds, this.segment.duration));

    console.log(`[ScriptPlayer] seekToTime(${clamped.toFixed(2)}s)`);
    this.segment.timeline.seek(clamped);

    // 重新注册 Behaviors
    this.registerBehaviors(clamped);

    // 重放 StyleRecords（seek 时 reset+replay 以恢复正确的样式状态）
    this.replayStyles(clamped);

    // 更新 store
    const store = useEditorStore();
    store.currentTime = clamped * 1000;
  }

  /**
   * 注册/重新注册 Behavior 特效
   *
   * Behaviors 是 Ticker 驱动的持续特效（shake, wave 等），不在 Timeline 中。
   * seek 时需要：
   *   1. 清除所有已注册的 Behaviors
   *   2. 重新注册 timePosition <= currentTime 的 Behaviors
   */
  private registerBehaviors(currentTime: number) {
    // 清除旧 Behaviors
    for (const cleanup of this.activeBehaviorCleanups) {
      cleanup.char.removeModifier(cleanup.modName);
    }
    this.activeBehaviorCleanups = [];

    if (!this.segment) return;

    // 注册活跃的 Behaviors
    for (const b of this.segment.behaviors) {
      if (b.timePosition <= currentTime) {
        effectManager.apply(b.char, b.effectName, b.params, true);
        this.activeBehaviorCleanups.push({
          char: b.char,
          modName: b.effectName
        });
      }
    }
  }

  /**
   * seek 时重放样式变更（StyleRecord 机制）
   *
   * 与 Behavior seek 流程对称：
   *   1. 重置受影响字符的样式到 baseStyleSnapshot（基准态）
   *   2. 按顺序重放 timePosition <= currentTime 的所有 StyleRecord
   */
  private replayStyles(currentTime: number) {
    if (!this.segment) return;

    // 先收集受影响字符并重置（去重，避免多次 reset）
    const resetChars = new Set<any>();
    for (const sr of this.segment.styleRecords) {
      if (sr.timePosition <= currentTime && !resetChars.has(sr.char)) {
        sr.char.resetStyle();
        resetChars.add(sr.char);
      }
    }

    // 按顺序重放到 currentTime 的所有样式变更
    for (const sr of this.segment.styleRecords) {
      if (sr.timePosition <= currentTime) {
        styleManager.apply(sr.char.style, sr.styleName, sr.params, true);
      }
    }
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
    if (this.isAutoPlaying) {
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
    this.isAutoPlaying = false;
    clearTimeout(this.autoPlayTimer);

    if (this.segment) {
      this.segment.timeline.pause();
      this.segment.timeline.seek(0);

      // F1: 重置 layout 和 stage 到入口状态，防止重播时 Y 偏移
      layout.reset();
      stageManager.loadState(this.segment.entryCheckpoint.stage);
    }

    // 清除 Behaviors
    for (const cleanup of this.activeBehaviorCleanups) {
      cleanup.char.removeModifier(cleanup.modName);
    }
    this.activeBehaviorCleanups = [];

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
      if (this.isAutoPlaying || force) {
        this.playSegment();
      }
    } else {
      console.log("[ScriptPlayer] No more paragraphs to advance to.");
    }
  }

  public get autoPlay(): boolean {
    return this.isAutoPlaying;
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
    const shouldPlay = force ?? !this.isAutoPlaying;
    if (shouldPlay) {
      this.isAutoPlaying = true;
      this.playSegment();
    } else {
      this.pauseSegment();
    }
  }
}

export const scriptPlayer = new ScriptPlayer(stageManager.contentLayer);
