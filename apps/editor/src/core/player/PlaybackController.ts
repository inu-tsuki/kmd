import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import type { Segment } from "../state/Segment";

export interface BehaviorCleanup {
  char: any;
  modName: string;
}

export interface PlaybackRuntimeState {
  isAutoPlaying: boolean;
  activeBehaviorCleanups: BehaviorCleanup[];
  onTimeUpdate?: (timeMs: number) => void;
}

export class PlaybackController {
  public static playSegment(segment: Segment | null, state: PlaybackRuntimeState) {
    if (!segment) return;
    const tl = segment.timeline;

    this.registerBehaviors(segment, tl.time(), state);

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

    console.log(`[ScriptPlayer] seekToTime(${clamped.toFixed(2)}s)`);
    segment.timeline.seek(clamped);

    this.registerBehaviors(segment, clamped, state);
    this.replayStyles(segment, clamped);

    state.onTimeUpdate?.(clamped * 1000);
    return clamped;
  }

  public static clearBehaviors(state: PlaybackRuntimeState) {
    for (const cleanup of state.activeBehaviorCleanups) {
      cleanup.char.removeModifier(cleanup.modName);
    }
    state.activeBehaviorCleanups = [];
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
}
