import gsap from "gsap";
import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import { stageManager } from "../stage/StageManager";
import { resolveStageNumeric, CAM_SHAKE_EASE } from "../stage/stagePresets";
import { removeContainerOffset } from "../ContainerBehaviorOffset";
import type { Segment } from "../state/Segment";
import { Filter } from "pixi.js";

/**
 * behavior-track filter 的 fn 返回值契约。
 *
 * char 级（有 addModifier）：fn 返回 `Filter | Filter[]`，仅 filter 需清理
 *   （modifier 靠 modName 经 removeModifier 移除，无需返回引用）。
 * 容器级（:group/:block，无 addModifier）：fn 返回此对象，包含 filter + tickerFn，
 *   cleanup 时 gsap.ticker.remove(tickerFn) 释放逐帧驱动。
 * 组合预设（underwater）：filters 为 Filter[]，一个 tickerFn 驱动全部。
 */
export interface BehaviorFilterResult {
  /**
   * filter 实例（可选）。容器级 filter behavior（blur/rgbShift/warp/M2 displace/underwater）
   * return 此字段；容器级纯 offset behavior（shake:group）不 return，仅 return tickerFn。
   */
  filters?: Filter | Filter[];
  tickerFn: () => void;
}

/**
 * Behavior 特效（持续行为）的 seek 清理记录。
 *
 * behavior-track 特效有两类资源要清理：
 * - **modifier**：KineticChar.addModifier 注册的逐帧回调，靠 removeModifier 移除。
 *   `char`/`modName` 即为此设。纯 modifier behavior（shake/wave/pulse…）只有这一项。
 * - **filter + tickerFn**：behavior-track filter（blur/rgbShift/warp 及 M2 displace/dissolve/
 *   scanline/noise/underwater）额外把 filter push 进 target.filters，并用 ticker 回调
 *   驱动 uTime/uProgress。容器级（:group/:block）无 addModifier，filter+ticker 是唯一资源。
 *
 * `char` 兼容两种 target：char 级是 KineticChar（有 removeModifier），容器级是
 * TokenWrapper/KineticText（无 removeModifier，clearBehaviors 守卫跳过）。`target` 字段
 * 指明 filter 所在容器，char 级时与 char 同一对象。
 *
 * filterInstance 支持 Filter | Filter[]：组合预设（M2 underwater 串联 displace+tint+blur）
 * return Filter[]，清理时全部从 target.filters 移除并逐个 destroy。
 */
export interface BehaviorCleanup {
  char: any;            // removeModifier 目标（char 级 = KineticChar；容器级无 removeModifier）
  modName: string;
  target?: any;          // filter 所在容器（char 级 = char；容器级 = wrapper/KineticText）
  filterInstance?: Filter | Filter[];  // behavior-track filter（可选）
  tickerFn?: () => void; // 容器级 ticker 回调（可选；char 级用 addModifier 不需此字段）
  offsetTarget?: any;    // 容器级 offset 绑定目标（可选；如 shake:group 的 TokenWrapper）。
                        // clearBehaviors 调 removeContainerOffset(offsetTarget, modName)
                        // 恢复 position = base 并移除 offset 注册（ticker remove 只停驱动，
                        // 不恢复 position；offset 注册残留会污染下次 apply）
  restoreProps?: { target: any; props: Record<string, number> };
                        // 容器级属性恢复（可选；如 dim:block 写 target.alpha 后 seek 回退需还原）。
                        // clearBehaviors 遍历 props 写回 target（restoreProps 不走 ticker，
                        // 不与 timeline alpha 冲突——dim 写 alpha 是一次性属性写入，
                        // seek 时 registerBehaviors 先 clearBehaviors 恢复原始 alpha 再重 apply）。
  tween?: gsap.core.Tween; // gsap tween（可选；char 级 fadeShake 的 state 推进 tween。
                        // seek/stop/clearScreen 时 clearBehaviors 调 tween.kill() 释放）
}

/**
 * Instant 特效（静态 filter）的 seek 清理记录。
 * apply 时 effectManager.apply 返回 filter 实例（fn 内 return filter），
 * clearInstantEffects 据此从 target.filters 数组中移除，保证 seek 幂等。
 *
 * filterInstance 支持单个 Filter 或 Filter[]：
 * - 单 shader 滤镜（gray/bloom/…）return 单个实例。
 * - 组合预设（M2 underwater 串联 displace + tint + blur）return Filter[]，
 *   清理时全部从 target.filters 移除并逐个 destroy。
 */
export interface InstantCleanup {
  target: any;
  filterInstance: Filter | Filter[];
  /**
   * Graphics 层名（如 "box"/"border"），用于返回 void 的 instant 特效（画 Graphics 非 filter）。
   * R12：box/border 的 meta.track==="instant" 但 type==="style" 返回 void，filterInstance 通道捕获不到。
   * seek 回退时 Graphics 残留——用 graphicsLayer 记录 mutexGroup/层名，clearInstantEffects 清该层。
   * filterInstance 与 graphicsLayer 互斥（filter 特效只填 filterInstance；Graphics 特效只填 graphicsLayer）。
   */
  graphicsLayer?: string;
}

