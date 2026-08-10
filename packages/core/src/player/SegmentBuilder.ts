import { Container } from "pixi.js";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import { TextPlayer } from "../render/text/TextPlayer";
import { EffectProcessor } from "../effects/EffectProcessor";
import type { KMDMetadata, KMDParagraphData } from "../parser/types";
import type { Checkpoint, InFlightAnimation, ParagraphUnit, Segment, StageModifierRecord } from "../state/Segment";
import type { BehaviorRecord, StyleRecord, InstantEffectRecord, EntranceFilterRecord } from "../render/text/TextPlayer";
import { stageManager } from "../stage/StageManager";
import { createParagraphExecutionPlan } from "../execution/paragraphExecutionPlan";
import type { PlaybackRuntimeState } from "./PlaybackController";
import type { ReaderRuntimeTimelineMarker } from "../runtime";
import { BehaviorRecordBuilder } from "./BehaviorRecordBuilder";
import { StyleRecordBuilder } from "./StyleRecordBuilder";
import { StageModifierBuilder, type ActiveStageTweenEntry } from "./StageModifierBuilder";
import { CleanupRegistry } from "./CleanupRegistry";
import { DefaultStyleWritePort } from "./StyleWritePort";
import gsap from "gsap";

export interface SegmentBuildContext {
  container: Container;
  metadata: KMDMetadata;
  paragraphs: KMDParagraphData[];
  rawParagraphs: string[];
  currentMode: "stage" | "scroll" | "page";
  playbackState: PlaybackRuntimeState;
}

export interface SegmentBuildResult {
  segment: Segment;
  timelineMarkers: ReaderRuntimeTimelineMarker[];
  activeTexts: KineticText[];
}

