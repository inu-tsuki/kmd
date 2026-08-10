import { EffectProcessor } from "../effects/EffectProcessor";
import { effectManager } from "../effects/EffectManager";
import { stageManager } from "../stage/StageManager";
import type { EffectConfig } from "../parser/types";
import type { KineticText } from "../KineticText";
import type { BehaviorRecord, InstantEffectRecord, EntranceFilterRecord, TimelineBuildResult } from "../render/text/TextPlayer";
import type { PlaybackRuntimeState } from "./PlaybackController";
import type { BehaviorCleanupSink, InstantCleanupSink } from "./CleanupRegistry";
import { PlaybackController } from "./PlaybackController";
import gsap from "gsap";

/**
 * Behavior / Instant / Entrance 三类 record 的子构建器（处方 6 拆解 SegmentBuilder 的一瓣）。
 *
 * 职责：把段落级 block 作用域的 instant/behavior/entrance 分流、以及 TextPlayer.buildTimeline
 * 产出的 group/char 级 behavior/instant record，路由进 segment 级 accumulator + segmentTl.call。
 *
 * **行为保持**（纯重构，从 SegmentBuilder.build 搬移，不改语义）：
 * - 8 处 cleanup 写入经注入的 BehaviorCleanupSink / InstantCleanupSink 登记单一写入契约
 *   （处方 6 提交 4 收口）。sink 底层仍 push 到 playbackState 数组，执行侧单一所有权不变。
 * - `isAutoPlaying` / `lastSeekTime` guard、`:bg` 延后 `onBackgroundReady`、void-result Graphics
 *   cleanup、`unpackBehaviorResult` 单一真相源——全部原样保留。
 *
 * **INV-7 合规**：本文件分流均经 `EffectProcessor.getTrack` / `classifyStyleWrite` 单一真相源，
 * 不含 inline 元数据类型加轨道字面量判定的分流（SA-17 禁止的那种）。
 *
 * **INV-8 合规**：搬迁自 SegmentBuilder 的注释中含 GSAP/Pixi 边界行为声明的已保留 §B-bis/已验证/INV-8 引用。
 */
export interface BehaviorBuildContext {
  segmentTl: gsap.core.Timeline;
  playbackState: PlaybackRuntimeState;   // 仅供 guard 读取（isAutoPlaying/lastSeekTime），不直接 push
  behaviorSink: BehaviorCleanupSink;     // 处方 6 提交 4：cleanup 写入单一契约
  instantSink: InstantCleanupSink;
  paragraphText: KineticText;
  segmentCursor: number;
  allBehaviors: BehaviorRecord[];
  allInstantEffects: InstantEffectRecord[];
  allEntranceFilters: EntranceFilterRecord[];
}

export class BehaviorRecordBuilder {
  private ctx: BehaviorBuildContext;
  constructor(ctx: BehaviorBuildContext) {
    this.ctx = ctx;
  }