export interface PlaybackRuntimeState {
  isAutoPlaying: boolean;
  activeBehaviorCleanups: BehaviorCleanup[];
  activeInstantCleanups: InstantCleanup[];
  onTimeUpdate?: (timeMs: number) => void;
  onLineUpdate?: (line: number) => void;
  onPlaybackComplete?: () => void;
  /**
   * R22/SA-37：exact-boundary 双 apply 抑制的所有权 flag。
   *
   * **背景**：GSAP `tl.call(fn, [], t)` 在 ticker tick 上、当 `tl.time()` 跨越 t（从 =t 推进到 >t）
   * 那一刻触发，**不是** `tl.play()` 同步触发（探针验证 2026-06-30，gsap 3.14.2；见 playSegment
   * 顶部注释）。故 seek 落在 record.timePosition 上、随后 `tl.play()` 时，首个 tick 让 tl.time
   * 从 =timePosition 推进到 >timePosition——这是"跨越"，同一 record 的 `tl.call` 会再 apply 一次，
   * 与 seek 的 registerBehaviors / registerInstantEffects / replayStyles 双 apply。`isAutoPlaying` guard 拦不住：playSegment 在 play
   * 前已置 true，call 在 tick 触发时 guard 已放行。flip-the-guard（false→play→true）也拦不住：
   * call 是 deferred 到 tick 的，flip 在 play() 返回时已恢复 true（探针 D1 验证）。
   *
   * **机制**：seekToTime（与 playSegment ended 分支的 tl.seek(0)）末把目标时间写入此字段。
   * 随后 `tl.play()` 的 deferred tick 跨越 boundary 时，boundary `tl.call` guard 检查
   * `record.timePosition === state.lastSeekTime` 则跳过——seek 已应用过该 record，play 不该再叠。
   * 探针 M1 验证 flag 在 play() 与 deferred tick 之间存活并能 skip。
   *
   * **生命周期**：每次 seek（含 ended 重播的内部 seek(0)）覆写此值；非 seek 操作（pause/play）
   * 不动它。下一次 seek 覆写前，旧值不影响任何未来 record——boundary call 只在"跨越 =timePosition
   * → >timePosition"那一发触发，record 一旦被跨越就成过去时，不再被同段重触发。
   *
   * **浮点 === 安全**：seek 的 clamped 与 record.timePosition 同源（record = 构建期 cursor 算术；
   * seek = UI 从 onTimeUpdate(clamped*1000) 回传 /1000，或构建期同源 cursor），bit-identical。
   * seek 落在非 record 时间时 tl.time() 可能被 gsap 量化（探针 T5），但此时无 record.timePosition
   * 等于它，guard 不触发——量化只发生在"无 boundary 要抑制"的情况，无害。
   *
   * **设计取舍**：这是项目"靠构建期分工不靠运行时判重"约定的**有状态例外**——GSAP 的 deferred
   * 触发语义使得"构建期让两驱动不撞车"在 exact-boundary 上不可能（seek 与 play 共享同一 tick
   * 跨越事件）。ownership-flag 是探针证伪 flip 后唯一可行的抑制机制。范围刻意最小：单值，不维护
   * Set/游标/epsilon。见 docs/knowledge/runtime/core/lifecycle-invariants.md SA-37（待补）。
   */
  lastSeekTime?: number;
}

/**
 * F-2：播放阶段（客观播放状态，只读派生）。与 `isAutoPlaying`（用户播放意图，可写布尔）正交：
 * `isAutoPlaying` 表示"用户想播"，`PlaybackPhase` 表示"timeline 现在处于什么位置"。
 *
 * - **playing**：isAutoPlaying && progress<1 —— 正在播且未到尾。
 * - **ended**：progress>=1 —— 到达结尾（正常播完 onComplete 设 isAutoPlaying=false，
 *   或 seek 到尾但 onComplete 未触发——后者 R6-1 处理为停留 ended）。
 * - **paused**：!isAutoPlaying && progress<1 —— 暂停在中间。
 *
 * 散落的 `tl.progress()>=1` / `tl.time()>0` 判定收敛到 `derivePhase`，避免状态语义在各路径重算
 * （F-2 的根因：每条路径各判一次状态，子态漏一个就回归——R5-1 加 gate 漏 R6-1 seek-to-end）。
 */
export type PlaybackPhase = "playing" | "paused" | "ended";

