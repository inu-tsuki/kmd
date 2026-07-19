import { EffectProcessor } from "../effects/EffectProcessor";
import { stageManager } from "../stage/StageManager";
import { buildStageModifierRecord, buildStageModifierApplyParams } from "../stage/stagePresets";
import type { InFlightAnimation, StageModifierRecord } from "../state/Segment";
import type { TimelineBuildResult } from "../render/text/TextPlayer";
import gsap from "gsap";

/** gsap 时间线类型（经 TimelineBuildResult.timeline 复用，避免重复声明）。 */
type GsapTimeline = TimelineBuildResult["timeline"];
type GsapTweenOrTimeline = gsap.core.Tween | gsap.core.Timeline;

export type ActiveStageTweenEntry = {
  tween: gsap.core.Tween | gsap.core.Timeline;
  startPosition: number;
  originalDuration: number;
  ease: string;
  fromValues: Record<string, number>;
  toValues: Record<string, number>;
  target: any;
};

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

/**
 * Stage modifier 子构建器（处方 6 拆解 SegmentBuilder 的一瓣）。
 *
 * 职责：处理段落级 stageConfigs（global 路径 cam.move/cam.shake/cam.reset 等），
 * 经 buildStageModifierRecord 单一真相源分流（clear boundary / modifierBased / 可 seek tween），
 * 管理 activeStageTweens 的 trim/记录，聚合 inline/token-chain 路径的 stageModifierRecords
 * （含 R11 sequence 字段分配）。
 *
 * **行为保持**（纯重构，从 SegmentBuilder.applyStageConfigs 搬移，不改语义）：
 * - buildStageModifierRecord 分流、trimActiveStageTween、activeStageTweens 管理、
 *   R22/SA-37 exact-boundary guard（lastSeekTime）、stageTweenRecords push——全部原样保留。
 * - captureTween 逻辑（tween 入 segment timeline）原样。
 *
 * **INV-7 合规**：分流经 buildStageModifierRecord 单一真相源，不含 SA-14 禁止的
 * inline 元数据 modifierBased 字段判定（那种各路径各写一份的分流）。
 */
export interface StageModifierBuildContext {
  segmentTl: GsapTimeline;
  stageTweenRecords: InFlightAnimation[];
  activeStageTweens: Map<string, ActiveStageTweenEntry>;
  virtualCam: Record<string, number>;
  virtualOff: Record<string, number>;
  allStageModifierRecords: StageModifierRecord[];
  playbackState?: { lastSeekTime?: number };
}

export class StageModifierBuilder {
  private ctx: StageModifierBuildContext;
  constructor(ctx: StageModifierBuildContext) {
    this.ctx = ctx;
  }

  /**
   * 处理段落级 stageConfigs（global 路径），返回推进后的 cursor。
   *
   * 单一真相源：buildStageModifierRecord 决定 cam.reset（clear boundary）、modifierBased
   * （cam.shake/cam.drift，duration 按命令语义）与可 seek tween 命令的分流。
   * 三路径（global/inline/token-chain）共用此 helper，SA-12 cam.reset boundary 在 inline/token-chain
   * 的分裂由此从根上消除（`文字 @ cam.reset!` 与全局 cam.reset 现在同一处理）。
   */
  applyStageConfigs(stageConfigs: any[], segmentCursor: number): number {
    const { segmentTl, stageTweenRecords, activeStageTweens, virtualCam, virtualOff, allStageModifierRecords, playbackState } = this.ctx;
    let cursor = segmentCursor;

    for (const config of stageConfigs) {
      if (config.name === "pause") {
        const duration = EffectProcessor.resolvePauseDuration(config.params, 1);
        cursor += duration;
        continue;
      }

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
        allStageModifierRecords.push({ ...stageRecord, timePosition: cursor, sequence: allStageModifierRecords.length });
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
        allStageModifierRecords.push({ ...stageRecord, timePosition: cursor, sequence: allStageModifierRecords.length });
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

  /**
   * 聚合 inline/token-chain 路径的 stageModifierRecords（含 R11 sequence 字段分配）。
   *
   * inline/token 级 stage modifier 记录（cam.reset/cam.drift/cam.shake 在文字 @ cam.xxx 或
   * effect chain 里触发）：与 global 路径（applyStageConfigs 经 buildStageModifierRecord）共用同一
   * allStageModifierRecords，seek 时 replayStageModifiers 按 timePosition + duration + isClearBoundary 重放。
   * 必须 spread 全部片段字段——上一版只拷 command/params/timePosition/duration，漏掉 isClearBoundary，
   * 导致 inline/token 级 cam.reset 边界丢失。
   * R11：分配 sequence = allStageModifierRecords.length（build/push 顺序，表达 GSAP callback 执行序）。
   *   不是 ordered 索引——>>> overlap 时不同 timePosition 的 push 顺序会被排序打乱
   *   （p1 drift@2 先 push、p2 reset@1 后 push，reset effective@2 clear 时 drift 已 apply）。
   */
  aggregateInlineRecords(records: StageModifierRecord[], segmentCursor: number): void {
    const { allStageModifierRecords } = this.ctx;
    for (const modRecord of records) {
      allStageModifierRecords.push({
        ...modRecord,
        timePosition: modRecord.timePosition + segmentCursor,
        sequence: allStageModifierRecords.length,
      });
    }
  }

  private captureTween(timeline: gsap.core.Timeline, result: any, position: number) {
    if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
      timeline.add(result, position);
    }
  }
}

// 保持 GsapTweenOrTimeline 类型别名供未来扩展使用（当前 captureTween 内联 instanceof）。
export type { GsapTweenOrTimeline };