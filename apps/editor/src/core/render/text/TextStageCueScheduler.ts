import gsap from "gsap";
import { stageManager } from "../../stage/StageManager";

export interface ScheduledStageInstruction {
  type: string;
  params?: Record<string, any>;
  blocking?: boolean;
  level?: string;
}

export class TextStageCueScheduler {
  public static collectPauseAdvance(
    instructions: ScheduledStageInstruction[],
    isInstantGo: boolean,
  ): number {
    if (isInstantGo) {
      return 0;
    }

    return instructions.reduce((total, instr) => {
      if (instr.type !== "pause" || instr.level === "char") {
        return total;
      }
      const duration = Number(instr.params?.duration ?? instr.params?.d ?? instr.params?.[0] ?? 1);
      return total + duration;
    }, 0);
  }

  public static schedule(
    tl: gsap.core.Timeline,
    instructions: ScheduledStageInstruction[],
    cursor: number,
    captureTween: (timeline: gsap.core.Timeline, result: any, position: number) => void,
  ): number {
    let blockingAdvance = 0;

    for (const instr of instructions) {
      if (instr.type === "pause") {
        continue;
      }

      if (stageManager.getCommandMetadata(instr.type)?.modifierBased) {
        const instructionCopy = { type: instr.type, params: { ...(instr.params || {}) } };
        tl.call(() => {
          stageManager.apply(instructionCopy.type, instructionCopy.params);
        }, [], cursor);
        continue;
      }

      const result = stageManager.apply(instr.type, instr.params);
      captureTween(tl, result, cursor);
      if (instr.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
        blockingAdvance += result.duration();
      }
    }

    return blockingAdvance;
  }
}
