import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import type { Segment } from "../state/Segment";
import type { Filter } from "pixi.js";

export interface BehaviorCleanup {
  char: any;
  modName: string;
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
}

export interface PlaybackRuntimeState {
  isAutoPlaying: boolean;
  activeBehaviorCleanups: BehaviorCleanup[];
  activeInstantCleanups: InstantCleanup[];
  onTimeUpdate?: (timeMs: number) => void;
  onLineUpdate?: (line: number) => void;
  onPlaybackComplete?: () => void;
}

export class PlaybackController {
  public static playSegment(segment: Segment | null, state: PlaybackRuntimeState) {
    if (!segment) return;
    const tl = segment.timeline;

    // 结尾重播：先清理所有效果（behavior modifier + instant filter），
    // 再 seek 回 0，避免结尾效果残留到重播开头。
    if (tl.progress() >= 1) {
      this.clearBehaviors(state);
      this.clearInstantEffects(state);
      tl.seek(0);
    }

    // behavior + instant filter：
    // - time===0：不调 register*，让 tl.play() 同步触发的 0 秒 segmentTl.call
    //   唯一负责 apply（isAutoPlaying 已设 true 放行 guard）。
    //   若此处也 register → 0 秒 tl.call 再 apply 一次 → 双滤镜/双 modifier。
    //   behavior filter（blur/rgbShift/warp）尤其严重：双 push filter 且
    //   clearBehaviors 只 remove modifier 不移除 filter → 泄漏。
    // - time>0（暂停后 resume）：GSAP tl.play() 不重触发已过去的 tl.call，
    //   故需 register* 恢复当前时间的效果。
    state.isAutoPlaying = true;
    if (tl.time() > 0) {
      this.registerBehaviors(segment, tl.time(), state);
      this.registerInstantEffects(segment, tl.time(), state);
    }

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
    segment.timeline.seek(clamped);

    this.registerBehaviors(segment, clamped, state);
    this.replayStyles(segment, clamped);
    this.registerInstantEffects(segment, clamped, state);

    state.onTimeUpdate?.(clamped * 1000);
    return clamped;
  }

  public static clearBehaviors(state: PlaybackRuntimeState) {
    for (const cleanup of state.activeBehaviorCleanups) {
      cleanup.char.removeModifier(cleanup.modName);
    }
    state.activeBehaviorCleanups = [];
  }

  /**
   * 清除所有已挂载的 instant filter 实例。
   * 与 clearBehaviors 对称：behaviors 靠 removeModifier，instant filter 靠从 target.filters 移除。
   *
   * 不用 splice 原地改 Pixi 的 filters 数组（v8 下可能触发
   * "Cannot delete property" —— 数组元素不可配置）；改为 filter 重建后整体赋值。
   */
  public static clearInstantEffects(state: PlaybackRuntimeState) {
    for (const cleanup of state.activeInstantCleanups) {
      const filters = cleanup.target.filters;
      const instances = Array.isArray(cleanup.filterInstance)
        ? cleanup.filterInstance
        : [cleanup.filterInstance];
      if (filters) {
        const remaining = filters.filter((f: Filter) => !instances.includes(f));
        cleanup.target.filters = remaining.length > 0 ? remaining : null;
      }
      // 释放 GPU 资源（GlProgram uniform group 等），避免频繁 seek churn Filter 对象。
      for (const inst of instances) inst.destroy();
    }
    state.activeInstantCleanups = [];
  }

  private static registerBehaviors(segment: Segment, currentTime: number, state: PlaybackRuntimeState) {
    this.clearBehaviors(state);

    for (const behavior of segment.behaviors) {
      if (behavior.timePosition <= currentTime) {
        effectManager.apply(behavior.char, behavior.effectName, behavior.params, true);
        state.activeBehaviorCleanups.push({
          char: behavior.char,
          modName: behavior.effectName,
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
        }
      }
    }
  }

  private static replayStyles(segment: Segment, currentTime: number) {
    const resetChars = new Set<any>();
    for (const record of segment.styleRecords) {
      if (record.timePosition <= currentTime && !resetChars.has(record.char)) {
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
