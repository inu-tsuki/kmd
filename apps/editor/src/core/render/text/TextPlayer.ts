import { EffectProcessor } from "../../effects/EffectProcessor";
import { stageManager } from "../../stage/StageManager";
import { effectManager } from "../../effects/EffectManager";
import { styleManager } from "../../effects/StyleManager";
import { TokenWrapper } from "../../TokenWrapper";
import { KineticChar } from "../../KineticChar";
import type { EffectConfig } from "../../parser/types";
import type { RuntimeParagraphExecutionPlan } from "../../execution/paragraphExecutionPlan";
import { TextPlanDiagnosticsSink } from "./TextPlanDiagnosticsSink";
import { TextStageCueScheduler } from "./TextStageCueScheduler";
import { TextTimelineCursor } from "./TextTimelineCursor";
import type { Container, Filter } from "pixi.js";
import gsap from "gsap";
import type { StageModifierRecord } from "../../state/Segment";
import { buildStageModifierRecord, buildStageModifierApplyParams } from "../../stage/stagePresets";

/**
 * Style 变更记录，用于 seek 时 reset + 重放到正确时间点
 * 与 BehaviorRecord 并列：behaviors 管持续特效，styleRecords 管一次性状态变更
 */
export interface StyleRecord {
  char: KineticChar;
  styleName: string;
  params: Record<string, any>;
  timePosition: number; // 在 Timeline 上的时间位置 (秒，相对于段落)
}

/**
 * Behavior 特效记录，用于 seek 时重新注册到 Ticker
 */
export interface BehaviorRecord {
  /** removeModifier 目标。char 级 = KineticChar（有 removeModifier）；容器级 = TokenWrapper/KineticText。
   *  字段名保留 `char` 以兼容既有调用点；类型放宽为 Container 以承载 group/block 作用域。 */
  char: Container;
  /** filter 所在容器。char 级与 char 同一对象；容器级 = wrapper/KineticText。
   *  behavior-track filter 的 cleanup 据此从 target.filters 移除。 */
  target: Container;
  effectName: string;
  params: Record<string, any>;
  charIndex: number;
  timePosition: number; // 在 Timeline 上的时间位置 (秒)
}

/**
 * Instant 特效记录（如静态 filter），用于 seek 时从 target.filters 重置后重放。
 *
 * 与 BehaviorRecord / StyleRecord 并列：
 * - behavior 靠 modifier（registerBehaviors/clearBehaviors 管 addModifier/removeModifier）
 * - style 靠 TextStyle 快照（replayStyles 先 resetStyle 再 apply）
 * - instant filter 是一次性挂载（push 进 target.filters），seek 重播前必须先移除旧实例，
 *   否则会随 seek 次数累积。record.apply 回调返回新建的 filter 实例，由 SegmentBuilder
 *   落入 activeInstantCleanups，clearInstantEffects 据此从 target.filters splice 掉。
 *
 * target 在 char 级是 KineticChar，group 级是 TokenWrapper（整词组容器）。
 * block 级不经 TextPlayer（走 EffectProcessor.applyGroupEffects，build 时同步挂载）。
 */
export interface InstantEffectRecord {
  target: Container;
  effectName: string;
  params: Record<string, any>;
  charIndex: number;
  timePosition: number; // 在 Timeline 上的时间位置 (秒)
}

/**
 * 入场特效返回值（当 fn 创建持久 filter 时）。
 * 普通入场特效只 return Tween/Timeline（captureTween 入时间线）；
 * blurIn 等创建 BlurFilter 的入场特效 return 此结构，entrance 分支解包：
 * - tween → captureTween 入时间线（strength 动画靠时间线 kill 释放）
 * - filter → entranceFilters（EntranceFilterRecord），filter 生命周期交
 *   clearEntranceFilters（destroyFilterDeep），与 blur/bloom 等 instant filter 对称。
 * 分离 tween 与 filter 生命周期后，stop kill 时间线不再泄漏 filter（原 onComplete 不触发）。
 */
export interface EntranceFilterResult {
  tween: gsap.core.Tween | gsap.core.Timeline;
  filter: Filter | Filter[];
}

/**
 * 入场特效 filter 清理记录。与 InstantEffectRecord 区别：
 * - InstantEffectRecord：seek 时 registerInstantEffects **重 apply fn**（静态 filter 幂等）。
 * - EntranceFilterRecord：seek 时 **不重 apply**——entrance tween 靠时间线插值到正确状态，
 *   filter 已在 build 期创建并 push 进 target.filters，只需 stop/clearScreen 时清理。
 *   若走 instantEffects 路径会重 apply blurIn → gsap.set(alpha=0) 重置 + rogue tween +
 *   destroy() 对 {tween,filter} 对象崩溃。
 */
