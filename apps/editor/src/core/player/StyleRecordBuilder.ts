import { EffectProcessor } from "../effects/EffectProcessor";
import type { EffectConfig } from "../parser/types";
import type { KineticText } from "../KineticText";
import type { StyleRecord, TimelineBuildResult } from "../render/text/TextPlayer";
import type { PlaybackRuntimeState } from "./PlaybackController";
import type { StyleWritePort } from "./StyleWritePort";

/** gsap 时间线类型（经 TimelineBuildResult.timeline 复用，避免直接 import gsap 值）。 */
type GsapTimeline = TimelineBuildResult["timeline"];

/**
 * Style record 子构建器（处方 6 拆解 SegmentBuilder 的一瓣）。
 *
 * 职责：处理 blockRemaining 桶——block/global 链按 pre-hold / post-hold 边界拆分，
 * pre-hold style 经 applyGroupEffects 同步应用 + recapture baseline，
 * post-hold style 经 segmentTl.call + allStyleRecords（seek 由 replayStyles 重放），
 * 非 style 残留（timing/unknown，hold 已抽走）仍经 applyGroupEffects 同步路径。
 *
 * **行为保持**（纯重构，从 SegmentBuilder.build L242-347 搬移，不改语义）：
 * - R21/SA-36 pre-hold/post-hold 边界拆分、R16/SA-31 recapture、R22/SA-37 exact-boundary guard
 *   原样保留。
 * - style 写入经注入的 StyleWritePort 显式相位契约（处方 6 提交 4 收口）：
 *   P2 recapture 走 port.recaptureBaseline，P2b post-hold 走 port.registerPostHoldWrite。
 *   其余 4 处 style 写入方（P0/P1/P3/P4 + 外部直写）标注为 follow-up，见 StyleWritePort.ts 清单。
 * - :bg scope 跳过 + warn、wall-clock 非泄漏（segmentTl.call 不在 build 期触发）——原样。
 *
 * **INV-7 合规**：本文件分流经 EffectProcessor.classifyStyleWrite 单一真相源，不含 SA-17 禁止的
 * inline 元数据类型加轨道字面量判定分流。
 */
export interface StyleBuildContext {
  segmentTl: GsapTimeline;
  playbackState: PlaybackRuntimeState;   // guard 读取 lastSeekTime 用
  styleWritePort: StyleWritePort;        // 处方 6 提交 4：style 写入显式相位契约
  paragraphText: KineticText;
  segmentCursor: number;                 // 用作 chainCursor 起点
  allStyleRecords: StyleRecord[];        // 输出 accumulator
}

export class StyleRecordBuilder {
  private ctx: StyleBuildContext;
  constructor(ctx: StyleBuildContext) {
    this.ctx = ctx;
  }

