import { Container } from "pixi.js";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import { TextPlayer } from "../render/text/TextPlayer";
import { EffectProcessor } from "../effects/EffectProcessor";
import { effectManager } from "../effects/EffectManager";
import type { EffectConfig, KMDMetadata, KMDParagraphData } from "../parser/types";
import type { Checkpoint, InFlightAnimation, ParagraphUnit, Segment, StageModifierRecord } from "../state/Segment";
import type { BehaviorRecord, StyleRecord, InstantEffectRecord, EntranceFilterRecord } from "../render/text/TextPlayer";
import { stageManager } from "../stage/StageManager";
import { buildStageModifierRecord, buildStageModifierApplyParams } from "../stage/stagePresets";
import { createParagraphExecutionPlan } from "../execution/paragraphExecutionPlan";
import type { PlaybackRuntimeState } from "./PlaybackController";
import { PlaybackController } from "./PlaybackController";
import type { ReaderRuntimeTimelineMarker } from "../runtime";
import gsap from "gsap";

type ActiveStageTweenEntry = {
  tween: gsap.core.Tween | gsap.core.Timeline;
  startPosition: number;
  originalDuration: number;
  ease: string;
  fromValues: Record<string, number>;
  toValues: Record<string, number>;
  target: any;
};

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

function getStagePropertyKey(command: string): string | null {
  const propertyKey = stageManager.getCommandMetadata(command)?.propertyKey;
  if (
    propertyKey === "camera.xy" ||
    propertyKey === "camera.zoom" ||
    propertyKey === "camera.rotation" ||
    propertyKey === "offset.xy"
  ) {
    return propertyKey;
  }
  return null;
}