export interface EntranceFilterRecord {
  target: Container;
  filter: Filter | Filter[];
  timePosition: number;
}

/**
 * buildTimeline 的返回结果
 */
export interface TimelineBuildResult {
  timeline: gsap.core.Timeline;
  behaviors: BehaviorRecord[];
  styleRecords: StyleRecord[];
  instantEffects: InstantEffectRecord[];
  entranceFilters: EntranceFilterRecord[];
  stageModifierRecords: StageModifierRecord[];
  duration: number; // 秒
  /** >>> 触发的时间点 (秒)。ScriptPlayer 应在此位置启动下一段落的子 Timeline。undefined 表示无提前推进。 */
  advanceTime?: number;
}

export interface TextTimelineBuildOptions {
  speed?: number;
  onLineUpdate?: (line: number) => void;
  /**
   * R22/SA-37：playback runtime state，供 unroll*Chain / TextStageCueScheduler.schedule 的
   * style / stage-modifier tl.call 读 lastSeekTime 做 exact-boundary 抑制。可选——构建期
   * （如测试/独立 buildTimeline 调用）不传时 guard 读 undefined，恒不跳过（等价旧行为）。
   */
  playbackState?: { lastSeekTime?: number };
}

export class TextPlayer {
  // ═══════════════════════════════════════════════════════════════
  //  Phase A: Timeline 构建器 (替代 setTimeout 驱动的 play)
  // ═══════════════════════════════════════════════════════════════