export class PlaybackController {
  public static playSegment(segment: Segment | null, state: PlaybackRuntimeState) {
    if (!segment) return;
    const tl = segment.timeline;

    // 结尾重播：清理 behavior modifier + instant filter（ticker/modifier 驱动，不在时间线上，
    // seek(0) 不会重置它们），再 seek 回 0 让时间线从头播。
    // **不清理 entranceFilters**——entrance filter 的 tween 在时间线上，seek(0) 会把 strength
    // 动画插值回开始状态（filter 仍在 target.filters），tween 从头播。若清理则 filter 被 destroy、
    // 时间线仍驱动已销毁 filter → 视觉缺失 + 写已销毁 filter。entranceFilters 仅在 stop/clearScreen
    // （真正销毁容器）时清理。
    // F-2：状态判定过 derivePhase（单一真相源），不再散落 `tl.progress()>=1` 字面量。
    // ended（progress>=1）= 重播分支：清理 + seek(0) 从头播。
    if (this.derivePhase(segment, state) === "ended") {
      this.clearBehaviors(state);
      this.clearInstantEffects(state);
      // stage modifier（cam.shake/cam.drift）：cam.drift 无 tween、modifier 永久残留，
      // 重播不清会持续（INV: stage modifier 在 teardown 路径清理）。
      stageManager.clearModifiers();
      tl.seek(0);
      // R14/SA-29 + R22：style 重放现由下方统一 register*/replayStyles 块处理（lastSeekTime=tl.time()=0
      // 后的 replayStyles(segment, 0)）。原 ended 分支内联调 replayStyles(0) 是因为 t>0 resume 路径
      // 不调它；R22 统一后所有 playSegment 路径都调 replayStyles(tl.time())，此处不再内联调，避免双重。
    }

    // R22/SA-37：exact-boundary 双 apply 抑制——统一快照所有权模型。
    //
    // **GSAP tl.call 触发语义**（探针验证 2026-06-30，gsap 3.14.2）：tl.call(fn, [], t) 不是被
    // tl.play()「同步触发」的，而是在 ticker tick 上、当 tl.time() 跨越 t（从 =t 推进到 >t）那一刻触发。
    // tl.play() 只把 paused 置 false 让后续 tick 推进时间；play() 调用本身不回放 call。
    // （早期注释写「tl.play() 同步触发的 0 秒 segmentTl.call」不准确——生产之所以工作，是因为
    // isAutoPlaying 在 play 前已置 true，call 在 play 后首个 tick 跨越 0 时触发、读到 true 放行；
    // 非 play() 同步触发。）
    //
    // **问题**：seek 落在 record.timePosition 上、再 play 时，首个 tick 让 tl.time 从 =timePosition
    // 推进到 >timePosition——这是「跨越」，同一 record 的 tl.call 会再 apply 一次（与 seek 的
    // register*/replayStyles 双 apply）。isAutoPlaying guard 拦不住（play 前已置 true）；flip-the-guard
    // （false→play→true）也拦不住（call 是 deferred 到 tick 的，flip 在 play() 返回时已恢复 true，
    // 探针 D1 验证：「CALL fired isAutoPlaying=true」）。
    //
    // **修复模型**（探针 M1 验证可行）：register*/replayStyles/replayStageModifiers **单一拥有**
    // 当前时间点的态（含 t=0 与 seek-landing）；tl.call 只拥有「t 之后正向跨越」的触发。撞车点
    // （exact-boundary）归快照消费者，tl.call 让位。机制：playSegment 在 register* 前记
    // `state.lastSeekTime = tl.time()`（声明「此时间点已被快照拥有」），register* 应用当前态，
    // tl.play() 的 deferred tick 跨越 boundary 时，boundary tl.call guard 检查
    // `record.timePosition === state.lastSeekTime` 则跳过（探针 M1：flag 在 play() 与 deferred tick
    // 之间存活并能 skip）。
    //
    // **三条路径统一**（探针结论让原 `tl.time()>0` gate 失效）：
    // - t===0 fresh-build：lastSeekTime=0 → register* 应用 0s record → 0s tl.call 被 guard 跳过。
    //   （原逻辑靠 0s tl.call 单一驱动、跳过 register*；现翻转——register* 单一驱动 0s 态。）
    // - t===0 ended-replay：ended 分支已 seek(0)+replayStyles(0)；此处 lastSeekTime=0 → register*
    //   补 0s behavior/instant + replayStageModifiers 补 0s stage modifier（原 ended 分支不调它们、
    //   靠 0s tl.call 驱动；现翻转——快照消费者驱动，0s tl.call 让位）。
    // - t>0 resume：lastSeekTime=tl.time() → register* 恢复当前态 → boundary（若有 record 正在
    //   tl.time()）tl.call 跳过；严格过去的 tl.call 本就不会因 resume 重触发（tick 只在跨越时触发）。
    state.lastSeekTime = tl.time();
    state.isAutoPlaying = true;
    this.registerBehaviors(segment, tl.time(), state);
    this.registerInstantEffects(segment, tl.time(), state);
    // R22/SA-36：playSegment 现统一调 replayStyles——原 ended 分支调了 replayStyles(0) 但 t>0 resume
    // 不调（resume 靠 register* + tl.call，style 不在 register* 通道）。但 seek-landing 后 play 的
    // boundary style tl.call 需被 guard 跳过，而 guard 跳过后若无快照驱动则 style 丢——故统一让
    // replayStyles 在所有 playSegment 路径都跑（消费 style record 按 tl.time()）。与 ended 分支已调的
    // replayStyles(0) 幂等（tl.time()===0 时两次调用结果一致）。
    this.replayStyles(segment, tl.time());
    // R4-1 + R22：stage modifier 在所有 playSegment 路径统一走 replayStageModifiers(live)。
    // 原 t>0 resume 路径调它（static→live 衰减切换）；原 t=0/ended 路径不调、靠 0s tl.call 驱动。
    // 现翻转：t=0/ended 的 0s stage modifier 也由 replayStageModifiers 驱动、0s tl.call 让位（否则
    // 抑制后 0s cam.shake/cam.drift 丢失）。cam.shake 中途会创建真实衰减 tween（remainingDuration 从
    // remainingStrength→0，onComplete 自删）；t=0 时 elapsed=0 → baseStrength 全强度。
    // cam.drift（persistent）直接重 apply。cam.reset boundary 已在 seek 时生效。
    // F-2：resume 必走 live（衰减 tween 自删）；t=0 fresh/ended 也 live（无衰减需做，elapsed=0）。
    stageManager.clearModifiers();
    this.replayStageModifiers(segment, tl.time(), "live");

    if (tl.progress() >= 1) {
      tl.restart();
    } else {
      tl.play();
    }
  }

  public static pauseSegment(segment: Segment | null, state: PlaybackRuntimeState) {
    if (!segment) return;
    segment.timeline.pause();
    state.isAutoPlaying = false;
  }

