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
import type { ParagraphDisplayAssembly, TextExecutionItemPayload } from "./types";
import type { Container } from "pixi.js";
import gsap from "gsap";

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
  char: KineticChar;
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
 * buildTimeline 的返回结果
 */
export interface TimelineBuildResult {
  timeline: gsap.core.Timeline;
  behaviors: BehaviorRecord[];
  styleRecords: StyleRecord[];
  instantEffects: InstantEffectRecord[];
  duration: number; // 秒
  /** >>> 触发的时间点 (秒)。ScriptPlayer 应在此位置启动下一段落的子 Timeline。undefined 表示无提前推进。 */
  advanceTime?: number;
}

export interface TextTimelineBuildOptions {
  speed?: number;
  onLineUpdate?: (line: number) => void;
}

export interface LegacyTextPlaybackOptions {
  speed?: number;
  mode?: string;
  onAdvance?: () => void;
  onTimeUpdate?: (timeMs: number) => void;
  onLineUpdate?: (line: number) => void;
}

export class TextPlayer {
  private static isNewLineItem(item: TextExecutionItemPayload) {
    return item.isNewLine || item.char.text === "\n";
  }

  private static sliceLegacyPlaybackAssembly(
    assembly: Pick<ParagraphDisplayAssembly, "tokens" | "executionItems">,
    executionItems: TextExecutionItemPayload[],
  ): Pick<ParagraphDisplayAssembly, "tokens" | "executionItems"> {
    return {
      tokens: assembly.tokens,
      executionItems,
    };
  }

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
    // GSAP 3 中 paused 子项不受父 Timeline 驱动。
    const tl = gsap.timeline();
    const behaviors: BehaviorRecord[] = [];
    const styleRecords: StyleRecord[] = [];
    const instantEffects: InstantEffectRecord[] = [];
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
        );
        timelineCursor.addDeferredAdvance(blockingAdvance);
        timelineCursor.flushTokenAdvance(true);
      }

      // ── 5. 放置字符（入场动画 + 行为收集） ──
      if (char.text.trim()) {
        this.placeCharOnTimeline(tl, item, i, timelineCursor.position, behaviors, styleRecords, instantEffects);

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
            this.unrollCharChain(tl, wrapper, tokenPlan.visualEffects, timelineCursor.position, behaviors, holdCharConfig, styleRecords, instantEffects);
          } else {
            // unrollGroupChain 返回 chain 内 pause 指令的累计时长，追加到 deferredCursorAdvance
            const pauseFromChain = this.unrollGroupChain(tl, wrapper, tokenPlan.visualEffects, timelineCursor.position, behaviors, styleRecords, instantEffects);
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
    styleRecords: StyleRecord[],
    instantEffects: InstantEffectRecord[]
  ) {
    const char = item.char;
    const visualEffects = item.visualEffects;
    // 分类该字符的视觉特效
    const classified = EffectProcessor.classifyByTrack(visualEffects);

    // 捕获 pre-hold 样式为 StyleRecord（在字符揭示时间点），供 seek 时重放
    // 镜像 applyInitialStyles 的逻辑：遇到第一个 hold/blocking 就停止
    for (const eff of visualEffects) {
      if (eff.name === "hold" || eff.blocking) break;
      if (styleManager.has(eff.name)) {
        styleRecords.push({
          char,
          styleName: eff.name,
          params: EffectProcessor.resolveParams(eff.params || {}),
          timePosition: cursor
        });
      }
    }

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
      // style 特效跳过（styleManager.has gate）——它们由 applyInitialStyles 预应用、
      // 经 styleRecords 重放，不挂 target.filters。
      for (const cfg of classified.instant) {
        if (styleManager.has(cfg.name)) continue;
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
      this.captureTween(tl, tween, cursor);
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
      this.captureTween(tl, tween, cursor);
    }
  }

  /**
   * 捕获特效函数返回的 Tween/Timeline，挂到父 Timeline
   * 不 pause —— GSAP 3 中 paused 子项不受父 Timeline 驱动
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
    instantEffects: InstantEffectRecord[]
  ): number {
    const { visualConfigs, stageConfigs } = EffectProcessor.partition(effects);
    let chainCursor = startPosition;
    // pause 指令的语义是段级暂停，链中的 pause 时长应当传回 buildTimeline 的 deferredCursorAdvance
    let totalPauseDur = 0;

    // ── 1. 舞台指令链 ──
    for (const config of stageConfigs) {
      if (config.name === "pause") {
        if ((config as any).level === "char") continue;
        const dur = Number(config.params?.duration ?? config.params?.d ?? config.params?.[0] ?? 1);
        chainCursor += dur;
        totalPauseDur += dur;
      } else if (stageManager.getCommandMetadata(config.name)?.modifierBased) {
        const cfgCopy = { type: config.name, params: { ...(config.params || {}) } };
        tl.call(() => {
          stageManager.apply(cfgCopy.type, cfgCopy.params);
        }, [], chainCursor);
      } else {
        const result = stageManager.apply(config.name, config.params || {});
        TextPlayer.captureTween(tl, result, chainCursor);
        if (config.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
          chainCursor += result.duration();
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
      const isStyle = styleManager.has(config.name);
      const isBlocking = config.name === "hold" || config.blocking;

      // f.pause:char → pauseCharOverride 已处理
      if (isBlocking && config.level === "char") continue;

      // hold → 推进链游标（链末尾无后续效果时为 no-op，外层暂停请用 pause 或 |）
      if (isBlocking) {
        if (config.name === "hold") {
          const dur = Number(config.params?.duration ?? config.params?.d ?? config.params?.[0] ?? 1);
          chainCursor += dur;
        }
        groupHoldEncountered = true;
        continue;
      }

      // ── 目标粒度判断 ──
      // isCharLevel：效果应逐字独立应用（而非作用于整个 wrapper 容器）
      // 规则：无显式 level 时，targetType="char" 和 targetType="both" 均默认字符路径
      //       （targetType 描述能力，不决定默认目标；想要容器路径请显式写 :group / :block）
      // 样式统一走 applyStyleRecursively，不走 isCharLevel 分支
      const isCharLevel = !isStyle && (
        config.level === "char" ||
        (!config.level && meta && (meta.targetType === "char" || meta.targetType === "both"))
      );

      // ── shouldExecute 判断 ──
      // pre-hold 阶段：
      //   - 样式 → 跳过（TextBuilder/applyInitialStyles 已在构建期处理）
      //   - char-level (char/both, 无显式 level) + 有组级 hold → 执行（placeCharOnTimeline 已跳过）
      //   - char-level + 无组级 hold → 跳过（placeCharOnTimeline 已处理）
      //   - 容器级 (explicit group/block / targetType="group" / action) → 执行
      // post-hold 阶段：一律执行
      const shouldExecute = (() => {
        if (groupHoldEncountered) return true;
        if (isStyle) return false;
        if (isCharLevel) return hasGroupHold;
        return (config.level === "group" || config.level === "block") ||
          (meta != null && meta.targetType === "group") ||
          (!config.level && meta != null && meta.type === "action");
      })();

      if (!shouldExecute) continue;

      const resolved = EffectProcessor.resolveParams(config.params || {});
      const track = EffectProcessor.getTrack(config.name);

      if (isStyle) {
        // 样式：applyStyleRecursively 内部已递归到每字
        const cfgName = config.name;
        const cfgParams = { ...resolved };
        tl.call(() => {
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
            TextPlayer.captureTween(tl, tween, chainCursor);
          } else if (track === "behavior") {
            behaviors.push({
              char,
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
        // 组级特效：应用到 wrapper 容器
        if (track === "entrance") {
          const tween = effectManager.apply(wrapper, config.name, resolved, true);
          this.captureTween(tl, tween, chainCursor);
        } else if (track === "behavior") {
          const cfgName = config.name;
          const cfgParams = { ...resolved };
          tl.call(() => {
            effectManager.apply(wrapper, cfgName, cfgParams, true);
          }, [], chainCursor);
        } else {
          // instant filter（组级容器）：只记录，apply 驱动交给 SegmentBuilder。
          instantEffects.push({
            target: wrapper,
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
    instantEffects: InstantEffectRecord[]
  ) {
    const { visualConfigs, stageConfigs } = EffectProcessor.partition(effects);
    const holdDelay = Number(holdConfig.params?.duration ?? holdConfig.params?.d ?? holdConfig.params?.[0] ?? 0.5);

    // 1. Stage 指令只执行一次
    for (const config of stageConfigs) {
      if (config.name === "pause") {
        // pause: 已在 Stage 指令阶段处理，这里忽略
      } else if (stageManager.getCommandMetadata(config.name)?.modifierBased) {
        const cfgCopy = { type: config.name, params: { ...(config.params || {}) } };
        tl.call(() => { stageManager.apply(cfgCopy.type, cfgCopy.params); }, [], startPosition);
      } else {
        const result = stageManager.apply(config.name, config.params || {});
        TextPlayer.captureTween(tl, result, startPosition);
      }
    }

    // 2. 过滤掉 hold:char 本身，得到实际效果链
    const activeEffects = visualConfigs.filter(c => !(c.name === "hold" && c.level === "char"));

    // 3. 逐字应用
    let charCursor = startPosition;
    for (const char of wrapper.chars) {
      if (!char.text.trim()) { charCursor += holdDelay; continue; }

      for (const config of activeEffects) {
        const track = EffectProcessor.getTrack(config.name);
        const isStyle = styleManager.has(config.name);
        const resolved = EffectProcessor.resolveParams(config.params);

        if (isStyle) {
          const cfgName = config.name;
          const cfgParams = { ...resolved };
          const charRef = char;
          tl.call(() => {
            styleManager.apply(charRef.style, cfgName, cfgParams, true);
          }, [], charCursor);
          styleRecords.push({ char, styleName: cfgName, params: { ...cfgParams }, timePosition: charCursor });
        } else if (track === "entrance") {
          const tween = effectManager.apply(char, config.name, { ...resolved, delay: 0 }, true);
          TextPlayer.captureTween(tl, tween, charCursor);
        } else if (track === "behavior") {
          const cIdx = wrapper.chars.indexOf(char);
          behaviors.push({
            char,
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


  // ═══════════════════════════════════════════════════════════════
  //  Legacy: setTimeout 驱动的播放 (保留向后兼容)
  // ═══════════════════════════════════════════════════════════════

  /**
   * 核心重构：带时间上报的播放逻辑
   */
  public static async play(
    target: any,
    assembly: Pick<ParagraphDisplayAssembly, "tokens" | "executionItems">,
    absStartTime: number,
    options: LegacyTextPlaybackOptions = {}
  ): Promise<{ skipAutoPause?: boolean }> {
    const items = assembly.executionItems;
    const tokens = assembly.tokens;
    let baseRevealSpeed = options.speed ?? target._options.speed ?? 50;
    let virtualElapsed = 0;

    let lastWasInstantGo = false;
    let persistentSpeedMultiplier = 1.0;
    let groupSpeedMultiplier = 1.0;

    for (let i = 0; i < items.length; i++) {
      if (target._stopRequested) return { skipAutoPause: true };

      const item = items[i]!;
      const char = item.char;
      const realIdx = i;
      const isNewLine = this.isNewLineItem(item);

      // 1. 更新行号 (仅对可见字符)
      if (item.line !== undefined && char.text.trim()) {
        options.onLineUpdate?.(item.line + 1);
      }

      // 2. 处理行级重置
      if (isNewLine) {
        persistentSpeedMultiplier = 1.0;
        groupSpeedMultiplier = 1.0;
        lastWasInstantGo = false;
      }

      // 3. 检查节奏糖衣
      const timing = EffectProcessor.resolveTiming(item.timingSugars);
      if (timing.speedMultiplier !== undefined) {
        persistentSpeedMultiplier = timing.speedMultiplier;
      }

      const delayOverride = timing.delayOverride;
      const advanceLevel = timing.advanceLevel;

      const isSugarGo = (delayOverride === 0);
      const isInstantGo = isSugarGo || lastWasInstantGo;

      // 4. 执行指令并捕获速度变化
      const charEffectRes = await EffectProcessor.applyCharEffects(char, item.visualEffects, realIdx);
      if (charEffectRes.speedMultiplier !== undefined) {
        persistentSpeedMultiplier = charEffectRes.speedMultiplier;
      }

      // 5. 更新同步时间
      options.onTimeUpdate?.(absStartTime + virtualElapsed);

      // 6. 渲染触发与防闪烁
      if (char.text.trim()) {
        char.visible = true;

        // 核心修复：无论是 instant 还是 normal，都触发 applyEffect
        // 但通过 syncProperties 确保特效中的初始状态（如 alpha=0, scale=0）立即生效
        const applyEffect = () => {
          if (char.pendingEnterConfig) {
            effectManager.apply(char, char.pendingEnterConfig.name, char.pendingEnterConfig.params);
          } else {
            effectManager.apply(char, "fadeIn", { duration: 0.3 });
          }
          char.syncProperties(); // 强制立即同步一次，让特效设置的 Initial State (t=0) 生效
        };

        applyEffect();
      }

      // 7. 执行演出 (Stage & Group Effects)
      const perfTask = this.executePerformance(target, item, isInstantGo, realIdx, tokens, items);

      // 核心修复：如果是并发模式，不等待演出完成，直接进入下一个循环
      if (!isInstantGo) {
        const perfRes = await perfTask;
        if (target._stopRequested) return { skipAutoPause: true };
        if (perfRes && perfRes.speedMultiplier !== undefined) groupSpeedMultiplier = perfRes.speedMultiplier;
      } else {
        perfTask.catch(() => { });
      }

      // 8. 信号分流
      if (advanceLevel === "block" && options.onAdvance) {
        options.onAdvance();
        options.onAdvance = undefined;
      } else if (advanceLevel === "group") {
        let nextLineIdx = -1;
        for (let j = i + 1; j < items.length; j++) {
          const nextItem = items[j];
          if (nextItem && this.isNewLineItem(nextItem)) { nextLineIdx = j; break; }
        }
        if (nextLineIdx !== -1) {
          if (target._stopRequested) return { skipAutoPause: true };
          void this.play(
            target,
            this.sliceLegacyPlaybackAssembly(assembly, items.slice(nextLineIdx + 1)),
            absStartTime + virtualElapsed,
            { ...options, onAdvance: undefined },
          );
          const thisLineRemaining = items.slice(i + 1, nextLineIdx + 1);
          return this.play(
            target,
            this.sliceLegacyPlaybackAssembly(assembly, thisLineRemaining),
            absStartTime + virtualElapsed,
            { ...options, onAdvance: undefined },
          );
        }
      }

      // 9. 步进虚拟时间并物理等待
      if (!isInstantGo) {
        let waitTime = 0;
        if (delayOverride !== undefined && delayOverride > 0) {
          waitTime = delayOverride * 1000;
        } else if (delayOverride === undefined && char.text !== "") {
          const isPunctuation = /[，。！？]/.test(char.text);
          const speed = baseRevealSpeed * persistentSpeedMultiplier * groupSpeedMultiplier;
          waitTime = isPunctuation ? speed * 5 : speed;
        }

        if (waitTime > 0) {
          virtualElapsed += waitTime;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      if (isNewLine && !isInstantGo) {
        const breathingDelay = baseRevealSpeed * 10;
        virtualElapsed += breathingDelay;
        await new Promise(resolve => setTimeout(resolve, breathingDelay));
      }

      // 10. 状态流转准备
      lastWasInstantGo = isSugarGo;
      if (delayOverride !== undefined && delayOverride > 0) {
        lastWasInstantGo = false;
      }

      const nextItem = items[i + 1];
      if (!nextItem || nextItem.tokenIdx !== item.tokenIdx) {
        groupSpeedMultiplier = 1.0;
      }
    }
    return { skipAutoPause: lastWasInstantGo };
  }

  /**
   * 瞬间跳到演出结束态
   * 用于跳转后恢复"正在场上"的文字状态
   */
  public static skipToEnd(target: any, assembly: Pick<ParagraphDisplayAssembly, "chars" | "tokens">) {
    target._stopRequested = true;

    assembly.chars.forEach(char => {
      gsap.killTweensOf(char.animOffset);

      // 恢复到标准显示态
      char.animOffset.alpha = 1;
      char.animOffset.scaleX = 1;
      char.animOffset.scaleY = 1;
      char.animOffset.x = 0;
      char.animOffset.y = 0;
      char.animOffset.rotation = 0;

      char.visible = true;
      char.syncProperties();
    });

    // 瞬间应用所有组特效的最终态 (TODO: 如果有复杂的组特效可能需要特殊处理)
    assembly.tokens.forEach(_token => {
      // 目前组特效多为动画，killTweensOf 已经覆盖了大部分情况
    });
  }

  /**
   * 静默快进模式 (Warp Mode)
   * 以极速运行 play 逻辑，不进行物理等待，但保留逻辑状态流转
   */
  public static async fastForward(
    target: any,
    assembly: Pick<ParagraphDisplayAssembly, "chars" | "tokens" | "executionItems">,
    _absStartTime: number,
    options: { speed?: number; onLineUpdate?: (line: number) => void } = {}
  ) {
    const items = assembly.executionItems;
    // 暂时通过将速度设为极小值并跳过所有等待来实现
    // 在这个模式下，setTimeout(0) 依然会有微小延迟，但在 JS 循环中足够快

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const char = item.char;
      if (char.text.trim()) {
        char.visible = true;
        char.animOffset.alpha = 1;
        char.syncProperties();
      }

      // 执行指令但不等待结果
      for (const instr of item.stageInstructions) {
        stageManager.apply(instr.type, instr.params);
      }

      if (item.line !== undefined && char.text.trim()) {
        options.onLineUpdate?.(item.line + 1);
      }
    }

    this.skipToEnd(target, assembly);
  }

  /**
   * 离线时长预演算
   */
  public static bakeTimeline(
    _target: any,
    assembly: Pick<ParagraphDisplayAssembly, "executionItems">,
    baseSpeed: number,
  ): number {
    const items = assembly.executionItems;
    let virtualTime = 0;
    let persistentSpeedMultiplier = 1.0;
    let groupSpeedMultiplier = 1.0;
    let lastWasInstantGo = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const char = item.char;
      const isNewLine = this.isNewLineItem(item);

      if (isNewLine) {
        persistentSpeedMultiplier = 1.0;
        groupSpeedMultiplier = 1.0;
        lastWasInstantGo = false;
      }

      const timing = EffectProcessor.resolveTiming(item.timingSugars);
      if (timing.speedMultiplier !== undefined) persistentSpeedMultiplier = timing.speedMultiplier;

      if (timing.advanceLevel === "block") return virtualTime;
      else if (timing.advanceLevel === "group") return virtualTime;

      const isSugarGo = (timing.delayOverride === 0);
      const isInstantGo = isSugarGo || lastWasInstantGo;

      if (item.stageInstructions.length > 0) {
        for (const instr of item.stageInstructions) {
          if (instr.type === "pause") {
            virtualTime += Number(instr.params.duration ?? instr.params.d ?? instr.params[0] ?? 1) * 1000;
          }
        }
      }

      const delayOverride = timing.delayOverride;
      if (!isInstantGo && (delayOverride === undefined || delayOverride > 0)) {
        if (char.text !== "") {
          const wait = delayOverride !== undefined ? delayOverride * 1000 :
            (/[，。！？]/.test(char.text) ? baseSpeed * persistentSpeedMultiplier * groupSpeedMultiplier * 5 : baseSpeed * persistentSpeedMultiplier * groupSpeedMultiplier);
          virtualTime += wait;
        }
      }

      if (isNewLine && !isInstantGo) virtualTime += baseSpeed * 10;

      lastWasInstantGo = isSugarGo;
      if (delayOverride !== undefined && delayOverride > 0) lastWasInstantGo = false;

      const nextItem = items[i + 1];
      if (!nextItem || nextItem.tokenIdx !== item.tokenIdx) groupSpeedMultiplier = 1.0;
    }
    return virtualTime;
  }

  private static async executePerformance(
    _target: any,
    item: TextExecutionItemPayload,
    isInstantGo: boolean,
    charIdx: number,
    tokens: TokenWrapper[],
    items: TextExecutionItemPayload[],
  ): Promise<{ speedMultiplier?: number }> {
    let speedMultiplier: number | undefined = undefined;
    for (const instr of item.stageInstructions) {
      const result = stageManager.apply(instr.type, instr.params);
      if (!isInstantGo && (instr.type === "pause" || instr.blocking) && result) await result;
    }
    if (item.visualEffects.length > 0) {
      const nextItem = items[charIdx + 1];
      const isTokenEnd = !nextItem || nextItem.tokenIdx !== item.tokenIdx;
      if (isTokenEnd) {
        const wrapper = tokens.find(t => t.tokenIdx === item.tokenIdx);
        if (wrapper) {
          const groupRes = await EffectProcessor.applyGroupEffects(wrapper, item.visualEffects);
          speedMultiplier = groupRes.speedMultiplier;
        }
      }
    }
    return { speedMultiplier };
  }
}
