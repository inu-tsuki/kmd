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
 * clearInstantEffects 据此从 target.filters 数组中 splice 掉，保证 seek 幂等。
 */
export interface InstantCleanup {
  target: any;
  filterInstance: Filter;
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

    this.registerBehaviors(segment, tl.time(), state);
    this.registerInstantEffects(segment, tl.time(), state);

    if (tl.progress() >= 1) {
      tl.restart();
    } else {
      tl.play();
    }

    state.isAutoPlaying = true;
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
   */
  public static clearInstantEffects(state: PlaybackRuntimeState) {
    for (const cleanup of state.activeInstantCleanups) {
      const filters = cleanup.target.filters;
      if (filters) {
        const idx = filters.indexOf(cleanup.filterInstance);
        if (idx >= 0) filters.splice(idx, 1);
        if (filters.length === 0) cleanup.target.filters = null;
      }
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
