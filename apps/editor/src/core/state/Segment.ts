import type { StageState } from "../stage/StageManager";
import type { LayoutState } from "../layout/LayoutEngine";
import type { KineticText } from "../KineticText";
import type { BehaviorRecord, StyleRecord, InstantEffectRecord, EntranceFilterRecord } from "../render/text/TextPlayer";

/**
 * Stage modifier 命令记录（cam.shake/cam.drift 等 modifier-based stage 特效）。
 * 与 BehaviorRecord 对称：seek 时按 timePosition 重放（tl.call seek 跨过不补触发）。
 * stop/clearScreen/重播靠 stageManager.clearModifiers() 统一清。
 */
export interface StageModifierRecord {
  command: string;
  params: Record<string, any>;
  timePosition: number;
  /** modifier 持续时长（秒）。cam.shake 有 duration（有限），cam.drift 无（persistent）。
   *  replayStageModifiers 只重放 currentTime <= timePosition + duration 的 modifier
   *  （seek 到 shake 结束后不重放）。undefined = persistent（总是重放）。
   *  按命令语义提取（getStageModifierDuration），不用通用 params[1]——cam.shake 的 params[1]
   *  是 duration 但 cam.drift 的 params[1] 是 speed。 */
  duration?: number;
  /** cam.reset 的 clear boundary：replayStageModifiers 遇到此 record 时清掉之前所有 modifier，
   *  之后不再重放 boundary 清掉的 modifier。
   *  R10：reset 在 effectiveTime（=timePosition+resetDuration）调 clearModifiers 是 **clear-all**。
   *  skip 须双维度：`timePosition < effectiveTime`（时间维度，resetDuration>0 覆盖）**或**
   *  `timePosition === effectiveTime 且 i <= boundaryIndex`（创建序，resetDuration=0 退化时唯一判据）。
   *  四轮（R8-1/R8-2/R8-3/R10）收敛——见 SA-24 根因：单维度（仅时间 / 仅创建序）各自漏一侧。 */
  isClearBoundary?: boolean;
  /** cam.reset 的持续时长（秒）。R4-2：boundary 生效时间 = timePosition + resetDuration（与正常播放
   *  对齐——buildMode 下 cam.reset 在 resetTl 末尾才 clearModifiers，不是起点）。replayStageModifiers
   *  据此把 reset boundary 推迟到 reset 结束，避免 seek 到 reset 动画中途提前丢掉 reset 前的 drift/shake。
   *  由 buildStageModifierRecord 填；未携时回退到 timePosition（兼容旧 record）。 */
  resetDuration?: number;
  /** cam.shake 的基础强度（build 期已解析变量，F-3）。replayStageModifiers 直接读它算剩余强度，
   *  不在 replay 时重解析 `var.*`（R5-3 修的是 replay 时解析，F-3 进一步把解析前移到 build 期，
   *  与 StageRuntime.apply 同源一次）。未携时回退到 replay 时 resolveStageNumeric（兼容旧 record）。 */
  baseStrength?: number;
  /** cam.shake 的衰减缓动曲线名（build 期从 preset ease 读，F-3）。replayStageModifiers 用
   *  gsap.parseEase(easeName) 求剩余强度，与正常播放的衰减 tween 逐帧同源。不硬编码 "power2.out"
   *  （R3-4 发现 GSAP power2.out 实为 1-(1-t)^3，硬编码指数会与 preset ease 漂移）。未携时
   *  回退到 "power2.out"（兼容旧 record）。 */
  easeName?: string;
  /** build/push 顺序（单调递增），表达 GSAP callback 执行顺序——同时间戳时先 push 的先执行。
   *  R11：replayStageModifiers 用它判定 clear-all 的"创建序"维度。**不是 ordered 索引**——stable sort
   *  后同 timePosition 保留 push 顺序，但不同 timePosition 的 push 顺序会被排序打乱（如 >>> overlap：
   *  p1 drift@2 先 push、p2 reset@1 后 push，但 reset 在 effectiveTime=2 clear 时 drift 已 apply）。
   *  sequence 是 build 期分配的真实顺序，不受排序影响。由 SegmentBuilder 在 push 时填
   *  （allStageModifierRecords.length）。未携时回退到 ordered 索引（兼容旧 record，R11 前的构建产物）。 */
  sequence?: number;
}

/**
 * 段落级别的 Timeline 构建产物
 *
 * 一个 ParagraphUnit 对应一个 KineticText 实例在 Segment Timeline 上的贡献。
 */