function trimActiveStageTween(
  tl: gsap.core.Timeline,
  entry: ActiveStageTweenEntry,
  cutTime: number,
): Record<string, number> | null {
  if (cutTime >= entry.startPosition + entry.originalDuration) {
    return null;
  }
  if (cutTime <= entry.startPosition) {
    tl.remove(entry.tween);
    return { ...entry.fromValues };
  }

  const trimDur = cutTime - entry.startPosition;
  const cutRatio = trimDur / entry.originalDuration;
  const easeFn = gsap.parseEase(entry.ease);
  const progress = easeFn(cutRatio);
  const cutValues: Record<string, number> = {};
  for (const [prop, fromVal] of Object.entries(entry.fromValues)) {
    cutValues[prop] = fromVal + ((entry.toValues[prop] ?? fromVal) - fromVal) * progress;
  }

  tl.remove(entry.tween);
  const replacement = gsap.fromTo(
    entry.target,
    { ...entry.fromValues },
    { ...cutValues, duration: trimDur, ease: entry.ease, overwrite: false, immediateRender: false },
  );
  tl.add(replacement, entry.startPosition);
  return cutValues;
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
        segmentCursor = this.applyStageConfigs(
          segmentTl,
          stageConfigs,
          stageTweenRecords,
          activeStageTweens,
          virtualCam,
          virtualOff,
          segmentCursor,
          allStageModifierRecords,
          context.playbackState,
        );

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
            // R21/SA-36：block/global style 链按 pre-hold / post-hold 边界拆分（镜像 site2
            // unrollGroupChain + site3 的 hold:char 模型），不再整条经 applyGroupEffects。
            //
            // **R21 修复的 bug**：原代码把 blockRemaining（style + hold + timing/unknown）整条丢给
            // applyGroupEffects 且**不 await**（旧 line 242）。applyGroupEffects 内 hold:block 返回
            // gsap.delayedCall promise → await result（EffectProcessor.ts:280）→ 函数挂起，构建期
            // 同步的 recaptureBaseStyleSnapshot 跑在 hold resolve **之前**（post-hold style 漏 baseline），
            // 且 applyGroupEffects 无 styleRecords 概念 → post-hold style 既不进 baseline 也不进 record，
            // hold 到点后 applyStyleRecursively 作为**墙钟副作用**触发（不播不 seek 自己染红，seek/reset 管不住）。
            //
            // **修复模型**（与 site2/site3 同源，classifyStyleWrite 单一真相源判 pre-hold 边界）：
            //   - pre-hold style → applyGroupEffects 同步应用 + recapture baseline（R16/P2 模型不变）
            //   - hold → 推进 chainCursor（构建期不真等，与 site2 `chainCursor += dur` 一致）
            //   - post-hold style → segmentTl.call + allStyleRecords（seek 由 replayStyles 重放，与 site2 P3 同构）
            //   - 非 style 非 timing 残留（unknown）→ 仍经 applyGroupEffects（保持既有行为；hold 已抽走不阻塞）
            const blockStylePreHold: typeof visualConfigs = [];
            const blockStylePostHold: { config: EffectConfig; time: number }[] = [];
            const blockNonStyleRemaining: typeof visualConfigs = [];
            let blockHoldEncountered = false;
            let chainCursor = segmentCursor;
            for (const cfg of blockRemaining) {
              const { isStyle, isBlocking } = EffectProcessor.classifyStyleWrite(cfg);
              if (isStyle) {
                if (blockHoldEncountered) {
                  blockStylePostHold.push({ config: cfg, time: chainCursor });
                } else {
                  blockStylePreHold.push(cfg);
                }
                continue;
              }
              // hold 是 cursor 推进器（stagger/timing），构建期不真等——抽走不进 applyGroupEffects。
              if (cfg.name === "hold" && isBlocking) {
                chainCursor += EffectProcessor.resolvePauseDuration(cfg.params, 1);
                blockHoldEncountered = true;
                continue;
              }
              // 其余非 style（timing sugar slow/fast/go、unknown）→ 保持原 applyGroupEffects 路径。
              blockNonStyleRemaining.push(cfg);
              if (isBlocking) blockHoldEncountered = true;
            }

            // pre-hold style：applyGroupEffects 同步写 + recapture baseline（R16/P2 模型，含 big/small 测量）。
            // Bug 2: :bg scope 的 style/non-style 不走 applyGroupEffects（Sprite 无 getGraphicsLayer/tokens），
            // 应在 instant/behavior 轨道已处理；若落到 remaining 则跳过并 warn。
            const blockStylePreHoldNonBg = blockStylePreHold.filter(cfg => {
              if (cfg.level === "bg") {
                console.warn(`[SegmentBuilder] :bg style "${cfg.name}" in blockRemaining — not applicable to bg sprite, skipped`);
                return false;
              }
              return true;
            });
            if (blockStylePreHoldNonBg.length > 0) {
              EffectProcessor.applyGroupEffects(paragraphText, [...blockStylePreHoldNonBg]);
              // R16/SA-31：applyGroupEffects 在 KineticChar 构造**之后**同步写 char.style（force=true），
              // 但 baseStyleSnapshot 已在构造时固化（R15 pre-hold 烘焙态）。重新捕获 baseline = 当前
              // style（含 block 样式），避免 replayStyles reset 回无 block 样式的 baseline 丢样式。
              // 初始样式只进 baseline 不进 record，避免相对样式 big/small 双重放大。
              for (const token of paragraphText.tokens) {
                for (const c of token.chars) {
                  c.recaptureBaseStyleSnapshot();
                }
              }
            }

            // 非 style 残留（timing/unknown，hold 已抽走）：保持原 applyGroupEffects 同步路径。
            // Bug 2: :bg scope 同理跳过（Sprite 无 applyGroupEffects 所需接口）。
            const blockNonStyleRemainingNonBg = blockNonStyleRemaining.filter(cfg => {
              if (cfg.level === "bg") {
                console.warn(`[SegmentBuilder] :bg non-style "${cfg.name}" in blockRemaining — not applicable to bg sprite, skipped`);
                return false;
              }
              return true;
            });
            if (blockNonStyleRemainingNonBg.length > 0) {
              EffectProcessor.applyGroupEffects(paragraphText, [...blockNonStyleRemainingNonBg]);
            }

            // post-hold style：record + segmentTl.call（R21/SA-36，镜像 site2 P3）。
            // seek 时 replayStyles 消费 record（segment.timeline.seek 默认 suppressEvents，tl.call 不触发，
            // 由 replayStyles 按 timePosition<=currentTime 重放）；正向播放 segmentTl.call 触发 apply。
            // R22/SA-37：加 exact-boundary 所有权 guard——seek 落在 record.timePosition 上、随后 play 时，
            // deferred tick 跨越会重触发此 tl.call（与 seek 的 replayStyles 双 apply，big ×1.5 两次=×2.25
            // 几何错）。guard 检查 record.timePosition === lastSeekTime 则跳过：seek 已应用过此 record，
            // play 的 tl.call 让位给快照消费者。原「不加守卫——style 不创建资源」注释废止：双 apply 是
            // mutation 双（不是资源泄漏），guard 现为防 mutation 双。
            for (const { config, time } of blockStylePostHold) {
              // Bug 2: :bg scope post-hold style 跳过（同 pre-hold 理由）。
              if (config.level === "bg") {
                console.warn(`[SegmentBuilder] :bg post-hold style "${config.name}" — not applicable to bg sprite, skipped`);
                continue;
              }
              const resolved = EffectProcessor.resolveParams(config.params);
              const cfgName = config.name;
              const cfgParams = { ...resolved };
              const recTime = time;
              segmentTl.call(() => {
                if (context.playbackState.lastSeekTime === recTime) return;
                EffectProcessor.applyStyleRecursively(paragraphText, cfgName, cfgParams, true);
              }, [], recTime);
              for (const token of paragraphText.tokens) {
                for (const c of token.chars) {
                  if (!c.text.trim()) continue;
                  allStyleRecords.push({ char: c, styleName: cfgName, params: { ...cfgParams }, timePosition: recTime });
                }
              }
            }
          }

          for (const cfg of blockInstant) {
            const resolved = EffectProcessor.resolveParams(cfg.params);
            // B3: :bg scope 的 instant filter 目标是背景精灵而非 paragraphText。
            // Bug 6: target 延后到 segmentTl.call 触发时解析——bg(src) 异步加载，
            // build 期 sprite 可能尚未就绪；播放时（tl.call 触发）更可能已加载完成。
            // 若仍未就绪，注册 onBackgroundReady 回调延后 apply。
            const isBg = cfg.level === "bg";
            const buildTimeBgTarget = isBg ? stageManager.getBackgroundSprite() : null;
            const instantTarget = buildTimeBgTarget ?? paragraphText;
            if (isBg) {
              allInstantEffects.push({
                target: instantTarget,
                effectName: cfg.name,
                params: resolved,
                charIndex: 0,
                timePosition: segmentCursor,
              });
            } else {
              allInstantEffects.push({
                target: paragraphText,
                effectName: cfg.name,
                params: resolved,
                charIndex: 0,
                timePosition: segmentCursor,
              });
            }
            const instantName = cfg.name;
            const instantParams = { ...resolved };
            // R12：预查 meta——void result 的 Graphics 特效（box/border）push graphicsLayer cleanup。
            const instantMeta = effectManager.getMetadata(instantName);
            // R22/SA-37：exact-boundary guard。
            const instantRecTime = segmentCursor;
            segmentTl.call(() => {
              if (!context.playbackState.isAutoPlaying) return;
              if (context.playbackState.lastSeekTime === instantRecTime) return;
              // Bug 6: :bg target 在 call 触发时解析（此时 sprite 可能已加载）
              const liveTarget: any = isBg ? stageManager.getBackgroundSprite() : instantTarget;
              if (isBg && !liveTarget) {
                // sprite 仍未就绪——注册延后 apply
                stageManager.onBackgroundReady((sprite) => {
                  const fi = effectManager.apply(sprite, instantName, instantParams, true);
                  if (fi) {
                    context.playbackState.activeInstantCleanups.push({ target: sprite, filterInstance: fi });
                  }
                });
                return;
              }
              const filterInstance = effectManager.apply(liveTarget, instantName, instantParams, true);
              if (filterInstance) {
                context.playbackState.activeInstantCleanups.push({
                  target: liveTarget,
                  filterInstance,
                });
              } else if (instantMeta?.mutexGroup && typeof (liveTarget as any).getGraphicsLayer === "function") {
                context.playbackState.activeInstantCleanups.push({
                  target: liveTarget,
                  filterInstance: undefined as any,
                  graphicsLayer: instantMeta.mutexGroup,
                });
              }
            }, [], segmentCursor);
          }

          // block 作用域 behavior filter（blur/rgbShift/warp 容器级 + M2 displace/underwater 等）。
          // 与 char/group behavior 路径（下方 segmentTl.call）同构：push BehaviorRecord 供
          // registerBehaviors seek 重 apply，segmentTl.call 正向触发 + 捕获 cleanup。
          // target = char = paragraphText（容器级无 removeModifier，clearBehaviors 守卫跳过 modifier
          // 分支；filter + ticker 经 BehaviorFilterResult 解包记录，与 registerBehaviors 一致）。
          for (const cfg of blockBehavior) {
            const resolved = EffectProcessor.resolveParams(cfg.params);
            // B3: :bg scope 的 behavior filter 目标是背景精灵而非 paragraphText。
            // Bug 6: target 延后到 segmentTl.call 触发时解析（与 instant 同理）。
            const isBgBehavior = cfg.level === "bg";
            const behaviorRecord: BehaviorRecord = {
              target: isBgBehavior ? (stageManager.getBackgroundSprite() ?? paragraphText) : paragraphText,
              char: isBgBehavior ? (stageManager.getBackgroundSprite() ?? paragraphText) as any : paragraphText,
              effectName: cfg.name,
              params: resolved,
              charIndex: 0,
              timePosition: segmentCursor,
            };
            allBehaviors.push(behaviorRecord);
            const behaviorName = cfg.name;
            const behaviorParams = { ...resolved };
            // R22/SA-37：exact-boundary guard——与 instant 同源。
            const behaviorRecTime = segmentCursor;
            segmentTl.call(() => {
              if (!context.playbackState.isAutoPlaying) return;
              if (context.playbackState.lastSeekTime === behaviorRecTime) return;
              // Bug 6: :bg target 在 call 触发时解析
              const liveBehaviorTarget = isBgBehavior ? stageManager.getBackgroundSprite() : paragraphText;
              if (isBgBehavior && !liveBehaviorTarget) {
                stageManager.onBackgroundReady((sprite) => {
                  const result = effectManager.apply(sprite, behaviorName, behaviorParams, true);
                  const unpacked = PlaybackController.unpackBehaviorResult(result, sprite);
                  context.playbackState.activeBehaviorCleanups.push({
                    char: sprite as any,
                    modName: behaviorName,
                    target: sprite,
                    ...unpacked,
                  });
                });
                return;
              }
              const behaviorChar = liveBehaviorTarget as any;
              const result = effectManager.apply(behaviorChar, behaviorName, behaviorParams, true);
              // INV-7（SA-16）：解包经 PlaybackController.unpackBehaviorResult 单一真相源
              const unpacked = PlaybackController.unpackBehaviorResult(result, liveBehaviorTarget);
              context.playbackState.activeBehaviorCleanups.push({
                char: behaviorChar,
                modName: behaviorName,
                target: liveBehaviorTarget,
                ...unpacked,
              });
            }, [], segmentCursor);
          }

        // block 作用域 entrance 特效（如 blurIn:block）：build 期 apply 创建 filter + tween，
        // tween 入 segment timeline（seek 插值 + stop kill 释放），filter 进 entranceFilters
        // （clearEntranceFilters 在 stop/clearScreen 移除 + destroyFilterDeep）。
        // **不进 instantEffects**（seek 重 apply blurIn 会 gsap.set(alpha=0) 重置 + 崩溃），
        // **不落 blockRemaining**（applyGroupEffects 丢弃 {tween,filter} → filter+tween 泄漏）。
        // 与 TextPlayer.captureEntrance 语义同构，但在 SegmentBuilder 层直接处理（block 分流
        // 在 buildTimeline 之前，captureEntrance 不可用）。
        for (const cfg of blockEntrance) {
          const resolved = EffectProcessor.resolveParams(cfg.params);
          // Bug 2: :bg scope 的 entrance filter 目标是背景精灵而非 paragraphText。
          const bgEntranceTarget = cfg.level === "bg" ? stageManager.getBackgroundSprite() : null;
          if (bgEntranceTarget === null && cfg.level === "bg") {
            console.warn(`[SegmentBuilder] :bg entrance "${cfg.name}" skipped — no background sprite`);
            continue;
          }
          const entranceTarget = bgEntranceTarget ?? paragraphText;
          const entranceName = cfg.name;
          const entranceParams = { ...resolved };
          // build 期同步 apply：fn 创建 filter push 进 target.filters + 返回 {tween, filter}
          const result = effectManager.apply(entranceTarget, entranceName, entranceParams, true);
          if (result && typeof result === 'object' && 'tween' in result && 'filter' in result) {
            const efr = result as any;
            // tween 入 segment timeline（与 captureTween 同构）
            if (efr.tween instanceof gsap.core.Tween || efr.tween instanceof gsap.core.Timeline) {
              segmentTl.add(efr.tween, segmentCursor);
            }
            // filter 进 entranceFilters（clearEntranceFilters 在 stop/clearScreen 移除 + destroyFilterDeep）
            allEntranceFilters.push({
              target: entranceTarget,
              filter: efr.filter,
              timePosition: segmentCursor,
            });
          }
        }
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

        for (const behavior of buildResult.behaviors) {
          const absTime = behavior.timePosition + segmentCursor;
          allBehaviors.push({
            ...behavior,
            timePosition: absTime,
          });
          const behaviorChar = behavior.char;
          const behaviorTarget = behavior.target;
          const behaviorName = behavior.effectName;
          const behaviorParams = { ...behavior.params };
          // R22/SA-37：exact-boundary guard——absTime 已是 const（let 重新赋值的局部），但为 guard
          // 显式捕获。seek 落在 absTime 上、随后 play 时 deferred tick 跨越双 push filter。
          const behaviorRecTime = absTime;
          segmentTl.call(() => {
            if (!context.playbackState.isAutoPlaying) return;
            if (context.playbackState.lastSeekTime === behaviorRecTime) return;
            const result = effectManager.apply(behaviorChar, behaviorName, behaviorParams, true);
            // INV-7（SA-16）：解包经 PlaybackController.unpackBehaviorResult 单一真相源
            // （与 block 路径、registerBehaviors 共用，新增返回 shape 只改一处）。
            const unpacked = PlaybackController.unpackBehaviorResult(result, behaviorTarget);
            context.playbackState.activeBehaviorCleanups.push({
              char: behaviorChar,
              modName: behaviorName,
              target: behaviorTarget,
              ...unpacked,
            });
          }, [], absTime);
        }

        for (const styleRecord of buildResult.styleRecords) {
          allStyleRecords.push({
            ...styleRecord,
            timePosition: styleRecord.timePosition + segmentCursor,
          });
        }

        // Instant 特效（静态 filter）：正向播放经 segmentTl.call 在 absTime 触发 apply；
        // seek 时由 PlaybackController.registerInstantEffects reset+replay。
        // 与 behavior 的两路径模型对称（behavior 既在此 tl.call，又靠 registerBehaviors seek 重注册）。
        for (const instantRecord of buildResult.instantEffects) {
          const absTime = instantRecord.timePosition + segmentCursor;
          allInstantEffects.push({
            ...instantRecord,
            timePosition: absTime,
          });
          const instantTarget = instantRecord.target;
          const instantName = instantRecord.effectName;
          const instantParams = { ...instantRecord.params };
          // R12：预查 meta——void result 的 Graphics 特效（bg/border）push graphicsLayer cleanup。
          const instantMeta = effectManager.getMetadata(instantName);
          // R22/SA-37：exact-boundary guard。
          const instantRecTime = absTime;
          segmentTl.call(() => {
            if (!context.playbackState.isAutoPlaying) return;
            if (context.playbackState.lastSeekTime === instantRecTime) return;
            const filterInstance = effectManager.apply(instantTarget, instantName, instantParams, true);
            if (filterInstance) {
              context.playbackState.activeInstantCleanups.push({
                target: instantTarget,
                filterInstance,
              });
            } else if (instantMeta?.mutexGroup && typeof (instantTarget as any).getGraphicsLayer === "function") {
              // R12：Graphics 特效（bg/border 画 Graphics 非 filter，返回 void）——seek 回退清该层防残留。
              context.playbackState.activeInstantCleanups.push({
                target: instantTarget,
                filterInstance: undefined as any,
                graphicsLayer: instantMeta.mutexGroup,
              });
            }
          }, [], absTime);
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

        // inline/token 级 stage modifier 记录（cam.reset/cam.drift/cam.shake 在文字 @ cam.xxx 或
        // effect chain 里触发）：与 global 路径（applyStageConfigs 经 buildStageModifierRecord）共用同一
        // allStageModifierRecords，seek 时 replayStageModifiers 按 timePosition + duration + isClearBoundary 重放。
        // 必须 spread 全部片段字段——上一版只拷 command/params/timePosition/duration，漏掉 isClearBoundary，
        // 导致 inline/token 级 cam.reset 边界丢失。
        // R11：分配 sequence = allStageModifierRecords.length（build/push 顺序，表达 GSAP callback 执行序）。
        //   不是 ordered 索引——>>> overlap 时不同 timePosition 的 push 顺序会被排序打乱
        //   （p1 drift@2 先 push、p2 reset@1 后 push，reset effective@2 clear 时 drift 已 apply）。
        for (const modRecord of buildResult.stageModifierRecords) {
          allStageModifierRecords.push({
            ...modRecord,
            timePosition: modRecord.timePosition + segmentCursor,
            sequence: allStageModifierRecords.length,
          });
        }

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

  private static applyStageConfigs(
    segmentTl: gsap.core.Timeline,
    stageConfigs: any[],
    stageTweenRecords: InFlightAnimation[],
    activeStageTweens: Map<string, ActiveStageTweenEntry>,
    virtualCam: Record<string, number>,
    virtualOff: Record<string, number>,
    segmentCursor: number,
    stageModifierRecords: StageModifierRecord[],
    playbackState?: { lastSeekTime?: number },
  ) {
    let cursor = segmentCursor;

    for (const config of stageConfigs) {
      if (config.name === "pause") {
        const duration = EffectProcessor.resolvePauseDuration(config.params, 1);
        cursor += duration;
        continue;
      }

      // 单一真相源：buildStageModifierRecord 决定 cam.reset（clear boundary）、modifierBased
      // （cam.shake/cam.drift，duration 按命令语义）与可 seek tween 命令的分流。
      // 三路径（global/inline/token-chain）共用此 helper，SA-12 cam.reset boundary 在 inline/token-chain
      // 的分裂由此从根上消除（`文字 @ cam.reset!` 与全局 cam.reset 现在同一处理）。
      const stageRecord = buildStageModifierRecord(config.name, config.params);

      if (stageRecord && !stageRecord.isClearBoundary) {
        // modifierBased（cam.shake/cam.drift）：经 tl.call 延迟 apply（modifier 在 timeline 时间触发），
        // 不在 build 期 apply。propertyKey 可能与活跃 tween 冲突（当前 modifierBased 命令均无 propKey，
        // 但保留 trim 对称——若未来加 modifierBased+propertyKey 命令也能正确 trim）。
        const propKey = getStagePropertyKey(config.name);
        if (propKey) {
          const existing = activeStageTweens.get(propKey);
          if (existing) {
            stageManager.reportConflictDiagnostic({
              severity: "warning",
              channel: propKey,
              command: config.name,
              message: `Trimmed active stage tween on channel "${propKey}" before applying "${config.name}".`,
            });
            const cutValues = trimActiveStageTween(segmentTl, existing, cursor);
            if (cutValues) {
              Object.assign(propKey.startsWith("offset") ? virtualOff : virtualCam, cutValues);
            }
            activeStageTweens.delete(propKey);
          }
        }
        const configCopy = { name: config.name, params: buildStageModifierApplyParams(config.name, config.params) };
        stageModifierRecords.push({ ...stageRecord, timePosition: cursor, sequence: stageModifierRecords.length });
        // R22/SA-37：exact-boundary guard——seek 落在 cursor 上、随后 play 时 deferred tick 跨越会
        // 重触发此 tl.call（与 seek 的 replayStageModifiers 双 apply，cam.shake 满强度覆盖中途剩余强度）。
        // 检查 timePosition === lastSeekTime 则跳过，让 replayStageModifiers 单一拥有当前态。
        // R22-followup（stage 默认参数对齐）：configCopy.params 是 buildStageModifierApplyParams
        // 预解析的（缺失变量按命令预设默认值，与 seek 重放同源），不再传 raw params 让
        // StageRuntime.apply fallback 0——自然播放与 seek 重放现在走同一份解析。
        const modRecTime = cursor;
        segmentTl.call(() => {
          if (playbackState?.lastSeekTime === modRecTime) return;
          stageManager.apply(configCopy.name, configCopy.params);
        }, [], cursor);
        continue;
      }

      if (stageRecord?.isClearBoundary) {
        // cam.reset：记 clear boundary + 立即 trim active tween + 重置 virtualCam/Off。
        // reset timeline 是可 seek tween，与 cam.move 等对称——落下方通用 apply + capture +
        // stageTweenRecords（保留原行为：reset tween 仍计入 inFlight for Phase B 跨 Segment 衔接）。
        for (const [, entry] of activeStageTweens) {
          trimActiveStageTween(segmentTl, entry, cursor);
        }
        activeStageTweens.clear();
        Object.assign(virtualCam, { x: 0, y: 0, zoom: 1, rotation: 0 });
        Object.assign(virtualOff, { x: 0, y: 0, zoom: 1, rotation: 0 });
        stageModifierRecords.push({ ...stageRecord, timePosition: cursor, sequence: stageModifierRecords.length });
      }

      const propKey = getStagePropertyKey(config.name);
      if (propKey) {
        const existing = activeStageTweens.get(propKey);
        if (existing) {
          stageManager.reportConflictDiagnostic({
            severity: "warning",
            channel: propKey,
            command: config.name,
            message: `Trimmed active stage tween on channel "${propKey}" before applying "${config.name}".`,
          });
          const cutValues = trimActiveStageTween(segmentTl, existing, cursor);
          if (cutValues) {
            Object.assign(propKey.startsWith("offset") ? virtualOff : virtualCam, cutValues);
          }
          activeStageTweens.delete(propKey);
        }
      }

      const result = stageManager.apply(config.name, config.params);
      this.captureTween(segmentTl, result, cursor);

      if (propKey && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
        const duration = result.duration();
        if (duration > 0) {
          const toValues = extractTweenTargets(config.name, config.params);
          const virtualState = propKey.startsWith("offset") ? virtualOff : virtualCam;
          const fromValues: Record<string, number> = {};
          for (const key of Object.keys(toValues)) fromValues[key] = virtualState[key] ?? 0;
          activeStageTweens.set(propKey, {
            tween: result,
            startPosition: cursor,
            originalDuration: duration,
            ease: "power2.inOut",
            fromValues,
            toValues,
            target: propKey.startsWith("offset") ? stageManager.cameraOffset : stageManager.camera,
          });
          Object.assign(virtualState, toValues);
        }
      }

      if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
        const duration = result.duration();
        if (duration > 0) {
          stageTweenRecords.push({
            command: config.name,
            targets: extractTweenTargets(config.name, config.params),
            totalDuration: duration,
            startTimeInSegment: cursor,
            ease: duration > 0 ? "power2.inOut" : "none",
          });
        }
      }

      if (config.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
        cursor += result.duration();
      }
    }

    return cursor;
  }

  private static captureTween(timeline: gsap.core.Timeline, result: any, position: number) {
    if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
      timeline.add(result, position);
    }
  }
}
