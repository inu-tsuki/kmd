import type { KineticChar } from "../KineticChar";
import type { KineticText } from "../KineticText";
import type { StyleRecord, TimelineBuildResult } from "../render/text/TextPlayer";
import { EffectProcessor } from "../effects/EffectProcessor";

/** gsap 时间线类型（经 TimelineBuildResult.timeline 复用）。 */
type GsapTimeline = TimelineBuildResult["timeline"];

/**
 * Style 写入的显式有序相位契约（处方 6 收口形态）。
 *
 * ## 5 处 style 写入方清单（隐含管线的相位顺序）
 *
 * | 相位 | 模块 | 写什么 | 为什么存在 | 本次状态 |
 * |------|------|--------|-----------|----------|
 * | **P0 reset** | PlaybackController.replayStyles | `resetStyle()` 写 char.style 回 baseline | seek 时清回初始态再重放动态样式 | **follow-up #10**（随 PlaybackController 拆分迁入） |
 * | **P1 bake** | LayoutPlanner.applyInitialStylesToStyle | styleManager.apply 写 measurementStyle → 烘进 glyphPlan.style → KineticChar 构造 baseline | 构建期烘焙 pre-hold 初始样式进 baseline | **follow-up**（随 LayoutPlanner 拆分迁入） |
 * | **P2 recapture** | SegmentBuilder（本 port） | recaptureBaseStyleSnapshot 写 baseStyleSnapshot | block pre-hold style 同步写后重捕 baseline | **本次已迁至 port** |
 * | **P2b block post-hold** | SegmentBuilder（本 port） | segmentTl.call 内 applyStyleRecursively 写 char.style + 登记 StyleRecord | block 链 post-hold 动态样式经 tl.call 触发、seek 由 replayStyles 重放 | **本次已迁至 port** |
 * | **P3 unrollGroupChain** | TextPlayer | tl.call 内 applyStyleRecursively 写 char.style + 登记 StyleRecord | 组级 hold 链 post-hold 动态样式 | **follow-up**（随 TextPlayer 拆分迁入） |
 * | **P4 unrollCharChain** | TextPlayer | tl.call 内 styleManager.apply 写 char.style + 登记 StyleRecord | char 级 hold 链 post-hold 动态样式 | **follow-up**（随 TextPlayer 拆分迁入） |
 * | **P4 replay** | PlaybackController.replayStyles | styleManager.apply 写 char.style | seek 重放 timePosition<=currentTime 的 StyleRecord | **follow-up #10** |
 * | **外部直写** | presets/behavior.ts:244 | `target.style.fill = "#ffffff"` 直写 | 某 behavior preset 绕过 styleManager 的散写 | **follow-up**（最该清理的散写，建议下个维护窗口改走 styleManager.apply） |
 *
 * ## 收口形态：显式有序阶段，而非魔法函数
 *
 * 处方措辞"单一收口点**或显式有序阶段**"——此处选后者。5 处写入分布在一条隐含管线相位上，
 * 收口 = 把相位顺序显式化、定统一的写入契约，明确"哪个相位、谁、写什么"。这是耐久 seam，
 * 让其余 4 处将来增量迁上来，不必二次设计。
 *
 * ## 本次范围
 * 仅 SegmentBuilder 的 P2（recapture）/ P2b（block post-hold）迁到此 port。其余标注 follow-up，
 * 不在本 PR 重构那些模块（TextPlayer / PlaybackController / LayoutPlanner / behavior.ts）。
 *
 * ## INV-7 合规
 * 本 port 不做 style 身份判定（初始 vs 动态）——该判定由构建期 classifyStyleWrite 单一真相源保证。
 * port 只承载相位写入契约。replayStyles（P0/P4）只消费不判定（见 PlaybackController.replayStyles 注释）。
 */
export interface StyleWritePort {
  /**
   * P2: block pre-hold style 经 applyGroupEffects 同步写后，重新捕获 baseline。
   * 写入 baseStyleSnapshot 字段（从当前 char.style 拷回快照）。
   */
  recaptureBaseline(chars: Iterable<KineticChar>): void;

  /**
   * P2b: block post-hold style 在 segmentTl.call 触发时写 char.style，并登记 StyleRecord。
   *
   * **R22/SA-37 exact-boundary guard**：seek 落在 record.timePosition 上、随后 play 时，
   * deferred tick 跨越会重触发此 tl.call（与 seek 的 replayStyles 双 apply，big ×1.5 两次=×2.25
   * 几何错）。guard 检查 record.timePosition === lastSeekTime 则跳过：seek 已应用过此 record，
   * play 的 tl.call 让位给快照消费者。
   *
   * **wall-clock 非泄漏**：segmentTl.call 不在 build 期触发，只在正向播放的 ticker tick 跨越时触发
   * （GSAP deferred 语义，见 lifecycle-invariants.md §B-bis）。build 后不 play、等 120ms 不会染红。
   */
  registerPostHoldWrite(
    recTime: number,
    target: KineticText,
    styleName: string,
    params: Record<string, any>,
    styleRecords: StyleRecord[],
    tl: GsapTimeline,
    lastSeekTimeGetter: () => number | undefined,
  ): void;
}

/**
 * StyleWritePort 的默认实现（也是本 PR 唯一实现）。
 * 行为保持：内部逻辑与原 SegmentBuilder L327-346 完全一致，只收口为方法调用。
 */
export class DefaultStyleWritePort implements StyleWritePort {
  recaptureBaseline(chars: Iterable<KineticChar>): void {
    for (const c of chars) {
      c.recaptureBaseStyleSnapshot();
    }
  }

  registerPostHoldWrite(
    recTime: number,
    target: KineticText,
    styleName: string,
    params: Record<string, any>,
    styleRecords: StyleRecord[],
    tl: GsapTimeline,
    lastSeekTimeGetter: () => number | undefined,
  ): void {
    const cfgParams = { ...params };
    tl.call(() => {
      if (lastSeekTimeGetter() === recTime) return;
      EffectProcessor.applyStyleRecursively(target, styleName, cfgParams, true);
    }, [], recTime);
    for (const token of target.tokens) {
      for (const c of token.chars) {
        if (!c.text.trim()) continue;
        styleRecords.push({ char: c, styleName, params: { ...cfgParams }, timePosition: recTime });
      }
    }
  }
}