  public static seekToTime(segment: Segment | null, seconds: number, state: PlaybackRuntimeState): number {
    if (!segment) return 0;
    const clamped = Math.max(0, Math.min(seconds, segment.duration));

    if (this.shouldLogPlaybackDiagnostics()) {
      console.log(`[ScriptPlayer] seekToTime(${clamped.toFixed(2)}s)`);
    }

    // 先清旧 resources（behaviors + instant filters），再 timeline.seek 插值。
    // 原顺序是先 seek 再 register*（register* 内 clearBehaviors）→ restoreProps 在 seek 后
    // 写回旧值覆盖 timeline 刚插值的 alpha（如 dim:group + blurIn 组合 seek 回 blurIn 中途）。
    // 改为先 clear 再 seek：restoreProps 写回旧值 → timeline.seek 覆盖为插值结果 →
    // register* 重放当前时间点的 behaviors/instant（若 dim 在目标时间仍生效则重 apply 写新 alpha）。
    this.clearBehaviors(state);
    this.clearInstantEffects(state);

    segment.timeline.seek(clamped);

    // register* 内部会先 clear（此时 active 数组已空，clear 是 no-op）再 replay。
    this.registerBehaviors(segment, clamped, state);
    this.replayStyles(segment, clamped);
    this.registerInstantEffects(segment, clamped, state);

    // stage modifier 重放：ScriptPlayer.seekToTime 已 clearModifiers，此处按时间重放
    // （tl.call seek 跨过不补触发 → cam.drift/cam.shake 在 seek 后缺失）。
    // F-2：replay mode 由 deriveReplayMode 从播放状态派生（不传字面量）。seek 末尾（progress>=1）
    // 不 resume（R6-1），此处仍 static 快照；中途且 isAutoPlaying 由 playSegment 后续转 live。
    this.replayStageModifiers(segment, clamped, this.deriveReplayMode(segment, state));

    // R22/SA-37：exact-boundary 双 apply 抑制——记下 seek 目标时间，供随后 playSegment 的
    // deferred tick 跨越此时间时，boundary tl.call guard 据此跳过（见 PlaybackRuntimeState.lastSeekTime
    // 字段注释）。在所有 register*/replayStyles/replayStageModifiers 应用完当前态后写入——
    // 此时 seek 的快照态已建立，flag 即"此时间点已被 seek 拥有"的所有权声明。
    state.lastSeekTime = clamped;

    state.onTimeUpdate?.(clamped * 1000);
    return clamped;
  }

  public static clearBehaviors(state: PlaybackRuntimeState) {
    for (const cleanup of state.activeBehaviorCleanups) {
      // 1. modifier：仅 KineticChar 有 removeModifier；容器级（无此方法）跳过。
      if (typeof cleanup.char.removeModifier === 'function') {
        cleanup.char.removeModifier(cleanup.modName);
      }
      // 2. 容器级 ticker 回调：gsap.ticker.remove 释放逐帧驱动。
      if (cleanup.tickerFn) {
        gsap.ticker.remove(cleanup.tickerFn);
      }
      // 3. 容器级 offset 绑定（如 shake:group）：removeContainerOffset 恢复 position=base
      //    并移除 offset 注册。ticker remove 只停驱动，不恢复 position 且注册残留会污染下次
      //    apply（base 快照会基于错位的 position）。modName 与 offset id 对齐（= effectName）。
      if (cleanup.offsetTarget) {
        removeContainerOffset(cleanup.offsetTarget, cleanup.modName);
      }
      // 4. 容器级属性恢复（如 dim:block 写 target.alpha）：遍历 restoreProps 写回原始值。
      //    不走 ticker——dim 写 alpha 是一次性属性写入，seek 时 registerBehaviors 先
      //    clearBehaviors 恢复原始 alpha 再重 apply。与 timeline alpha（blurIn 动画）不冲突：
      //    restoreProps 只在 clearBehaviors（seek/stop/clearScreen）时恢复，
      //    不在每帧覆盖 timeline 动画。
      if (cleanup.restoreProps) {
        const { target, props } = cleanup.restoreProps;
        for (const [key, value] of Object.entries(props)) {
          (target as any)[key] = value;
        }
      }
      // 5. gsap tween（char 级 fadeShake 的 state 推进 tween）：kill 释放逐帧驱动。
      //    fadeShake 的 modifier 已由第 1 步 removeModifier 移除，tween kill 停止 state 推进。
      if (cleanup.tween) {
        cleanup.tween.kill();
      }
      // 6. behavior-track filter：从 target.filters 移除 + destroy（与 clearInstantEffects 对称）。
      //    blur/rgbShift/warp 及 M2 displace/dissolve/scanline/noise/underwater 均走此路径。
      if (cleanup.filterInstance && cleanup.target) {
        const filters = cleanup.target.filters;
        const instances = Array.isArray(cleanup.filterInstance)
          ? cleanup.filterInstance
          : [cleanup.filterInstance];
        if (filters) {
          const remaining = filters.filter((f: Filter) => !instances.includes(f));
          cleanup.target.filters = remaining.length > 0 ? remaining : null;
        }
        for (const inst of instances) this.destroyFilterDeep(inst);
      }
    }
    state.activeBehaviorCleanups = [];
  }

  /**
   * 清除所有已挂载的 instant filter 实例。
   * 与 clearBehaviors 对称：behaviors 靠 removeModifier，instant filter 靠从 target.filters 移除。
   *
   * 不用 splice 原地改 Pixi 的 filters 数组（v8.15 已验证：filters 数组元素 configurable:false，
   * splice 抛 "Cannot delete property '1'"）；改为 filter 重建后整体赋值。
   * （INV-8 / §B-bis：此为已验证外部依赖行为）
   */
  public static clearInstantEffects(state: PlaybackRuntimeState) {
    for (const cleanup of state.activeInstantCleanups) {
      // R12：Graphics 层 cleanup（bg/border 等 instant 特效画 Graphics 非 filter，返回 void）。
      // seek 回退时清该 Graphics 层（g.clear()），防残留。filterInstance 通道捕获不到这类特效。
      if (cleanup.graphicsLayer && typeof (cleanup.target as any).getGraphicsLayer === "function") {
        const layer = (cleanup.target as any).getGraphicsLayer(cleanup.graphicsLayer);
        if (layer && typeof layer.clear === "function") layer.clear();
        continue;
      }
      const filters = cleanup.target.filters;
      const instances = Array.isArray(cleanup.filterInstance)
        ? cleanup.filterInstance
        : [cleanup.filterInstance];
      if (filters) {
        const remaining = filters.filter((f: Filter) => !instances.includes(f));
        cleanup.target.filters = remaining.length > 0 ? remaining : null;
      }
      // 释放 GPU 资源（GlProgram uniform group 等），避免频繁 seek churn Filter 对象。
      for (const inst of instances) this.destroyFilterDeep(inst);
    }
    state.activeInstantCleanups = [];
  }