export class SegmentBuilder {
  public static async build(context: SegmentBuildContext): Promise<SegmentBuildResult> {
    layout.reset();

    const segmentTl = gsap.timeline({ paused: true });
    const allBehaviors: BehaviorRecord[] = [];
    const allStyleRecords: StyleRecord[] = [];
    const allInstantEffects: InstantEffectRecord[] = [];
    const allEntranceFilters: EntranceFilterRecord[] = [];
    const allStageModifierRecords: StageModifierRecord[] = [];
    const paragraphUnits: ParagraphUnit[] = [];
    const markers: ReaderRuntimeTimelineMarker[] = [];
    const stageTweenRecords: InFlightAnimation[] = [];
    const activeTexts: KineticText[] = [];

    const entryCheckpoint: Checkpoint = {
      stage: stageManager.dumpState(),
      layout: layout.dumpState(),
      activeParagraphs: [],
    };

    let segmentCursor = 0;
    let activeParagraphIndices: Array<{ index: number; x: number; y: number }> = [];

    stageManager.buildMode = true;
    const activeStageTweens = new Map<string, ActiveStageTweenEntry>();
    const virtualCam = { ...stageManager.camera };
    const virtualOff = { ...stageManager.cameraOffset };
    // 处方 6 提交 4：cleanup 写入单一契约（子构建器经 sink 登记，不裸 push）。
    // sink 底层仍 push 到 playbackState 数组，执行侧单一所有权不变。
    const cleanupRegistry = new CleanupRegistry(context.playbackState);
    // 处方 6 提交 4：style 写入显式相位契约（P2/P2b 经 port，其余 4 处 follow-up）。
    const styleWritePort = new DefaultStyleWritePort();
    // stage modifier 子构建器（处方 6）：global 路径分流 + trim/activeStageTweens 管理。
    const stageModifierBuilder = new StageModifierBuilder({
      segmentTl,
      stageTweenRecords,
      activeStageTweens,
      virtualCam,
      virtualOff,
      allStageModifierRecords,
      playbackState: context.playbackState,
    });
    // page mode and authored scene.clear now share one clear path through StageRuntime.
    const clearActiveParagraphs = () => {
      const clearTl = gsap.timeline();
      for (const paragraphUnit of paragraphUnits) {
        if (activeParagraphIndices.some((active) => active.index === paragraphUnit.paragraphIndex)) {
          clearTl.set(paragraphUnit.kineticText, { visible: false }, 0);
        }
      }
      activeParagraphIndices = [];
      return clearTl;
    };

    stageManager.setSceneClearHandler(() => clearActiveParagraphs());

    try {
      for (let i = 0; i < context.paragraphs.length; i++) {
        const pData = context.paragraphs[i];
        const rawText = context.rawParagraphs[i];
        if (!pData || rawText === undefined) continue;

        pData.snapshot = {
          stage: stageManager.dumpState(),
          layout: layout.dumpState(),
          activeParagraphs: [...activeParagraphIndices],
        };

        const hasSceneClearCue = pData.tokens.some((token) =>
          token.layoutInstructions.some((instruction) => instruction.type === "scene.clear"),
        );

        // Page mode is treated as an implicit clear cue, but it still reuses the same runtime-owned hook.
        if (context.currentMode === "page" && activeParagraphIndices.length > 0) {
          const pageClearTl = clearActiveParagraphs();
          if (pageClearTl.getChildren().length > 0) {
            segmentTl.add(pageClearTl, segmentCursor);
          }
        }

        const paragraphText = await this.createParagraphText(context, pData, rawText);
        const pos = await this.placeParagraph(paragraphText, context, pData);

        const { visualConfigs, stageConfigs } = EffectProcessor.partition(pData.globalEffects);
        // stageConfigs（global 路径）由 StageModifierBuilder 接管（处方 6）。
        // buildStageModifierRecord 分流、trimActiveStageTween、activeStageTweens 管理、
        // R22/SA-37 exact-boundary guard——全部原样保留。
        segmentCursor = stageModifierBuilder.applyStageConfigs(stageConfigs, segmentCursor);

        if (visualConfigs.length > 0) {
          // block 作用域 filter（char/group 路径 L251-315 的对称）：
          // 从同步 applyGroupEffects 路径分离，路由进 record + segmentTl.call。
          // - instant track（静态 filter，如 [.gray:block] / [.bloom:block]）→ InstantEffectRecord +
          //   activeInstantCleanups，seek 回退时 clearInstantEffects 移除旧实例。
          // - behavior track（含动画的 filter，如 [.blur:block(anim=true)] / M2 [.displace:block] /
          //   [.underwater:block]）→ BehaviorRecord + activeBehaviorCleanups，seek 时 registerBehaviors
          //   重 apply、clearBehaviors 移除 filter + ticker + modifier。
          // 修复两个已知缺口：
          // - spec §7.2（M1 已修）：instant filter 原同步挂载不经 record，seek 回退 filter 堆叠。
          // - M2 review（behavior audit）：behavior filter 原落 blockRemaining → 同步 applyGroupEffects
          //   执行但 fn 返回的 { filters, tickerFn } 被 applyGroupEffects 丢弃，不进 cleanup →
          // block 作用域 filter/behavior（char/group 路径 L251-315 的对称）：
          // 从同步 applyGroupEffects 路径分离，路由进 record + segmentTl.call。
          // - instant track（静态 filter，如 [.gray:block] / [.bloom:block]）→ InstantEffectRecord +
          //   activeInstantCleanups，seek 回退时 clearInstantEffects 移除旧实例。
          // - behavior track（含动画的 filter 或纯位移 behavior）→ BehaviorRecord +
          //   activeBehaviorCleanups，seek 时 registerBehaviors 重 apply、clearBehaviors 移除
          //   filter + ticker + modifier + offset。
          //   覆盖两类：type:"filter"+track:"behavior"（blur/rgbShift/warp/M2 displace/underwater）
          //   和 type:"behavior"+track:"behavior"（shake:block 用 ContainerBehaviorOffset 返回
          //   { tickerFn }）。原条件只认 type:"filter" → shake:block 落 blockRemaining →
          //   applyGroupEffects 同步执行但 { tickerFn } 被丢弃 → ticker 泄漏（审计修复）。
          //   dim/shift/glitch 也 track:"behavior" 但容器分支不 return 资源（dim 一次性 alpha 写、
          //   shift/glitch 对容器跳过），进 record 后解包 result=undefined 不进 cleanup，安全。
          // 修复已知缺口：
          // - spec §7.2（M1 已修）：instant filter 原同步挂载不经 record，seek 回退 filter 堆叠。
          // - M2 review（behavior audit）：behavior filter/位移原落 blockRemaining → 同步
          //   applyGroupEffects 执行但返回值被丢弃，不进 cleanup → seek/stop/clearScreen 清不到。
          const blockInstant: typeof visualConfigs = [];
          const blockBehavior: typeof visualConfigs = [];
          const blockEntrance: typeof visualConfigs = [];
          const blockRemaining: typeof visualConfigs = [];
          // INV-7（SA-17）：block 路径过 EffectProcessor.getTrack 单一真相源，不再 inline 读 meta.type/track。
          // 与 char 路径（placeCharOnTimeline 用 classifyByTrack）+ group/char-chain 路径（用 getTrack）对齐。
          // R17/SA-32：style 判定经 classifyStyleWrite 单一真相源（替代 styleManager.has 直调）。
          // block 路径语义：全部 block 样式经 applyGroupEffects 同步应用（isContainerLevel=true 一律执行，
          // 不分 pre/post-hold）→ 全进 baseline（R16 recapture）。helper 只统一 isStyle 判定入口。
          for (const cfg of visualConfigs) {
            if (EffectProcessor.classifyStyleWrite(cfg).isStyle) {
              blockRemaining.push(cfg);
              continue;
            }
            const track = EffectProcessor.getTrack(cfg.name);
            if (track === "instant") {
              blockInstant.push(cfg);
            } else if (track === "behavior") {
              blockBehavior.push(cfg);
            } else if (track === "entrance") {
              blockEntrance.push(cfg);
            } else {
              blockRemaining.push(cfg);
            }
          }

          if (blockRemaining.length > 0) {
            // blockRemaining（style + 非 style 残留 + hold cursor 推进）由 StyleRecordBuilder 接管
            // （处方 6 拆解 SegmentBuilder 的一瓣）。R21/SA-36 pre-hold/post-hold 边界拆分、
            // R16/SA-31 recapture、R22/SA-37 exact-boundary guard、:bg scope 跳过——全部原样保留。
            new StyleRecordBuilder({
              segmentTl,
              playbackState: context.playbackState,
              styleWritePort,
              paragraphText,
              segmentCursor,
              allStyleRecords,
            }).processBlockRemaining(blockRemaining);
          }

          // behavior/instant/entrance 三类 record 的收集与 segmentTl.call 注册
          // 由 BehaviorRecordBuilder 接管（处方 6 拆解 SegmentBuilder 的一瓣）。
          // 行为保持：guard / `:bg` 延后 / unpackBehaviorResult / cleanup push 语义全部原样。
          const behaviorBuilder = new BehaviorRecordBuilder({
            segmentTl,
            playbackState: context.playbackState,
            behaviorSink: cleanupRegistry.behaviorSink,
            instantSink: cleanupRegistry.instantSink,
            paragraphText,
            segmentCursor,
            allBehaviors,
            allInstantEffects,
            allEntranceFilters,
          });
          behaviorBuilder.processBlockInstant(blockInstant);
          behaviorBuilder.processBlockBehavior(blockBehavior);
          behaviorBuilder.processBlockEntrance(blockEntrance);
        }

        const displayAssembly = paragraphText._displayAssembly;
        const paragraphExecutionPlan = createParagraphExecutionPlan(displayAssembly);
        const buildResult = TextPlayer.buildTimeline(
          paragraphText,
          paragraphExecutionPlan,
          {
            speed: context.metadata.speed,
            onLineUpdate: context.playbackState.onLineUpdate,
            playbackState: context.playbackState,
          },
        );

        const childCount = buildResult.timeline.getChildren().length;
        if (childCount > 0) {
          segmentTl.add(buildResult.timeline, segmentCursor);
        }

        context.container.addChild(paragraphText);
        activeTexts.push(paragraphText);
        displayAssembly.chars.forEach((char) => { char.visible = false; });
        paragraphText.visible = true;

        // group/char 级 behavior/instant record 由 BehaviorRecordBuilder 接管（处方 6）。
        // 块外重新构造（builder 无状态，只持 ctx 引用；paragraphText / segmentCursor 此处不变）。
        const groupCharBehaviorBuilder = new BehaviorRecordBuilder({
          segmentTl,
          playbackState: context.playbackState,
          behaviorSink: cleanupRegistry.behaviorSink,
          instantSink: cleanupRegistry.instantSink,
          paragraphText,
          segmentCursor,
          allBehaviors,
          allInstantEffects,
          allEntranceFilters,
        });
        groupCharBehaviorBuilder.processGroupCharBehaviors(buildResult);
        groupCharBehaviorBuilder.processGroupCharInstantEffects(buildResult);

        for (const styleRecord of buildResult.styleRecords) {
          allStyleRecords.push({
            ...styleRecord,
            timePosition: styleRecord.timePosition + segmentCursor,
          });
        }

        // 入场特效 filter（blurIn 等）：filter 已在 build 期由 captureEntrance 创建并 push 进
        // target.filters，tween 已由 captureTween 入时间线。此处只聚合进 segment 供 stop/clearScreen
        // 清理（clearEntranceFilters 移除 + destroyFilterDeep）。**不 segmentTl.call 重 apply**——
        // entrance tween 靠时间线插值到正确状态，重 apply blurIn 会 gsap.set(alpha=0) 重置 + rogue tween。
        // 与 instantEffects 区别：instantEffects seek 时 registerInstantEffects 重 apply（静态 filter 幂等），
        // entranceFilters seek 时不重 apply（entrance 靠时间线，不靠 record）。
        for (const entranceRecord of buildResult.entranceFilters) {
          allEntranceFilters.push({
            target: entranceRecord.target,
            filter: entranceRecord.filter,
            timePosition: entranceRecord.timePosition + segmentCursor,
          });
        }

        // inline/token 级 stage modifier 记录聚合由 StageModifierBuilder 接管（处方 6）。
        // R11 sequence 分配（build/push 顺序）+ spread 全部字段（含 isClearBoundary）原样保留。
        stageModifierBuilder.aggregateInlineRecords(buildResult.stageModifierRecords, segmentCursor);

        paragraphUnits.push({
          paragraphIndex: i,
          kineticText: paragraphText,
          offsetInSegment: segmentCursor,
          behaviors: buildResult.behaviors,
          duration: buildResult.duration,
        });

        const absStartMs = segmentCursor * 1000;
        pData.absStartTime = absStartMs;
        pData.estimatedDuration = buildResult.duration * 1000;
        // 段落级 marker：每个段落生成一个可跳转锚点。
        // 不再依赖 token.startTime（该字段由 parser 声明但 buildTimeline 从不回写，
        // 导致旧条件 token.startTime !== undefined 几乎永假，markers 恒为空）。
        // segmentCursor 在段落 build 前已确定，是可靠的时间来源。
        const paragraphLine =
          (pData.tokens.find((t) => t.line !== undefined && (t.content.trim() || t.isSceneClear))?.line ?? 0) + 1;
        const paragraphLabel = rawText.trim().split("\n")[0]?.trim() || `段落 ${i + 1}`;
        markers.push({
          id: `p${i}`,
          label: paragraphLabel,
          line: paragraphLine,
          timeMs: absStartMs,
          startTime: absStartMs,
          duration: Math.max(50, buildResult.duration * 1000),
          content: paragraphLabel,
          type: "paragraph",
        });

        activeParagraphIndices.push({ index: i, x: pos.x, y: pos.y });
        const height = paragraphText.getLayoutHeight();
        layout.currentY += height + 20;

        if (buildResult.advanceTime !== undefined) {
          segmentCursor += buildResult.advanceTime;
        } else {
          segmentCursor += buildResult.duration;
          if (!(context.currentMode === "page" || hasSceneClearCue)) {
            segmentCursor += 2;
          }
        }
      }
    } finally {
      stageManager.setSceneClearHandler(undefined);
      stageManager.buildMode = false;
    }

    segmentTl.set({}, {}, segmentCursor);

    const inFlight = stageTweenRecords.filter((record) => {
      const endTime = record.startTimeInSegment + record.totalDuration;
      return endTime > segmentCursor;
    });
    const exitCheckpoint: Checkpoint = {
      stage: stageManager.dumpState(),
      layout: layout.dumpState(),
      activeParagraphs: [...activeParagraphIndices],
      inFlightAnimations: inFlight.length > 0 ? inFlight : undefined,
    };

    segmentTl.eventCallback("onUpdate", () => {
      context.playbackState.onTimeUpdate?.(segmentTl.time() * 1000);
    });

    segmentTl.eventCallback("onComplete", () => {
      context.playbackState.isAutoPlaying = false;
      // 显式 pause：播完后 timeline 若不 pause，seek 到中间位置会从该处继续推进，
      // 与状态机的 ended 不一致（BUG-14）。pause 后 seek 保持静态，播放需显式 play。
      segmentTl.pause();
      context.playbackState.onPlaybackComplete?.();
    });

    const segment: Segment = {
      id: "main",
      paragraphs: paragraphUnits,
      timeline: segmentTl,
      behaviors: allBehaviors,
      styleRecords: allStyleRecords,
      instantEffects: allInstantEffects,
      entranceFilters: allEntranceFilters,
      stageModifierRecords: allStageModifierRecords,
      stageTweenRecords,
      entryCheckpoint,
      exitCheckpoint,
      duration: Math.max(segmentTl.duration(), segmentCursor),
    };

    return {
      segment,
      timelineMarkers: markers,
      activeTexts,
    };
  }