export interface ParagraphUnit {
  /** 段落在全局段落数组中的索引 */
  paragraphIndex: number;
  /** 段落的 KineticText 实例（承载 Pixi 显示对象） */
  kineticText: KineticText;
  /** 段落子 Timeline 在 Segment Timeline 上的起始位置 (秒) */
  offsetInSegment: number;
  /** 段落的 Behavior 特效记录 */
  behaviors: BehaviorRecord[];
  /** 段落本身的时长 (秒) */
  duration: number;
}

/**
 * 在途动画记录：描述一个在 Segment 结束时尚未完成的舞台 Tween
 *
 * Phase B 跨 Segment 跳转时，根据此数据在新 Segment 的 Timeline 开头重建延续 Tween。
 */
export interface InFlightAnimation {
  /** 创建此动画的舞台指令 (e.g. "cam.move", "cam.zoom") */
  command: string;
  /** 目标属性和终值 (e.g. { x: 1000, y: 0 }) */
  targets: Record<string, number>;
  /** 原始总时长 (秒) */
  totalDuration: number;
  /** 在 Segment Timeline 上的起始时间 (秒) */
  startTimeInSegment: number;
  /** 缓动函数名 */
  ease: string;
}

/**
 * Checkpoint：可序列化的世界状态快照
 *
 * 用于跨 Segment 跳转时恢复环境。
 * 包含 Stage 状态、Layout 状态、以及已在场的段落列表。
 */
export interface Checkpoint {
  stage: StageState;
  layout: LayoutState;
  /** 在场段落：索引 + 屏幕位置 */
  activeParagraphs: Array<{ index: number; x: number; y: number }>;
  /** 此时间点仍在进行中的舞台动画（Phase B 跨 Segment 衔接用） */
  inFlightAnimations?: InFlightAnimation[];
}

/**
 * Segment：确定性播放单元
 *
 * 当前阶段（Phase A），整个线性脚本 = 一个 Segment。
 * Phase B 引入分支/循环后，脚本 = Segment Graph。
 *
 * 每个 Segment 拥有：
 * - 一个 gsap.Timeline（包含所有段落的子 Timeline）
 * - 入口/出口 Checkpoint（状态快照）
 * - Behavior 记录（Ticker 驱动，不在 Timeline 中）
 *
 * seek 流程：
 *   1. 恢复 entryCheckpoint → 重建在场文字
 *   2. segment.timeline.seek(localTime) → GSAP 自动插值所有入场动画和舞台 Tween
 *   3. 根据 localTime 重新注册活跃的 Behavior
 */
export interface Segment {
  /** Segment 唯一 ID（Phase A 下固定为 "main"） */
  id: string;
  /** 包含的段落单元 */
  paragraphs: ParagraphUnit[];
  /** 主 Timeline：包含所有段落的子 Timeline + 舞台 Tween */
  timeline: ReturnType<typeof import("gsap").gsap.timeline>;
  /** 所有 Behavior 记录（时间位置用于 seek 时判断哪些应该激活） */
  behaviors: BehaviorRecord[];
  /** 所有 Style 变更记录（seek 时 reset + 重放到目标时间点） */
  styleRecords: StyleRecord[];
  /** 所有 Instant 特效记录（静态 filter；seek 时从 target.filters 重置后重放） */
  instantEffects: InstantEffectRecord[];
  /** 所有入场特效 filter 清理记录（blurIn 等创建持久 filter 的 entrance；
   *  seek 时不重 apply——entrance tween 靠时间线插值；stop/clearScreen 时清理） */
  entranceFilters: EntranceFilterRecord[];
  /** 所有 stage modifier 命令记录（cam.shake/cam.drift 等）；seek 时按时间重放
   *  （tl.call seek 跨过不补触发 → modifier 残留/缺失）。stop/clearScreen/重播清 clearModifiers。 */
  stageModifierRecords: StageModifierRecord[];
  /** 入口状态快照（seek 时先恢复到这里） */
  entryCheckpoint: Checkpoint;
  /** 出口状态快照（下一个 Segment 的起始状态） */
  exitCheckpoint: Checkpoint;
  /** 本 Segment 中所有舞台 Tween 记录（用于计算 exitCheckpoint.inFlightAnimations） */
  stageTweenRecords: InFlightAnimation[];
  /** 总时长 (秒) */
  duration: number;
}