  /**
   * 清除入场特效创建的持久 filter（blurIn 等）。
   *
   * 与 clearInstantEffects 区别：
   * - clearInstantEffects 清理 `activeInstantCleanups`（playback 期 segmentTl.call 填充），
   *   seek 时 registerInstantEffects 重 apply（静态 filter 幂等）。
   * - clearEntranceFilters 直接读 `segment.entranceFilters`（build 期 captureEntrance 填充），
   *   **seek 时不调用**——entrance tween 靠时间线插值到正确状态，filter 已在 build 期 push 进
   *   target.filters，不需重 apply。仅 stop/clearScreen 调用：移除 filter + destroyFilterDeep。
   *
   * blurIn 的 filter 若走 instantEffects 路径会被 registerInstantEffects 在 seek 时重 apply
   * → gsap.set(alpha=0) 重置 + rogue tween（不入时间线）+ destroy() 对 {tween,filter} 崩溃（§B-bis：Pixi v8 Container.destroy 不销毁 target.filters）。
   * 故 entrance filter 必须独立于 instantEffects 清理路径。
   */
  public static clearEntranceFilters(segment: Segment | null) {
    if (!segment) return;
    for (const record of segment.entranceFilters) {
      const filters = record.target.filters;
      const instances = Array.isArray(record.filter) ? record.filter : [record.filter];
      if (filters) {
        const remaining = filters.filter((f: Filter) => !instances.includes(f));
        record.target.filters = remaining.length > 0 ? remaining : null;
      }
      for (const inst of instances) this.destroyFilterDeep(inst);
    }
  }

  /**
   * 深销毁 Filter，递归释放 Pixi v8 不自动 destroy 的内部 pass。（§B-bis：BlurFilter.destroy 不递归子 pass）
   *
   * Pixi v8.15 的 BlurFilter 持有 `blurXFilter` / `blurYFilter`（BlurFilterPass）且自身
   * 未 override destroy()——只 destroy 外层会泄漏这两个内部 pass 的 GlProgram/bind group。
   * BloomFilter.destroy() 已自行处理其内部 _extractFilter/_blurFilter；裸 BlurFilter 没有。
   *
   * behavior 路径（`f.blur` 返回裸 BlurFilter）与 instant 路径（`f.bloom` 返回 BloomFilter）
   * 共用此 helper，seek churn / stop / clearScreen 的 GPU 释放均覆盖 X/Y 子 pass。
   */
  private static destroyFilterDeep(filter: Filter) {
    const anyFilter = filter as any;
    anyFilter.blurXFilter?.destroy();
    anyFilter.blurYFilter?.destroy();
    filter.destroy();
  }

  /**
   * INV-7（SA-16）单一真相源：解包 behavior-track 特效 fn 的返回值。
   *
   * behavior fn 可能 return：
   * - `Filter | Filter[]`：char 级 filter behavior（blur/rgbShift/warp）→ filterInstance。
   *   modifier 靠 modName 经 removeModifier 清理，故只需 filterInstance。
   * - `BehaviorFilterResult`（含 tickerFn，filters 可选）：容器级。filter behavior（blur:group）
   *   带 filters；offset behavior（shake:group）仅 tickerFn → offsetTarget = target。
   * - `gsap.core.Tween`（有 kill）：char 级 fadeShake 的 state 推进 tween → tween（kill 释放）。
   * - `{ restoreProps }`：容器级属性恢复（dim:group 写 alpha 后 seek 回退还原）→ restoreProps。
   * - `undefined`/void：纯 modifier behavior（shake/wave…），无资源。
   *
   * 三调用点共用：SegmentBuilder block 路径、SegmentBuilder group 路径、registerBehaviors（seek 重放）。
   * 新增返回 shape 必须改这一处（否则三处不同步 → 静默丢 cleanup → 资源泄漏）。
   * 返回 BehaviorCleanup 除 char/modName/target 外的字段（这三项由调用点从 BehaviorRecord 提供）。
   */
  public static unpackBehaviorResult(
    result: any,
    target: any,
  ): Pick<BehaviorCleanup, 'filterInstance' | 'tickerFn' | 'tween' | 'offsetTarget' | 'restoreProps'> {
    let filterInstance: Filter | Filter[] | undefined;
    let tickerFn: (() => void) | undefined;
    let tween: gsap.core.Tween | undefined;
    let offsetTarget: any;
    let restoreProps: any;
    if (result && typeof result === 'object' && 'tickerFn' in result) {
      const bfr = result as BehaviorFilterResult;
      filterInstance = bfr.filters;
      tickerFn = bfr.tickerFn;
      // 无 filters 的 BehaviorFilterResult = 容器级 offset behavior（shake:group/block）。
      // offsetTarget 指明 offset 绑定容器，clearBehaviors 调 removeContainerOffset 恢复 position。
      if (!filterInstance) offsetTarget = target;
    } else if (result instanceof Filter || Array.isArray(result)) {
      filterInstance = result;
    } else if (result && typeof (result as any).kill === 'function') {
      tween = result as gsap.core.Tween;
    } else if (result && typeof result === 'object' && 'restoreProps' in result) {
      restoreProps = (result as any).restoreProps;
    }
    return { filterInstance, tickerFn, tween, offsetTarget, restoreProps };
  }

