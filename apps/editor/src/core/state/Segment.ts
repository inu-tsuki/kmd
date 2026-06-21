import type { StageState } from "../stage/StageManager";
import type { LayoutState } from "../layout/LayoutEngine";
import type { KineticText } from "../KineticText";
import type { BehaviorRecord, StyleRecord, InstantEffectRecord } from "../render/text/TextPlayer";

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
  /** 入口状态快照（seek 时先恢复到这里） */
  entryCheckpoint: Checkpoint;
  /** 出口状态快照（下一个 Segment 的起始状态） */
  exitCheckpoint: Checkpoint;
  /** 本 Segment 中所有舞台 Tween 记录（用于计算 exitCheckpoint.inFlightAnimations） */
  stageTweenRecords: InFlightAnimation[];
  /** 总时长 (秒) */
  duration: number;
}