  /**
   * 构建一个段落的 gsap.Timeline
   *
   * 将旧 play() 中的 setTimeout 循环转化为确定性的 Timeline 结构。
   * 入场动画 (entrance) 和舞台指令 (stage) 在 Timeline 上有精确时间位置，
   * 持续行为 (behavior) 被收集但不放入 Timeline（由调用方注册到 Ticker）。
   *
   * Timeline 支持 seek(t) 实现即时跳转，GSAP 会自动插值所有动画的中间状态。
   */
  public static buildTimeline(
    target: any, // KineticText
    plan: RuntimeParagraphExecutionPlan,
    options: TextTimelineBuildOptions = {}
  ): TimelineBuildResult {
    // 不设 paused:true —— 子 Timeline 由父 (segmentTl) 控制。
    // GSAP 3 中 paused 子项不受父 Timeline 驱动（§B-bis）。
    const tl = gsap.timeline();
    const behaviors: BehaviorRecord[] = [];
    const styleRecords: StyleRecord[] = [];
    const instantEffects: InstantEffectRecord[] = [];
    const entranceFilters: EntranceFilterRecord[] = [];
    const stageModifierRecords: StageModifierRecord[] = [];
    // 基准揭示速度 (毫秒 → 秒)
    const baseSpeedMs = options.speed ?? target._options?.speed ?? 50;
    const baseSpeed = baseSpeedMs / 1000;
    const allChars = plan.items.map(item => item.char);
    const chainPlansByToken = new Map<number, RuntimeParagraphExecutionPlan["chainPlans"][number]>();
    const tokenPlansByToken = new Map<number, RuntimeParagraphExecutionPlan["tokenPlans"][number]>();
    plan.tokenPlans.forEach((tokenPlan) => {
      tokenPlansByToken.set(tokenPlan.tokenIdx, tokenPlan);
      if (tokenPlan.chainPlan) {
        chainPlansByToken.set(tokenPlan.tokenIdx, tokenPlan.chainPlan);
      }
    });

    TextPlanDiagnosticsSink.reportPlan(plan);
    const timelineCursor = new TextTimelineCursor();

    for (let i = 0; i < allChars.length; i++) {
      const item = plan.items[i]!;
      const char = item.char;
      const isNewLine = item.lifecycle.isLineBreak;
      const tokenPlan = tokenPlansByToken.get(item.tokenIdx);

      // ── 1. 换行处理 ──
      if (isNewLine) {
        timelineCursor.consumeNewLine(baseSpeed);
        continue;
      }

      // ── 2. 时序糖衣 ──

      if (item.lifecycle.isTokenStart) {
        timelineCursor.beginToken(tokenPlan?.pauseCharOverride);
      }

      const timing = EffectProcessor.resolveTiming(item.timingSugars);
      const { delayOverride, isSugarGo, isInstantGo } = timelineCursor.applyTiming(timing);

      // ── 4. Stage 指令（仅空字符：管道符、场景清除等） ──
      // 非空字符的舞台指令见 §5.5（与字符同时触发，阻塞延迟到 token 末）
      if (!char.text.trim()) {
        timelineCursor.addDeferredAdvance(TextStageCueScheduler.collectPauseAdvance(item.stageInstructions, isInstantGo));
        const blockingAdvance = TextStageCueScheduler.schedule(
          tl,
          item.stageInstructions,
          timelineCursor.position,
          this.captureTween,
          stageModifierRecords,
          options.playbackState,
        );
        timelineCursor.addDeferredAdvance(blockingAdvance);
        timelineCursor.flushTokenAdvance(true);
      }

      // ── 5. 放置字符（入场动画 + 行为收集） ──
      if (char.text.trim()) {
        this.placeCharOnTimeline(tl, item, i, timelineCursor.position, behaviors, styleRecords, instantEffects, entranceFilters);

        // 编辑器行号同步
        if (item.line !== undefined) {
          const lineNum = item.line + 1;
          tl.call(() => {
            options.onLineUpdate?.(lineNum);
          }, [], timelineCursor.position);
        }

        // ── 5.5. Stage 指令收集（pause 计入延迟推进；其余收集到 §6.5 与末字同时触发） ──
        timelineCursor.addDeferredAdvance(
          TextStageCueScheduler.collectPauseAdvance(item.stageInstructions, isInstantGo),
        );
      }

      // ── 6. 组特效时序链展开（Token 边界触发） ──
      const isTokenEnd = item.lifecycle.isTokenEnd;
      if (isTokenEnd && tokenPlan && tokenPlan.visualEffects.length > 0) {
        const wrapper = tokenPlan.token;
        const chainPlan = chainPlansByToken.get(item.tokenIdx);
        if (wrapper) {
          const holdCharConfig = tokenPlan.visualEffects.find(
            e => e.name === "hold" && e.level === "char"
          );
          if (holdCharConfig && (!chainPlan || chainPlan.mode === "char_stagger")) {
            if (!chainPlan) {
              TextPlanDiagnosticsSink.warnMissingChainPlan(item.tokenIdx, item.line);
            }
            this.unrollCharChain(tl, wrapper, tokenPlan.visualEffects, timelineCursor.position, behaviors, holdCharConfig, styleRecords, instantEffects, entranceFilters, stageModifierRecords, options.playbackState);
          } else {
            // unrollGroupChain 返回 chain 内 pause 指令的累计时长，追加到 deferredCursorAdvance
            const pauseFromChain = this.unrollGroupChain(tl, wrapper, tokenPlan.visualEffects, timelineCursor.position, behaviors, styleRecords, instantEffects, entranceFilters, stageModifierRecords, options.playbackState);
            if (pauseFromChain > 0) {
              timelineCursor.addDeferredAdvance(pauseFromChain);
            }
          }
        }
      }

      // ── 6.5. Token-end Stage 指令执行（与最后一字同时触发；blocking 追加到 §7.5） ──
      if (isTokenEnd && tokenPlan && tokenPlan.tokenEndStageInstructions.length > 0) {
        timelineCursor.addDeferredAdvance(
          TextStageCueScheduler.schedule(
            tl,
            tokenPlan.tokenEndStageInstructions,
            timelineCursor.position,
            this.captureTween,
            stageModifierRecords,
            options.playbackState,
          ),
        );
      }

      // ── 7. 推进 cursor ──
      timelineCursor.advanceChar({
        charText: char.text,
        baseSpeed,
        isInstantGo,
        delayOverride,
      });

      // ── 7.5. Token-end 延迟 cursor 推进（pause / 阻塞舞台指令） ──
      timelineCursor.flushTokenAdvance(isTokenEnd);

      // ── 8. 状态流转 ──
      timelineCursor.finishItem({ isTokenEnd, isSugarGo, delayOverride });
    }

    return {
      timeline: tl,
      behaviors,
      styleRecords,
      instantEffects,
      entranceFilters,
      stageModifierRecords,
      duration: timelineCursor.position,
      advanceTime: timelineCursor.advanceTime,
    };
  }