  /**
   * 处理 blockRemaining（style + 非 style 残留，含 hold cursor 推进）。
   *
   * R21/SA-36：block/global style 链按 pre-hold / post-hold 边界拆分（镜像 site2
   * unrollGroupChain + site3 的 hold:char 模型），不再整条经 applyGroupEffects。
   *
   * **R21 修复的 bug**：原代码把 blockRemaining（style + hold + timing/unknown）整条丢给
   * applyGroupEffects 且不 await。applyGroupEffects 内 hold:block 返回
   * gsap.delayedCall promise → await result（EffectProcessor.ts:280）→ 函数挂起，构建期
   * 同步的 recaptureBaseStyleSnapshot 跑在 hold resolve 之前（post-hold style 漏 baseline），
   * 且 applyGroupEffects 无 styleRecords 概念 → post-hold style 既不进 baseline 也不进 record，
   * hold 到点后 applyStyleRecursively 作为墙钟副作用触发（不播不 seek 自己染红，seek/reset 管不住）。
   *
   * **修复模型**（与 site2/site3 同源，classifyStyleWrite 单一真相源判 pre-hold 边界）：
   *   - pre-hold style → applyGroupEffects 同步应用 + recapture baseline（R16/P2 模型不变）
   *   - hold → 推进 chainCursor（构建期不真等，与 site2 `chainCursor += dur` 一致）
   *   - post-hold style → segmentTl.call + allStyleRecords（seek 由 replayStyles 重放，与 site2 P3 同构）
   *   - 非 style 非 timing 残留（unknown）→ 仍经 applyGroupEffects（保持既有行为；hold 已抽走不阻塞）
   */
  processBlockRemaining(remaining: EffectConfig[]): void {
    const { segmentTl, playbackState, styleWritePort, paragraphText, segmentCursor, allStyleRecords } = this.ctx;

    const blockStylePreHold: EffectConfig[] = [];
    const blockStylePostHold: { config: EffectConfig; time: number }[] = [];
    const blockNonStyleRemaining: EffectConfig[] = [];
    let blockHoldEncountered = false;
    let chainCursor = segmentCursor;
    for (const cfg of remaining) {
      const { isStyle, isBlocking } = EffectProcessor.classifyStyleWrite(cfg);
      if (isStyle) {
        if (blockHoldEncountered) {
          blockStylePostHold.push({ config: cfg, time: chainCursor });
        } else {
          blockStylePreHold.push(cfg);
        }
        continue;
      }
      // hold 是 cursor 推进器（stagger/timing），构建期不真等——抽走不进 applyGroupEffects。
      if (cfg.name === "hold" && isBlocking) {
        chainCursor += EffectProcessor.resolvePauseDuration(cfg.params, 1);
        blockHoldEncountered = true;
        continue;
      }
      // 其余非 style（timing sugar slow/fast/go、unknown）→ 保持原 applyGroupEffects 路径。
      blockNonStyleRemaining.push(cfg);
      if (isBlocking) blockHoldEncountered = true;
    }

    // pre-hold style：applyGroupEffects 同步写 + recapture baseline（R16/P2 模型，含 big/small 测量）。
    // Bug 2: :bg scope 的 style/non-style 不走 applyGroupEffects（Sprite 无 getGraphicsLayer/tokens），
    // 应在 instant/behavior 轨道已处理；若落到 remaining 则跳过并 warn。
    const blockStylePreHoldNonBg = blockStylePreHold.filter(cfg => {
      if (cfg.level === "bg") {
        console.warn(`[SegmentBuilder] :bg style "${cfg.name}" in blockRemaining — not applicable to bg sprite, skipped`);
        return false;
      }
      return true;
    });
    if (blockStylePreHoldNonBg.length > 0) {
      EffectProcessor.applyGroupEffects(paragraphText, [...blockStylePreHoldNonBg]);
      // R16/SA-31：applyGroupEffects 在 KineticChar 构造之后同步写 char.style（force=true），
      // 但 baseStyleSnapshot 已在构造时固化（R15 pre-hold 烘焙态）。重新捕获 baseline = 当前
      // style（含 block 样式），避免 replayStyles reset 回无 block 样式的 baseline 丢样式。
      // 初始样式只进 baseline 不进 record，避免相对样式 big/small 双重放大。
      // P2 recapture 经 StyleWritePort 显式相位契约（处方 6 提交 4）。
      styleWritePort.recaptureBaseline(
        paragraphText.tokens.flatMap(t => t.chars),
      );
    }

    // 非 style 残留（timing/unknown，hold 已抽走）：保持原 applyGroupEffects 同步路径。
    // Bug 2: :bg scope 同理跳过（Sprite 无 applyGroupEffects 所需接口）。
    const blockNonStyleRemainingNonBg = blockNonStyleRemaining.filter(cfg => {
      if (cfg.level === "bg") {
        console.warn(`[SegmentBuilder] :bg non-style "${cfg.name}" in blockRemaining — not applicable to bg sprite, skipped`);
        return false;
      }
      return true;
    });
    if (blockNonStyleRemainingNonBg.length > 0) {
      EffectProcessor.applyGroupEffects(paragraphText, [...blockNonStyleRemainingNonBg]);
    }

    // post-hold style：record + segmentTl.call（R21/SA-36，镜像 site2 P3）。
    // seek 时 replayStyles 消费 record（segment.timeline.seek 默认 suppressEvents，tl.call 不触发，
    // 由 replayStyles 按 timePosition<=currentTime 重放）；正向播放 segmentTl.call 触发 apply。
    // R22/SA-37：加 exact-boundary 所有权 guard——seek 落在 record.timePosition 上、随后 play 时，
    // deferred tick 跨越会重触发此 tl.call（与 seek 的 replayStyles 双 apply，big ×1.5 两次=×2.25
    // 几何错）。guard 检查 record.timePosition === lastSeekTime 则跳过：seek 已应用过此 record，
    // play 的 tl.call 让位给快照消费者。原「不加守卫——style 不创建资源」注释废止：双 apply 是
    // mutation 双（不是资源泄漏），guard 现为防 mutation 双。
    for (const { config, time } of blockStylePostHold) {
      // Bug 2: :bg scope post-hold style 跳过（同 pre-hold 理由）。
      if (config.level === "bg") {
        console.warn(`[SegmentBuilder] :bg post-hold style "${config.name}" — not applicable to bg sprite, skipped`);
        continue;
      }
      const resolved = EffectProcessor.resolveParams(config.params);
      const cfgName = config.name;
      const cfgParams = { ...resolved };
      const recTime = time;
      // P2b post-hold style 经 StyleWritePort 显式相位契约（处方 6 提交 4）。
      // R22/SA-37 exact-boundary guard + StyleRecord 登记由 port 统一承载。
      styleWritePort.registerPostHoldWrite(
        recTime,
        paragraphText,
        cfgName,
        cfgParams,
        allStyleRecords,
        segmentTl,
        () => playbackState.lastSeekTime,
      );
    }
  }
}