import gsap from "gsap";
import { stageManager } from "../../stage/StageManager";
import { buildStageModifierRecord, buildStageModifierApplyParams } from "../../stage/stagePresets";
import { EffectProcessor } from "../../effects/EffectProcessor";
import type { StageModifierRecord } from "../../state/Segment";

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
      const duration = EffectProcessor.resolvePauseDuration(instr.params, 1);
      return total + duration;
    }, 0);
  }

  public static schedule(
    tl: gsap.core.Timeline,
    instructions: ScheduledStageInstruction[],
    cursor: number,
    captureTween: (timeline: gsap.core.Timeline, result: any, position: number) => void,
    stageModifierRecords: StageModifierRecord[],
    playbackState?: { lastSeekTime?: number },
  ): number {
    let blockingAdvance = 0;

    for (const instr of instructions) {
      if (instr.type === "pause") {
        continue;
      }

      // 单一真相源：buildStageModifierRecord 决定 cam.reset（clear boundary）/ modifierBased /
      // 可 seek tween 的分流。SA-12 的根本修复——上一版 inline 路径只判 modifierBased，
      // `文字 @ cam.reset!` 落 else 分支只 captureTween，不写 StageModifierRecord →
      // seek 到 reset 后 replayStageModifiers 找不到边界，仍重放 reset 前的 persistent modifier。
      const record = buildStageModifierRecord(instr.type, instr.params);
      if (record) {
        stageModifierRecords.push({ ...record, timePosition: cursor });
        if (record.isClearBoundary) {
          // cam.reset：可 seek tween（reset timeline），与 modifierBased 不同——仍走 apply + captureTween。
          const result = stageManager.apply(instr.type, instr.params);
          captureTween(tl, result, cursor);
          if (instr.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
            blockingAdvance += result.duration();
          }
        } else {
          // modifierBased（cam.shake/cam.drift）：经 tl.call 延迟 apply（modifier 在 timeline 时间触发）。
          const instructionCopy = { type: instr.type, params: buildStageModifierApplyParams(instr.type, instr.params) };
          // R22/SA-37：exact-boundary guard——seek 落在 cursor 上、随后 play 时 deferred tick 跨越会
          // 重触发此 tl.call（与 seek 的 replayStageModifiers 双 apply）。检查 timePosition === lastSeekTime
          // 则跳过，让 replayStageModifiers 单一拥有当前态。
          // R22-followup：params 经 buildStageModifierApplyParams 预解析（与 seek 重放同源）。
          const modRecTime = cursor;
          tl.call(() => {
            if (playbackState?.lastSeekTime === modRecTime) return;
            stageManager.apply(instructionCopy.type, instructionCopy.params);
          }, [], cursor);
        }
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