  /**
   * 将单个字符的入场动画放到 Timeline 上，收集行为特效
   */
  private static placeCharOnTimeline(
    tl: gsap.core.Timeline,
    item: RuntimeParagraphExecutionPlan["items"][number],
    charIndex: number,
    cursor: number,
    behaviors: BehaviorRecord[],
    // R15：pre-hold 样式不再在此注册（已在 baseline），styleRecords 在 placeCharOnTimeline 内
    // 不再写入。参数保留以维持调用签名（callers 仍传），标记 _ 前缀示刻意未用。
    _styleRecords: StyleRecord[],
    instantEffects: InstantEffectRecord[],
    entranceFilters: EntranceFilterRecord[]
  ) {
    const char = item.char;
    const visualEffects = item.visualEffects;
    // 分类该字符的视觉特效
    const classified = EffectProcessor.classifyByTrack(visualEffects);

    // R15/SA-30：pre-hold 初始样式不再注册为 StyleRecord。
    // 构建期 LayoutPlanner.applyInitialStylesToStyle 已把 pre-hold 样式烘焙进 glyphPlan.style
    //（= KineticChar 构造 style），且 R15 把 baseStyleSnapshot 改成这个烘焙态。于是：
    //   - seek reset：resetStyle() 回 baseline（已含 pre-hold），不需要 record 重放；
    //   - 自然播放：pre-hold 样式构建期已生效，无独立 tl.call，删除 record 不影响。
    // 旧逻辑在此把 pre-hold 样式当 record 注册（timePosition=cursor），seek 重放时会从
    // baseline 再 apply 一次——绝对样式（red）幂等无害，相对样式（big: 36→54）双重放大。
    // 删除整段注册，styleRecords 只保留 post-hold / hold-chain 动态样式（site 2/3 的 post-hold 部分）。

    // 收集 behavior 特效（F4: resolveParams 解析变量引用）
    // - hold:char 链：全部跳过（unrollCharChain 以错开时序逐字处理）
    // - 组级 hold 链：全部跳过（unrollGroupChain 在链时间点统一分流到 char 或 container）
    // - 无 hold 链：全部注册（与字符出现时间错开，stagger with appearance）
    const hasHoldChar = visualEffects.some(e => e.name === "hold" && e.level === "char");
    const hasGroupHold = visualEffects.some(e => e.name === "hold" && e.level !== "char");
    if (!hasHoldChar && !hasGroupHold) {
      for (const cfg of classified.behavior) {
        behaviors.push({
          char,
          target: char,
          effectName: cfg.name,
          params: { ...EffectProcessor.resolveParams(cfg.params), charIndex },
          charIndex,
          timePosition: cursor
        });
      }

      // 收集 instant 特效（静态 filter 等一次性挂载）。
      // classified.instant 在修复前是死桶——placeCharOnTimeline 只读 .behavior/.entrance，
      // 导致 track:"instant" 的 filter fn 永不执行。这里与 behavior 对称收集，
      // 由 SegmentBuilder 在 cursor 时刻 tl.call 触发 apply；seek 时由
      // PlaybackController.registerInstantEffects reset+replay 实现幂等。
      // style 特效跳过——它们由 applyInitialStylesToStyle 预应用、经 styleRecords 重放，不挂 target.filters。
      // R17/SA-32：isStyle 经 classifyStyleWrite 单一真相源（统一所有 style 判定入口）。
      for (const cfg of classified.instant) {
        if (EffectProcessor.classifyStyleWrite(cfg).isStyle) continue;
        instantEffects.push({
          target: char,
          effectName: cfg.name,
          params: { ...EffectProcessor.resolveParams(cfg.params), charIndex },
          charIndex,
          timePosition: cursor
        });
      }
    }

    // 确定入场特效
    let enterConfig: EffectConfig | null = null;
    const otherEntrance: EffectConfig[] = [];
    for (const cfg of classified.entrance) {
      const meta = effectManager.getMetadata(cfg.name);
      if (meta?.mutexGroup === "enter" && !enterConfig) {
        enterConfig = cfg;
      } else {
        otherEntrance.push(cfg);
      }
    }

    // 使 char 在 cursor 时间可见
    tl.set(char, { visible: true }, cursor);

    // 放置入场动画
    if (enterConfig) {
      const tween = effectManager.apply(
        char, enterConfig.name,
        { ...(enterConfig.params || {}), delay: 0 },
        true
      );
      this.captureEntrance(tl, tween, cursor, char, entranceFilters);
    } else {
      // 默认 fadeIn
      char.animOffset.alpha = 0;
      const tween = gsap.to(char.animOffset, {
        alpha: 1, duration: 0.3, ease: "power1.out"
      });
      tl.add(tween, cursor);
    }

    // 其他入场级特效（如 punch，非 "enter" 互斥组）
    for (const cfg of otherEntrance) {
      const tween = effectManager.apply(char, cfg.name, cfg.params || {}, true);
      this.captureEntrance(tl, tween, cursor, char, entranceFilters);
    }
  }