  private static async createParagraphText(
    context: SegmentBuildContext,
    paragraph: KMDParagraphData,
    rawText: string,
  ) {
    const maxWidth = paragraph.blockOptions.maxWidth || stageManager.designWidth * 0.8;
    const paragraphText = new KineticText({
      maxWidth: context.metadata.maxWidth || maxWidth,
      ...paragraph.blockOptions,
      externalMarkers: layout.globalMarkers,
      baseOffset: { x: 0, y: 0 },
    });

    // Segment build now keeps the parser-produced paragraph as the semantic source of truth.
    await paragraphText.initFromParagraph({
      paragraph,
      sourceKMD: rawText,
    });
    return paragraphText;
  }

  private static async placeParagraph(
    paragraphText: KineticText,
    context: SegmentBuildContext,
    paragraph: KMDParagraphData,
  ) {
    const designWidth = stageManager.designWidth;
    const designHeight = stageManager.designHeight;
    const align = paragraph.blockOptions.align || "left";
    const maxWidth = paragraph.blockOptions.maxWidth || designWidth * 0.8;
    let x: number;
    let y: number;

    if (context.currentMode === "stage" || context.currentMode === "scroll") {
      paragraphText.isAutoLayout = true;
      x = align === "center" ? (designWidth - maxWidth) / 2 : designWidth * 0.1;
      y = layout.currentY;
    } else {
      paragraphText.isAutoLayout = false;
      x = align === "center" ? (designWidth - paragraphText.getLayoutWidth()) / 2 : designWidth * 0.1;
      y = designHeight * 0.7;
    }

    paragraphText.x = x;
    paragraphText.y = y;

    await paragraphText.rebuild(
      {
        baseOffset: { x, y },
        externalMarkers: layout.globalMarkers,
      },
    );

    return { x, y };
  }

}