  private static registerBehaviors(segment: Segment, currentTime: number, state: PlaybackRuntimeState) {
    this.clearBehaviors(state);

    for (const behavior of segment.behaviors) {
      if (behavior.timePosition <= currentTime) {
        const result = effectManager.apply(behavior.char, behavior.effectName, behavior.params, true);
        const unpacked = this.unpackBehaviorResult(result, behavior.target);
        state.activeBehaviorCleanups.push({
          char: behavior.char,
          modName: behavior.effectName,
          target: behavior.target,
          ...unpacked,
        });
      }
    }
  }

  /**
   * 重放截至 currentTime 的 instant 特效（静态 filter）。
   * 先 clear（移除旧 filter 实例），再对 timePosition <= currentTime 的 record 用 force=true 重 apply。
   * effectManager.apply 返回 fn 的返回值；instant filter fn 返回新建的 filter 实例，
   * 据此记录 cleanup，下次 clear 时精确移除。seek 反复跳转不会累积 filter。
   */
  private static registerInstantEffects(segment: Segment, currentTime: number, state: PlaybackRuntimeState) {
    this.clearInstantEffects(state);

    for (const record of segment.instantEffects) {
      if (record.timePosition <= currentTime) {
        const result = effectManager.apply(record.target, record.effectName, record.params, true);
        if (result) {
          state.activeInstantCleanups.push({
            target: record.target,
            filterInstance: result,
          });
        } else {
          // R12：void result（bg/border 画 Graphics 非 filter）——查 meta.mutexGroup 作 Graphics 层名，
          // push graphicsLayer cleanup 供 seek 回退清该层。filterInstance 与 graphicsLayer 互斥。
          const meta = effectManager.getMetadata(record.effectName);
          if (meta?.mutexGroup && typeof (record.target as any).getGraphicsLayer === "function") {
            state.activeInstantCleanups.push({
              target: record.target,
              filterInstance: undefined as any,
              graphicsLayer: meta.mutexGroup,
            });
          }
        }
      }
    }
  }

  /**
   * 重放截至 currentTime 的 style 变更。
   *
   * 两步：先 reset **所有拥有 style record 的 char**（不按 currentTime 过滤），再对
   * `timePosition <= currentTime` 的 record 重 apply。
   *
   * reset 不按 currentTime 过滤是关键（R13/SA-28）：旧逻辑只在 `timePosition <= currentTime`
   * 时 reset。若先 seek/play 跨过样式生效点（如 `f.hold(1s).red` 红色生效后），再 seek 回退到
   * 生效点之前，**没有任何 record 满足 `timePosition <= currentTime`** → 不 reset、不 apply →
   * 字符残留旧样式（红色不退）。根因：把 reset 的"哪些 char 可能已被样式污染"窗口错误地耦合到
   * apply 的"哪些样式在当前时间生效"窗口——两者语义不同，seek 可回退让生效点之后的样式已应用。
   * 改为 reset 覆盖所有出现在 styleRecords 里的 char（清回 base），reapply 仍按 currentTime 过滤。
   * 向前 seek / 从头播 / seek 后再 seek 都幂等：reset→base 后只重放 currentTime 前的样式。
   *
   * R17/SA-32：replayStyles **不做**"初始态 vs 动态变更"判定——它只消费 baseline + record 集合。
   * baseline 与 record 的职责分离由构建期 P1-P4 经 `EffectProcessor.classifyStyleWrite` 单一真相源
   * 保证：初始样式（pre-hold / block 全量）进 baseline（P1 烘焙 / P2 recapture，不进 record），
   * 动态样式（post-hold）进 record（P3/P4 注册，不进 baseline）。replayStyles 的 reset 回 baseline
   * 即恢复初始样式，重放 record 即恢复动态样式——两者各司其职，无重叠（R15/R16 已消除重叠）。
   */
  private static replayStyles(segment: Segment, currentTime: number) {
    const resetChars = new Set<any>();
    for (const record of segment.styleRecords) {
      if (!resetChars.has(record.char)) {
        record.char.resetStyle();
        resetChars.add(record.char);
      }
    }

    for (const record of segment.styleRecords) {
      if (record.timePosition <= currentTime) {
        styleManager.apply(record.char.style, record.styleName, record.params, true);
      }
    }
  }

  /**
   * F-2：从 segment + state 派生客观播放阶段（PlaybackPhase）。单一真相源——所有
   * `tl.progress()>=1` / `tl.time()>0` / `isAutoPlaying` 组合判定收敛到此，避免散落重算。
   * 公开供 ScriptPlayer（seekToTime 的 resume gate）共用，禁止各路径各判一次。
   */
  public static derivePhase(segment: Segment | null, state: PlaybackRuntimeState): PlaybackPhase {
    if (!segment) return state.isAutoPlaying ? "playing" : "paused";
    // progress>=1 优先判定 ended——无论 isAutoPlaying（正常播完 onComplete 设 false，
    // 或 seek 到尾 onComplete 未触发仍 true——后者 R6-1 停留 ended，靠此分支识别）。
    if (segment.timeline.progress() >= 1) return "ended";
    return state.isAutoPlaying ? "playing" : "paused";
  }

  /**
   * F-2：从播放阶段派生 stage modifier 的 replay mode。
   *
   * seek 路径的 mode 不再由调用方传字面量，而是据播放阶段判定：
   * - **playing / paused / ended**：seek 恒走 "static"（快照语义）。
   *   - playing-mid 的后续 playSegment resume 会 clearModifiers + replay(live) 替换（R5-1/R6-1）。
   *   - ended 停留（R6-1 不 resume），static 快照即最终态。
   *   - paused 静态快照等待 resume/再 seek。
   * resume 路径恒 "live"（衰减语义），不经此 helper——seek 与 resume 的 mode 语义不同，不混用。
   */
  private static deriveReplayMode(segment: Segment, state: PlaybackRuntimeState): "static" {
    // seek 路径恒静态快照（playing/paused/ended 三态都先快照；playing-mid 由 playSegment resume 转 live）。
    void this.derivePhase(segment, state); // F-2：phase 已派生（当前 mode 不分支，phase 供未来 seek 按阶段差异化）。
    return "static";
  }