  /**
   * block 作用域 instant filter（静态 filter，如 [.gray:block] / [.bloom:block]）：
   * 从同步 applyGroupEffects 路径分离，路由进 InstantEffectRecord + segmentTl.call。
   * seek 回退时 clearInstantEffects 移除旧实例（与 char/group 路径对称）。
   *
   * spec §7.2（M1 已修）：instant filter 原同步挂载不经 record，seek 回退 filter 堆叠。
   */
  processBlockInstant(configs: EffectConfig[]): void {
    const { segmentTl, playbackState, instantSink, paragraphText, segmentCursor } = this.ctx;

    for (const cfg of configs) {
      const resolved = EffectProcessor.resolveParams(cfg.params);
      // B3: :bg scope 的 instant filter 目标是背景精灵而非 paragraphText。
      // Bug 6: target 延后到 segmentTl.call 触发时解析——bg(src) 异步加载，
      // build 期 sprite 可能尚未就绪；播放时（tl.call 触发）更可能已加载完成。
      // 若仍未就绪，注册 onBackgroundReady 回调延后 apply。
      const isBg = cfg.level === "bg";
      const buildTimeBgTarget = isBg ? stageManager.getBackgroundSprite() : null;
      const instantTarget = buildTimeBgTarget ?? paragraphText;
      if (isBg) {
        this.ctx.allInstantEffects.push({
          target: instantTarget,
          effectName: cfg.name,
          params: resolved,
          charIndex: 0,
          timePosition: segmentCursor,
          targetLevel: "bg",
        });
      } else {
        this.ctx.allInstantEffects.push({
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
        if (!playbackState.isAutoPlaying) return;
        if (playbackState.lastSeekTime === instantRecTime) return;
        // Bug 6: :bg target 在 call 触发时解析（此时 sprite 可能已加载）
        const liveTarget: any = isBg ? stageManager.getBackgroundSprite() : instantTarget;
        if (isBg && !liveTarget) {
          // sprite 仍未就绪——注册延后 apply
          stageManager.onBackgroundReady((sprite) => {
            const fi = effectManager.apply(sprite, instantName, instantParams, true, "background");
            if (fi) {
              instantSink.register({ target: sprite, filterInstance: fi });
            }
          });
          return;
        }
        const filterInstance = effectManager.apply(
          liveTarget,
          instantName,
          instantParams,
          true,
          isBg ? "background" : "text",
        );
        if (filterInstance) {
          instantSink.register({
            target: liveTarget,
            filterInstance,
          });
        } else if (instantMeta?.mutexGroup && typeof (liveTarget as any).getGraphicsLayer === "function") {
          instantSink.register({
            target: liveTarget,
            filterInstance: undefined as any,
            graphicsLayer: instantMeta.mutexGroup,
          });
        }
      }, [], segmentCursor);
    }
  }

  /**
   * block 作用域 behavior filter（blur/rgbShift/warp 容器级 + M2 displace/underwater 等）。
   * 与 char/group behavior 路径（processGroupCharBehaviors）同构：push BehaviorRecord 供
   * registerBehaviors seek 重 apply，segmentTl.call 正向触发 + 捕获 cleanup。
   * target = char = paragraphText（容器级无 removeModifier，clearBehaviors 守卫跳过 modifier
   * 分支；filter + ticker 经 BehaviorFilterResult 解包记录，与 registerBehaviors 一致）。
   *
   * 覆盖两类：type:"filter"+track:"behavior"（blur/rgbShift/warp/M2 displace/underwater）
   * 和 type:"behavior"+track:"behavior"（shake:block 用 ContainerBehaviorOffset 返回
   * { tickerFn }）。dim/shift/glitch 也 track:"behavior" 但容器分支不 return 资源（dim 一次性 alpha 写、
   * shift/glitch 对容器跳过），进 record 后解包 result=undefined 不进 cleanup，安全。
   */
  processBlockBehavior(configs: EffectConfig[]): void {
    const { segmentTl, playbackState, behaviorSink, paragraphText, segmentCursor } = this.ctx;

    for (const cfg of configs) {
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
        targetLevel: isBgBehavior ? "bg" : undefined,
      };
      this.ctx.allBehaviors.push(behaviorRecord);
      const behaviorName = cfg.name;
      const behaviorParams = { ...resolved };
      // R22/SA-37：exact-boundary guard——与 instant 同源。
      const behaviorRecTime = segmentCursor;
      segmentTl.call(() => {
        if (!playbackState.isAutoPlaying) return;
        if (playbackState.lastSeekTime === behaviorRecTime) return;
        // Bug 6: :bg target 在 call 触发时解析
        const liveBehaviorTarget = isBgBehavior ? stageManager.getBackgroundSprite() : paragraphText;
        if (isBgBehavior && !liveBehaviorTarget) {
          stageManager.onBackgroundReady((sprite) => {
            const result = effectManager.apply(sprite, behaviorName, behaviorParams, true, "background");
            const unpacked = PlaybackController.unpackBehaviorResult(result, sprite);
            behaviorSink.register({
              char: sprite as any,
              modName: behaviorName,
              target: sprite,
              ...unpacked,
            });
          });
          return;
        }
        const behaviorChar = liveBehaviorTarget as any;
        const result = effectManager.apply(
          behaviorChar,
          behaviorName,
          behaviorParams,
          true,
          isBgBehavior ? "background" : "text",
        );
        // INV-7（SA-16）：解包经 PlaybackController.unpackBehaviorResult 单一真相源
        const unpacked = PlaybackController.unpackBehaviorResult(result, liveBehaviorTarget);
        behaviorSink.register({
          char: behaviorChar,
          modName: behaviorName,
          target: liveBehaviorTarget,
          ...unpacked,
        });
      }, [], segmentCursor);
    }
  }