  /**
   * 捕获特效函数返回的 Tween/Timeline，挂到父 Timeline
   * 不 pause —— GSAP 3 中 paused 子项不受父 Timeline 驱动（§B-bis：paused child 不被父 timeline 驱动）
   */
  private static captureTween(
    tl: gsap.core.Timeline,
    result: any,
    position: number
  ) {
    if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
      tl.add(result, position);
    }
  }

  /**
   * 捕获入场特效返回值。与 captureTween 对称，但额外处理 EntranceFilterResult
   * （blurIn 等创建持久 filter 的入场特效）：
   * - tween → captureTween 入时间线
   * - filter → push 进 entranceFilters（EntranceFilterRecord），filter 生命周期交
   *   clearEntranceFilters（destroyFilterDeep）。**不进 instantEffects**——instantEffects
   *   会被 registerInstantEffects 在 seek 时重 apply fn（blurIn 重 apply 会 gsap.set(alpha=0)
   *   重置 + rogue tween + destroy() 对 {tween,filter} 崩溃）。entranceFilters 仅用于
   *   stop/clearScreen 清理，seek 时不重 apply（entrance tween 靠时间线插值到正确状态）。
   */
  private static captureEntrance(
    tl: gsap.core.Timeline,
    result: any,
    position: number,
    target: Container,
    entranceFilters: EntranceFilterRecord[]
  ) {
    if (result && typeof result === 'object' && 'tween' in result && 'filter' in result) {
      const efr = result as EntranceFilterResult;
      this.captureTween(tl, efr.tween, position);
      entranceFilters.push({
        target,
        filter: efr.filter,
        timePosition: position,
      });
    } else {
      this.captureTween(tl, result, position);
    }
  }

  /**
   * 将组特效的时序链展开到 Timeline 上
   *
   * 分流规则（以"是否存在组级 hold"为分水岭）：
   *
   * 无 hold 链时：
   *   - behaviors 由 placeCharOnTimeline 逐字注册（与出现时机 stagger），此处不重复
   *   - 样式/入场效果仍在此处于 token-end 时间点应用
   *
   * 有 hold:group 时（placeCharOnTimeline 已跳过所有 behaviors）：
   *   - isCharLevel 特效 (targetType="char" 或 level="char") → 逐字独立应用到 wrapper.chars
   *   - 其余 (targetType="both"/"group", style) → 应用到 wrapper 容器
   *   - 链末尾的 trailing hold → no-op（hold 只管链内时序；外层暂停请用 pause 或 |）
   */
  private static unrollGroupChain(
    tl: gsap.core.Timeline,
    wrapper: TokenWrapper,
    effects: EffectConfig[],
    startPosition: number,
    behaviors: BehaviorRecord[],
    styleRecords: StyleRecord[],
    instantEffects: InstantEffectRecord[],
    entranceFilters: EntranceFilterRecord[],
    stageModifierRecords: StageModifierRecord[],
    playbackState?: { lastSeekTime?: number },
  ): number {
    const { visualConfigs, stageConfigs } = EffectProcessor.partition(effects);
    let chainCursor = startPosition;
    // pause 指令的语义是段级暂停，链中的 pause 时长应当传回 buildTimeline 的 deferredCursorAdvance
    let totalPauseDur = 0;

    // ── 1. 舞台指令链 ──
    for (const config of stageConfigs) {
      if (config.name === "pause") {
        if ((config as any).level === "char") continue;
        const dur = EffectProcessor.resolvePauseDuration(config.params, 1);
        chainCursor += dur;
        totalPauseDur += dur;
      } else {
        // 单一真相源：buildStageModifierRecord 决定 cam.reset（clear boundary）/ modifierBased /
        // 可 seek tween 的分流（与 global applyStageConfigs、inline TextStageCueScheduler 对称）。
        // SA-12 根本修复：上一版只判 modifierBased，effect chain 里的 cam.reset 落 else 只 captureTween，
        // 不写 StageModifierRecord → seek 到 reset 后 replayStageModifiers 找不到边界。
        const record = buildStageModifierRecord(config.name, config.params);
        if (record) {
          stageModifierRecords.push({ ...record, timePosition: chainCursor });
          if (record.isClearBoundary) {
            // cam.reset：可 seek tween（reset timeline），走 apply + captureTween。
            const result = stageManager.apply(config.name, config.params || {});
            TextPlayer.captureTween(tl, result, chainCursor);
            if (config.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
              chainCursor += result.duration();
            }
          } else {
            // modifierBased（cam.shake/cam.drift）：经 tl.call 延迟 apply。
            const cfgCopy = { type: config.name, params: buildStageModifierApplyParams(config.name, config.params) };
            // R22/SA-37：exact-boundary guard（见 SegmentBuilder 同类注释）。
            // R22-followup：params 经 buildStageModifierApplyParams 预解析（与 seek 重放同源）。
            const modRecTime = chainCursor;
            tl.call(() => {
              if (playbackState?.lastSeekTime === modRecTime) return;
              stageManager.apply(cfgCopy.type, cfgCopy.params);
            }, [], chainCursor);
          }
        } else {
          const result = stageManager.apply(config.name, config.params || {});
          TextPlayer.captureTween(tl, result, chainCursor);
          if (config.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
            chainCursor += result.duration();
          }
        }
      }
    }

    // ── 2. 视觉链条展开 ──
    chainCursor = startPosition;
    let groupHoldEncountered = false;
    // 是否存在组级 hold — 影响 char-level behaviors 的分流策略
    const hasGroupHold = visualConfigs.some(c => c.name === "hold" && c.level !== "char");

    for (const config of visualConfigs) {
      const meta = effectManager.getMetadata(config.name);
      // R17/SA-32 + R19/SA-33：isStyle + isBlocking 都经 classifyStyleWrite 单一真相源。
      // site2 的 pre-hold 跳过（shouldExecute 里 `if (isStyle) return false`）与 helper 的 isInitial
      // 语义对齐——pre-hold 样式已在 baseline（P1/P2 烘焙），site2 只处理 post-hold 动态样式（进 record）。
      // **R19**：显式 group/block style（`f.red:group` / token 级 `f.red:block`）的 pre-hold 部分现由
      // P1 烘焙进 baseline（classifyStyleWrite 对 style 解耦 level 边界），site2 仍按 `if(isStyle) return
      // false` 跳过——避免双重应用。post-hold 的 group/block style（链中 hold 之后）才经此处的
      // tl.call + styleRecords 注册（groupHoldEncountered=true → shouldExecute=true）。
      const { isStyle, isBlocking } = EffectProcessor.classifyStyleWrite(config);

      // f.pause:char → pauseCharOverride 已处理
      if (isBlocking && config.level === "char") continue;

      // hold → 推进链游标（链末尾无后续效果时为 no-op，外层暂停请用 pause 或 |）
      if (isBlocking) {
        if (config.name === "hold") {
          const dur = EffectProcessor.resolvePauseDuration(config.params, 1);
          chainCursor += dur;
        }
        groupHoldEncountered = true;
        continue;
      }

      // ── 目标粒度判断 ──
      // isCharLevel：效果应逐字独立应用（而非作用于整个 wrapper 容器）。
      // INV-7（SA-18）：经 EffectProcessor.isCharLevelEffect 单一真相源判定（含 action 排除）。
      // 样式统一走 applyStyleRecursively，不走 isCharLevel 分支（前置 !isStyle gate）。
      const isCharLevel = !isStyle && EffectProcessor.isCharLevelEffect(config);

      // ── shouldExecute 判断 ──
      // pre-hold 阶段：
      //   - 样式 → 跳过（TextBuilder/applyInitialStylesToStyle 已在构建期处理）
      //   - char-level (char/both, 无显式 level) + 有组级 hold → 执行（placeCharOnTimeline 已跳过）
      //   - char-level + 无组级 hold → 跳过（placeCharOnTimeline 已处理）
      //   - 容器级 (explicit group/block / targetType="group" / action) → 执行
      // post-hold 阶段：一律执行
      const shouldExecute = (() => {
        if (groupHoldEncountered) return true;
        if (isStyle) return false;
        if (isCharLevel) return hasGroupHold;
        return (config.level === "group" || config.level === "block" || config.level === "bg") ||
          (meta != null && meta.targetType === "group") ||
          (!config.level && meta != null && meta.type === "action");
      })();

      if (!shouldExecute) continue;

      const resolved = EffectProcessor.resolveParams(config.params || {});
      const track = EffectProcessor.getTrack(config.name);

      if (isStyle) {
        // Bug 2: :bg scope style 不走 applyStyleRecursively（Sprite 无 getGraphicsLayer/tokens）。
        if (config.level === "bg") {
          console.warn(`[TextPlayer] :bg inline style "${config.name}" — not applicable to bg sprite, skipped`);
          continue;
        }
        // 样式：applyStyleRecursively 内部已递归到每字
        const cfgName = config.name;
        const cfgParams = { ...resolved };
        // R22/SA-37：exact-boundary guard（见 SegmentBuilder 同类注释）。防 big/small 等
        // 相对样式双 mutate（×1.5 两次 = ×2.25 几何错）。
        const styleRecTime = chainCursor;
        tl.call(() => {
          if (playbackState?.lastSeekTime === styleRecTime) return;
          EffectProcessor.applyStyleRecursively(wrapper, cfgName, cfgParams, true);
        }, [], chainCursor);
        // StyleRecord：逐字记录（供 seek 时 reset+重放）
        wrapper.chars.forEach(c => {
          if (!c.text.trim()) return;
          styleRecords.push({ char: c, styleName: cfgName, params: { ...cfgParams }, timePosition: chainCursor });
        });
      } else if (isCharLevel) {
        // Char-level 特效：逐字独立应用到 wrapper.chars
        wrapper.chars.forEach((char, idx) => {
          if (!char.text.trim()) return;
          const charResolved = { ...resolved, charIndex: idx };
          if (track === "entrance") {
            const tween = effectManager.apply(char, config.name, { ...charResolved, delay: 0 }, true);
            TextPlayer.captureEntrance(tl, tween, chainCursor, char, entranceFilters);
          } else if (track === "behavior") {
            behaviors.push({
              char,
              target: char,
              effectName: config.name,
              params: charResolved,
              charIndex: idx,
              timePosition: chainCursor
            });
          } else {
            // instant filter（非 entrance/behavior）：只记录，apply 驱动交给
            // SegmentBuilder 的 segmentTl.call（它有 cleanup 追踪 + isAutoPlaying 守卫）。
            // 不在此 tl.call —— 否则与 SegmentBuilder 重复 apply（双滤镜 + 泄漏）。
            instantEffects.push({
              target: char,
              effectName: config.name,
              params: { ...charResolved },
              charIndex: idx,
              timePosition: chainCursor
            });
          }
        });
      } else {
        // Bug 2: :bg scope 内联链路 (@ f.x:bg) — target 解析为背景精灵而非 wrapper。
        const bgTarget = config.level === "bg" ? stageManager.getBackgroundSprite() : null;
        if (bgTarget === null && config.level === "bg") {
          console.warn(`[TextPlayer] :bg inline effect "${config.name}" skipped — no background sprite`);
          continue;
        }
        const containerTarget = bgTarget ?? wrapper;

        // 组级特效：应用到 containerTarget 容器
        if (track === "entrance") {
          const tween = effectManager.apply(containerTarget, config.name, resolved, true);
          this.captureEntrance(tl, tween, chainCursor, containerTarget, entranceFilters);
        } else if (track === "behavior") {
          // 容器级 behavior：经 behaviors[] → SegmentBuilder segmentTl.call 统一 apply +
          // cleanup 追踪（与 char 级对称）。target = containerTarget，char = containerTarget
          // （容器无 removeModifier，clearBehaviors 守卫跳过 modifier 清理，靠 filterInstance + tickerFn）。
          behaviors.push({
            char: containerTarget,
            target: containerTarget,
            effectName: config.name,
            params: { ...resolved },
            charIndex: 0,
            timePosition: chainCursor
          });
        } else {
          // instant filter（组级容器）：只记录，apply 驱动交给 SegmentBuilder。
          instantEffects.push({
            target: containerTarget,
            effectName: config.name,
            params: { ...resolved },
            charIndex: 0,
            timePosition: chainCursor
          });
        }
      }
    }

    return totalPauseDur;
  }

  /**
   * hold:char 特效链展开
   *
   * `f.red.hold:char(0.5s).shake:char` 意味着：
   *   - char[0] at T+0.0s: 着红 + 注册 shake
   *   - char[1] at T+0.5s: 着红 + 注册 shake
   *   - char[2] at T+1.0s: 着红 + 注册 shake
   *
   * 特效链按字符粒度执行，每个字符间隔 hold:char 指定的时长。
   * Stage 指令只执行一次（不 per-char）。
   */
  private static unrollCharChain(
    tl: gsap.core.Timeline,
    wrapper: TokenWrapper,
    effects: EffectConfig[],
    startPosition: number,
    behaviors: BehaviorRecord[],
    holdConfig: EffectConfig,
    styleRecords: StyleRecord[],
    instantEffects: InstantEffectRecord[],
    entranceFilters: EntranceFilterRecord[],
    stageModifierRecords: StageModifierRecord[],
    playbackState?: { lastSeekTime?: number },
  ) {
    const { visualConfigs, stageConfigs } = EffectProcessor.partition(effects);
    const holdDelay = EffectProcessor.resolvePauseDuration(holdConfig.params, 0.5);

    // 1. Stage 指令只执行一次
    for (const config of stageConfigs) {
      if (config.name === "pause") {
        // pause: 已在 Stage 指令阶段处理，这里忽略
      } else {
        // 单一真相源：buildStageModifierRecord 决定 cam.reset（clear boundary）/ modifierBased /
        // 可 seek tween 的分流（与 global applyStageConfigs、inline TextStageCueScheduler、
        // unrollGroupChain 对称）。SA-12 根本修复：char-chain 里的 cam.reset 现在也写 boundary record。
        const record = buildStageModifierRecord(config.name, config.params);
        if (record) {
          stageModifierRecords.push({ ...record, timePosition: startPosition });
          if (record.isClearBoundary) {
            // cam.reset：可 seek tween（reset timeline），走 apply + captureTween。
            const result = stageManager.apply(config.name, config.params || {});
            TextPlayer.captureTween(tl, result, startPosition);
          } else {
            // modifierBased（cam.shake/cam.drift）：经 tl.call 延迟 apply。
            const cfgCopy = { type: config.name, params: buildStageModifierApplyParams(config.name, config.params) };
            // R22/SA-37：exact-boundary guard（见 SegmentBuilder 同类注释）。
            // R22-followup：params 经 buildStageModifierApplyParams 预解析（与 seek 重放同源）。
            const modRecTime = startPosition;
            tl.call(() => {
              if (playbackState?.lastSeekTime === modRecTime) return;
              stageManager.apply(cfgCopy.type, cfgCopy.params);
            }, [], startPosition);
          }
        } else {
          const result = stageManager.apply(config.name, config.params || {});
          TextPlayer.captureTween(tl, result, startPosition);
        }
      }
    }

    // 2. 过滤掉 hold:char 本身（它是 stagger 间距参数 holdDelay，不是链步骤），
    //    但保留每个 effect 在【原始 visualConfigs】中的 origIdx。
    //    R20/SA-35：pre-hold 边界必须在原始链上判定（含 hold:char）——hold:char 是 name==="hold"
    //    → classifyStyleWrite.isBlocking=true，是边界触发点。若先滤掉 hold:char 再算边界（旧行为），
    //    边界循环找不到 blocking → firstBlockingOrigIdx=末尾 → 所有剩余 style 被当 pre-hold 跳过 →
    //    post-hold style（如 f.hold:char.red 的 red）被吞（既不进 baseline 也不进 record）。
    const activeEffects: { config: EffectConfig; origIdx: number }[] = [];
    visualConfigs.forEach((c, idx) => {
      if (!(c.name === "hold" && c.level === "char")) {
        activeEffects.push({ config: c, origIdx: idx });
      }
    });

    // R20/SA-35：pre-hold 边界在【原始 visualConfigs】上算（含 hold:char），与构建期
    // applyInitialStylesToStyle（P1）对齐——P1 在 hold:char 处 break，故 hold:char 之前的 style
    // 进 baseline（pre-hold），之后的 style 是 post-hold（应进 record，site3 tl.call + styleRecords）。
    // 旧逻辑在过滤后的 activeEffects 上算，hold:char 已被滤掉 → 边界失效（见上注释）。
    let firstBlockingOrigIdx = visualConfigs.length;
    for (let i = 0; i < visualConfigs.length; i++) {
      if (EffectProcessor.classifyStyleWrite(visualConfigs[i]!).isBlocking) {
        firstBlockingOrigIdx = i;
        break;
      }
    }

    // 3. 逐字应用
    let charCursor = startPosition;
    for (const char of wrapper.chars) {
      if (!char.text.trim()) { charCursor += holdDelay; continue; }

      for (let i = 0; i < activeEffects.length; i++) {
        const { config, origIdx } = activeEffects[i]!;
        const track = EffectProcessor.getTrack(config.name);
        // R17/SA-32：isStyle 经 classifyStyleWrite 单一真相源。
        const isStyle = EffectProcessor.classifyStyleWrite(config).isStyle;
        const resolved = EffectProcessor.resolveParams(config.params);

        if (isStyle) {
          // R20/SA-35：pre-hold 样式已在 baseline（P1 烘焙），跳过（避免双重应用 big/small）。
          // 边界用 origIdx（原始链位置）判，与 P1 的 break 位置对齐。
          if (origIdx < firstBlockingOrigIdx) continue;
          const cfgName = config.name;
          const cfgParams = { ...resolved };
          const charRef = char;
          // R22/SA-37：exact-boundary guard（见 SegmentBuilder 同类注释）。防 big/small 等
          // 相对样式双 mutate。charCursor 是循环内 let（每字推进），闭包内须捕获为常量。
          const styleRecTime = charCursor;
          tl.call(() => {
            if (playbackState?.lastSeekTime === styleRecTime) return;
            styleManager.apply(charRef.style, cfgName, cfgParams, true);
          }, [], charCursor);
          styleRecords.push({ char, styleName: cfgName, params: { ...cfgParams }, timePosition: charCursor });
        } else if (track === "entrance") {
          const tween = effectManager.apply(char, config.name, { ...resolved, delay: 0 }, true);
          TextPlayer.captureEntrance(tl, tween, charCursor, char, entranceFilters);
        } else if (track === "behavior") {
          const cIdx = wrapper.chars.indexOf(char);
          behaviors.push({
            char,
            target: char,
            effectName: config.name,
            params: { ...resolved, charIndex: cIdx },
            charIndex: cIdx,
            timePosition: charCursor
          });
        } else {
          // instant filter（逐字）：只记录，apply 驱动交给 SegmentBuilder。
          instantEffects.push({
            target: char,
            effectName: config.name,
            params: { ...resolved },
            charIndex: wrapper.chars.indexOf(char),
            timePosition: charCursor
          });
        }
      }

      charCursor += holdDelay;
    }
  }
}