  /**
   * 重放截至 currentTime 的 stage modifier 命令（cam.shake/cam.drift 等）。
   * 与 registerBehaviors 对称：seek 时 tl.call 跨过不补触发 → modifier 缺失。
   * ScriptPlayer.seekToTime 已 clearModifiers（清旧），此处按时间重放当前应激活的 modifier。
   *
   * **duration 过滤**：cam.shake 有 duration（有限效果），seek 到结束后不重放。
   * cam.drift 无 duration（persistent），总是重放。duration 按命令语义提取（getStageModifierDuration）。
   *
   * **clear boundary**：cam.reset 记为 isClearBoundary——遇此 record 时，之前所有 modifier
   * 不再重放（cam.reset 在正常播放时 clearModifiers，seek 到 reset 后不应恢复 reset 前的 modifier）。
   *
   * **cam.shake 中间强度**：seek 到 shake 中途时，replay 用计算出的剩余强度（衰减曲线）
   * 而非重新从满强度启动。cam.shake 的 state tween 从 strength→0；replay 经
   * gsap.parseEase(record.easeName) 求剩余强度（F-3：easeName build 期写入 record，与 preset 同源），
   * 不硬编码 (1-t)^2（§B-bis：GSAP power2.out 实为 1-(1-t)^3）。replay 时用此值作为 strength + `static:true`
   * （恒定强度，不创建衰减 tween——seek 是静态跳转，不推进动画；§B-bis：GSAP 零时长 tween 会同步
   * 触发 onComplete 自删，故不能用 duration:0）。
   */
  private static replayStageModifiers(
    segment: Segment,
    currentTime: number,
    mode: "static" | "live" = "static",
  ) {
    // R3 修复：stageModifierRecords 不保证按 timePosition 排序——inline cam.reset（token-end /
    // TextStageCueScheduler）与 token-chain modifier（chain pause 后写入）push 顺序可能让更早
    // timePosition 的 record 排在更晚的之后。原第一轮扫描用 `timePosition > currentTime break`
    // 假设有序 → 漏掉排在前面的更早 reset boundary → 误重放 reset 前的 persistent drift。
    // 改为拷贝 + 稳定排序后再扫描（两次扫描共用同一有序视图）。不就地改 segment 字段（保持 build 产物原序，
    // 排序仅用于 replay 查询）。
    // R8-2：ES2019+ Array.sort 稳定——同 timePosition 时保留 build 期 push 顺序（= 脚本执行顺序）。
    // ordered 内的索引即"创建顺序"，作为稳定 sequence 用于 boundary skip（解决 timePosition 单维度
    // 无法区分"reset 之前 vs reset 之后同 timestamp"的歧义，Coco R8 复现：drift@1 → reset@1）。
    const ordered = [...segment.stageModifierRecords].sort(
      (a, b) => a.timePosition - b.timePosition,
    );

    // 先找最后一个 currentTime 前已生效的 clear boundary（cam.reset）。
    // R4-2：boundary 生效时间 = reset 起点 + resetDuration（与正常播放对齐——buildMode 下
    // cam.reset 在 resetTl 末尾（timePosition + duration）才 clearModifiers，不是起点）。
    // cam.reset record 携 resetDuration（buildStageModifierRecord 填）；未携时回退到起点（兼容旧 record）。
    //
    // skip 模型经 R8-1→R8-2→R8-3→R10→R11 五轮收敛（见 SA-24 根因）。reset 在 effectiveTime 调 clearModifiers
    // 是 clear-all——清掉当时所有存活 modifier。skip 须**双维度**：
    //   - **时间维度** `timePosition < effectiveTime`：reset clear 动作前已 apply 的 modifier（resetDuration>0
    //     时覆盖窗口内与 reset 前；resetDuration=0 时 effectiveTime===timePosition，此条件对同 timestamp 失效）。
    //   - **创建序维度** `sequence <= boundarySequence`（仅 timePosition === effectiveTime 时生效）：
    //     R11：用 record.sequence（build/push 顺序），**不用 ordered 索引**——stable sort 后不同 timePosition
    //     的 push 顺序会被打乱。>>> overlap：p1 drift@2（push 序 0）+ p2 reset@1（push 序 1），reset
    //     effective@2 clear 时 drift 已 apply → drift sequence(0) <= reset sequence(1) → skip。
    //     reset 之后同 effectiveTime push 的（sequence > boundarySequence）不 skip（R8-1 场景）。
    // 未携 sequence（R11 前旧 record）回退到 ordered 索引（同 timestamp 时 stable sort 保留 push 序，等价）。
    let lastClearBoundaryEffectiveTime = -1;
    let lastClearBoundarySequence = -1;
    for (let i = 0; i < ordered.length; i++) {
      const record = ordered[i]!;
      if (record.timePosition > currentTime) break;
      if (record.isClearBoundary) {
        const resetDur = record.resetDuration ?? 0;
        const effectiveTime = record.timePosition + resetDur;
        if (effectiveTime <= currentTime) {
          // R9-High：多个 reset 取最大 effective clear time（最近触发的）。
          // R11：同 max effectiveTime 取较大 sequence（更晚 push 的 reset，创建序覆盖更广）。
          const seq = record.sequence ?? i; // 回退到 ordered 索引（兼容旧 record）
          if (effectiveTime > lastClearBoundaryEffectiveTime
              || (effectiveTime === lastClearBoundaryEffectiveTime && seq > lastClearBoundarySequence)) {
            lastClearBoundaryEffectiveTime = effectiveTime;
            lastClearBoundarySequence = seq;
          }
        }
      }
    }

    for (let i = 0; i < ordered.length; i++) {
      const record = ordered[i]!;
      if (record.timePosition > currentTime) continue;
      // R8-3 + R10 + R11：已生效 boundary 清掉的 modifier 不重放。
      // - timePosition < effectiveTime：clear 前已 apply（resetDuration>0 覆盖窗口内 + reset 前）。
      // - timePosition === effectiveTime 且 sequence <= boundarySequence：同 effectiveTime、reset 之前 push
      //   （resetDuration=0 或 >>> overlap 时时间维度失效，创建序是唯一判据）。reset 之后同 effectiveTime
      //   push 的（sequence > boundarySequence）不 skip。
      if (lastClearBoundaryEffectiveTime >= 0) {
        if (record.timePosition < lastClearBoundaryEffectiveTime) continue;
        const seq = record.sequence ?? i; // 回退到 ordered 索引（兼容旧 record）
        if (record.timePosition === lastClearBoundaryEffectiveTime
            && seq <= lastClearBoundarySequence) continue;
      }
      // clear boundary 本身不重放（cam.reset 的 tween 由时间线插值恢复 camera，modifier 已由
      // ScriptPlayer.seekToTime 的 clearModifiers 清掉）——上面 sequence <= boundarySequence 已含此。
      if (record.isClearBoundary) continue;

      // 有 duration 的有限 modifier：seek 到结束点及之后不重放（如 cam.shake）。
      // R5-2：原 `currentTime > start + duration`（严格大于）→ 刚好等于结束点不跳过，
      // 落进下方 shake-midway 的 `elapsed < duration` 也 false → fall through 到正常 apply，
      // 从满强度重新震一次。改 `>=` 让结束点直接跳过（shake 已结束）。
      if (record.duration !== undefined && isFinite(record.duration)
          && currentTime >= record.timePosition + record.duration) {
        continue;
      }

      // cam.shake 中间强度：seek 到 shake 进行中（含起点）时用剩余强度，不重新从满强度启动。
      if (record.command === "cam.shake" && record.duration !== undefined) {
        const elapsed = currentTime - record.timePosition;
        // R5-2：原 `elapsed > 0 && elapsed < duration` → 起点（elapsed=0）fall through 到正常 apply，
        // 暂停 seek 到 shake 起点会启动真实衰减 tween（墙钟时间里衰减，暂停态不该动）。
        // 改 `elapsed >= 0 && elapsed < duration`：起点也走静态快照（remainingStrength=baseStrength，
        // seek 模式 static）；结束点已被上面的 `>=` 跳过，不会进此分支。
        if (elapsed >= 0 && elapsed < record.duration) {
          // F-3：baseStrength / easeName 优先读 record（build 期已解析变量、从 preset ease 读），
          // 消除 replay 时重算与 timeline 执行不同源的对齐债。未携时回退到 resolveStageNumeric /
          // CAM_SHAKE_EASE（兼容 R3 前的旧 record）。
          const baseStrength = record.baseStrength ?? resolveStageNumeric(
            record.params?.strength ?? record.params?.[0] ?? 5,
            5,
          );
          const easeName = record.easeName ?? CAM_SHAKE_EASE;
          // 用 cam.shake 实际缓动曲线算剩余强度，与正常播放的衰减 tween 逐帧一致。
          // 经 gsap.parseEase(easeName) 求值，与 stagePresets cam.shake 的 ease 同源（F-3 共享 CAM_SHAKE_EASE）、
          // 未来改 ease 不会漏。不硬编码 (1-t)^2——GSAP power2.out 实为 1-(1-t)^3（§B-bis）。
          // 衰减 s = strength * (1 - ease(elapsed/duration))（tween 从 strength→0 插值）。
          const ratio = elapsed / record.duration;
          const ease = gsap.parseEase(easeName);
          const remainingStrength = baseStrength * (1 - ease(ratio));
          const remainingDuration = record.duration - elapsed;

          // R4-1：seek（暂停态）用 static（恒定强度快照，不衰减、不自删）；
          // resume（live 模式）创建真实衰减 tween（remainingDuration 从 remainingStrength→0，
          // onComplete 自删 modifier）。static modifier 会在 playSegment resume 时被 clearModifiers
          // + replay(live) 替换为衰减 tween，所以不会永久残留。
          if (mode === "live") {
            // resume：创建衰减 tween 从剩余强度衰减到 0，onComplete 移除 modifier。
            // 用 static:false（正常 cam.shake 路径），但传入预算的剩余 strength + 剩余 duration，
            // 让正常播放的衰减继续到结束。**不能传 static:true**——那会永久残留（R3-1 修了透传但
            // 语义仍是静态，resume 时需要衰减）。
            stageManager.apply("cam.shake", {
              ...record.params,
              strength: remainingStrength,
              duration: remainingDuration,
            });
          } else {
            // seek（暂停）：静态快照，恒定强度，等 resume 替换。
            stageManager.apply("cam.shake", {
              ...record.params,
              strength: remainingStrength,
              static: true,
            });
          }
          continue;
        }
      }

      stageManager.apply(record.command, record.params);
    }
  }

  private static shouldLogPlaybackDiagnostics() {
    try {
      const runtimeConfig = (globalThis as any).KmdRuntimeConfig;
      if (runtimeConfig?.debugOverlay === true || runtimeConfig?.settings?.debugOverlay === true) {
        return true;
      }
      const params = new URLSearchParams(globalThis.location?.search ?? "");
      return params.get("kmdDebugProbe") === "1" || params.get("kmdPlaybackDiag") === "1";
    } catch {
      return false;
    }
  }
}