  /**
   * block 作用域 entrance 特效（如 blurIn:block）：build 期 apply 创建 filter + tween，
   * tween 入 segment timeline（seek 插值 + stop kill 释放），filter 进 entranceFilters
   * （clearEntranceFilters 在 stop/clearScreen 移除 + destroyFilterDeep）。
   * **不进 instantEffects**（seek 重 apply blurIn 会 gsap.set(alpha=0) 重置 + 崩溃），
   * **不落 blockRemaining**（applyGroupEffects 丢弃 {tween,filter} → filter+tween 泄漏）。
   * 与 TextPlayer.captureEntrance 语义同构，但在 build 层直接处理（block 分流
   * 在 buildTimeline 之前，captureEntrance 不可用）。
   */
  processBlockEntrance(configs: EffectConfig[]): void {
    const { segmentTl, paragraphText, segmentCursor, allEntranceFilters } = this.ctx;

    for (const cfg of configs) {
      const resolved = EffectProcessor.resolveParams(cfg.params);
      // Bug 2/6: :bg scope 的 entrance filter 目标是背景精灵而非 paragraphText。
      // 与 instant/behavior 同理：sprite 未就绪时注册 onBackgroundReady 延后 apply。
      const isBgEntrance = cfg.level === "bg";
      const bgEntranceTarget = isBgEntrance ? stageManager.getBackgroundSprite() : null;
      const entranceTarget = bgEntranceTarget ?? paragraphText;
      const entranceName = cfg.name;
      const entranceParams = { ...resolved };

      // build 期同步 apply：fn 创建 filter push 进 target.filters + 返回 {tween, filter}
      const applyEntrance = (target: any) => {
        const result = effectManager.apply(
          target,
          entranceName,
          entranceParams,
          true,
          isBgEntrance ? "background" : "text",
        );
        if (result && typeof result === 'object' && 'tween' in result && 'filter' in result) {
          const efr = result as any;
          if (efr.tween instanceof gsap.core.Tween || efr.tween instanceof gsap.core.Timeline) {
            segmentTl.add(efr.tween, segmentCursor);
          }
          allEntranceFilters.push({
            target,
            filter: efr.filter,
            timePosition: segmentCursor,
          });
        }
      };

      if (isBgEntrance && !bgEntranceTarget) {
        // Bug 6: sprite 未就绪——延后到 onBackgroundReady 回调
        stageManager.onBackgroundReady((sprite) => applyEntrance(sprite));
      } else {
        applyEntrance(entranceTarget);
      }
    }
  }

