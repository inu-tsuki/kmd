import type { BehaviorCleanup, InstantCleanup, PlaybackRuntimeState } from "./PlaybackController";

/**
 * 子构建器看到的窄写入接口——它们只看到登记，不知道数组、不知道谁执行。
 * 这是处方 6 收口 SegmentBuilder 内 8 处裸 `playbackState.activeBehaviorCleanups.push` /
 * `activeInstantCleanups.push` 的单一写入契约：子构建器只能经 sink.register 写入，
 * 不再直接 reach into 共享可变数组。
 *
 * **单一所有权**（处方的核心诉求）：两个数组的存储与 drain 仍由 PlaybackRuntimeState 持有、
 * 由 PlaybackController.clearBehaviors / clearInstantEffects 唯一 drain。sink 只是该数组
 * 的窄视图——不是分散的多份 list，不是第二数组。PlaybackController 的 registerBehaviors /
 * registerInstantEffects 3 处 push 本 PR 不动（deferred 到后续 PlaybackController 拆分）。
 */
export interface BehaviorCleanupSink {
  register(entry: BehaviorCleanup): void;
}

export interface InstantCleanupSink {
  register(entry: InstantCleanup): void;
}

/**
 * CleanupRegistry：build 期注入给子构建器的 sink 工厂。
 *
 * **设计取舍**（简化方案，不破坏现有读取/初始化/断言）：
 * sink 的 register 实现直接 push 到传入的 `playbackState.activeBehaviorCleanups` /
 * `activeInstantCleanups`。不引入第二个数组——SegmentBuilder 的 8 处写入从此经窄接口登记，
 * 执行侧单一所有权仍是 `playbackState` 数组本身（由 PlaybackController.clear* 唯一 drain）。
 *
 * 测试断言（`playbackState.activeBehaviorCleanups.length` 等）不受影响：数组对象与字段不变，
 * 只是写入路径从裸 push 收口为 sink.register。ScriptPlayer.ts:45-46 的初始化点不变。
 */
export class CleanupRegistry {
  private playbackState: PlaybackRuntimeState;
  constructor(playbackState: PlaybackRuntimeState) {
    this.playbackState = playbackState;
  }

  readonly behaviorSink: BehaviorCleanupSink = {
    register: (entry) => this.playbackState.activeBehaviorCleanups.push(entry),
  };

  readonly instantSink: InstantCleanupSink = {
    register: (entry) => this.playbackState.activeInstantCleanups.push(entry),
  };
}