  /**
   * group/char 级 behavior record（来自 TextPlayer.buildTimeline）：
   * 聚合进 segment 级 allBehaviors（+segmentCursor 偏移），并为每条 record 注册 segmentTl.call
   * 正向触发 apply + 捕获 cleanup。seek 由 PlaybackController.registerBehaviors 重放。
   */
  processGroupCharBehaviors(buildResult: TimelineBuildResult): void {
    const { segmentTl, playbackState, behaviorSink, segmentCursor } = this.ctx;

    for (const behavior of buildResult.behaviors) {
      const absTime = behavior.timePosition + segmentCursor;
      this.ctx.allBehaviors.push({
        ...behavior,
        timePosition: absTime,
      });
      const behaviorChar = behavior.char;
      const isBgBehavior = behavior.targetLevel === "bg";
      const behaviorName = behavior.effectName;
      const behaviorParams = { ...behavior.params };
      // R22/SA-37：exact-boundary guard——absTime 已是 const（let 重新赋值的局部），但为 guard
      // 显式捕获。seek 落在 absTime 上、随后 play 时 deferred tick 跨越双 push filter。
      const behaviorRecTime = absTime;
      segmentTl.call(() => {
        if (!playbackState.isAutoPlaying) return;
        if (playbackState.lastSeekTime === behaviorRecTime) return;
        const applyBehavior = (target: any) => {
          const result = effectManager.apply(
            target,
            behaviorName,
            behaviorParams,
            true,
            isBgBehavior ? "background" : "text",
          );
          // INV-7（SA-16）：解包经 PlaybackController.unpackBehaviorResult 单一真相源
          // （与 block 路径、registerBehaviors 共用，新增返回 shape 只改一处）。
          const unpacked = PlaybackController.unpackBehaviorResult(result, target);
          behaviorSink.register({
            char: target,
            modName: behaviorName,
            target,
            ...unpacked,
          });
        };
        const liveTarget = isBgBehavior ? stageManager.getBackgroundSprite() : behaviorChar;
        if (isBgBehavior && !liveTarget) {
          stageManager.onBackgroundReady((sprite) => applyBehavior(sprite));
        } else {
          applyBehavior(liveTarget);
        }
      }, [], absTime);
    }
  }

  /**
   * group/char 级 instant filter record（来自 TextPlayer.buildTimeline）：
   * 正向播放经 segmentTl.call 在 absTime 触发 apply；seek 时由 PlaybackController
   * registerInstantEffects reset+replay。与 behavior 的两路径模型对称
   * （behavior 既在此 tl.call，又靠 registerBehaviors seek 重注册）。
   */
  processGroupCharInstantEffects(buildResult: TimelineBuildResult): void {
    const { segmentTl, playbackState, instantSink, segmentCursor } = this.ctx;

    for (const instantRecord of buildResult.instantEffects) {
      const absTime = instantRecord.timePosition + segmentCursor;
      this.ctx.allInstantEffects.push({
        ...instantRecord,
        timePosition: absTime,
      });
      const instantTarget = instantRecord.target;
      const isBgInstant = instantRecord.targetLevel === "bg";
      const instantName = instantRecord.effectName;
      const instantParams = { ...instantRecord.params };
      // R12：预查 meta——void result 的 Graphics 特效（bg/border）push graphicsLayer cleanup。
      const instantMeta = effectManager.getMetadata(instantName);
      // R22/SA-37：exact-boundary guard。
      const instantRecTime = absTime;
      segmentTl.call(() => {
        if (!playbackState.isAutoPlaying) return;
        if (playbackState.lastSeekTime === instantRecTime) return;
        const applyInstant = (target: any) => {
          const filterInstance = effectManager.apply(
            target,
            instantName,
            instantParams,
            true,
            isBgInstant ? "background" : "text",
          );
          if (filterInstance) {
            instantSink.register({ target, filterInstance });
          } else if (instantMeta?.mutexGroup && typeof target?.getGraphicsLayer === "function") {
            // R12：Graphics 特效（bg/border 画 Graphics 非 filter，返回 void）——seek 回退清该层防残留。
            instantSink.register({
              target,
              filterInstance: undefined as any,
              graphicsLayer: instantMeta.mutexGroup,
            });
          }
        };
        const liveTarget = isBgInstant ? stageManager.getBackgroundSprite() : instantTarget;
        if (isBgInstant && !liveTarget) {
          stageManager.onBackgroundReady((sprite) => applyInstant(sprite));
        } else {
          applyInstant(liveTarget);
        }
      }, [], absTime);
    }
  }
}