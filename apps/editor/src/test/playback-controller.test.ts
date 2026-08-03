// PlaybackController 核心回归 [1]-[4]（主题一：织网 S9 / playback 渐拆第 1 批）。
//
// 迁自 final-playback-test.ts 的 testDerivePhase / testSeekToTimeClampAndCallback /
// testPlaySegmentEndedBranch / testDeriveReplayMode（原 [1]-[4] 节，共 22 条断言）。
// 断言语义 1:1 保持，仅 assert(cond,msg) → expect() 机械转换；共享 makeFakeSegment /
// makeFakeState 来自 playback-harness.ts（原脚本同源副本收编）。
//
// 纯状态机用例：makeFakeSegment 的空 record 数组让 seek/play 退化为 clamp + 真实 gsap.seek
// + onTimeUpdate，不触 effectManager/stageManager.apply（render 边界在 [13]+ E2E 批覆盖）。
// 无单例触点，无 teardown 需求。

import { describe, it, expect } from 'vitest';
import { PlaybackController } from '../core/player/PlaybackController';
import { makeFakeSegment, makeFakeState } from './playback-harness';

describe('[1] derivePhase 穷举（F-2 单一真相源）', () => {
  it('null segment：isAutoPlaying 决定（无 timeline 可查 progress）', () => {
    const { state: playingState } = makeFakeState(true);
    const { state: pausedState } = makeFakeState(false);
    expect(PlaybackController.derivePhase(null, playingState)).toBe('playing');
    expect(PlaybackController.derivePhase(null, pausedState)).toBe('paused');
  });

  it('progress>=1 → ended 无论 isAutoPlaying（R6-1：seek 到尾 onComplete 未触发仍要识别）', () => {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(2); // progress=1
    const { state: autoState } = makeFakeState(true);
    const { state: manualState } = makeFakeState(false);
    expect(PlaybackController.derivePhase(seg, autoState)).toBe('ended');
    expect(PlaybackController.derivePhase(seg, manualState)).toBe('ended');
  });

  it('progress<1：isAutoPlaying 决定 playing vs paused（R5-1 seek-while-playing resume gate）', () => {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(1); // progress=0.5
    const { state: playingState } = makeFakeState(true);
    const { state: pausedState } = makeFakeState(false);
    expect(PlaybackController.derivePhase(seg, playingState)).toBe('playing');
    expect(PlaybackController.derivePhase(seg, pausedState)).toBe('paused');
  });

  it('progress=0（开头）：isAutoPlaying 决定', () => {
    const seg = makeFakeSegment(2);
    const { state: playingState } = makeFakeState(true);
    const { state: pausedState } = makeFakeState(false);
    expect(PlaybackController.derivePhase(seg, playingState)).toBe('playing');
    expect(PlaybackController.derivePhase(seg, pausedState)).toBe('paused');
  });
});

describe('[2] seekToTime 边界（clamp + onTimeUpdate）', () => {
  it('seek(-1) clamp 到 0，onTimeUpdate 收到 0ms', () => {
    const seg = makeFakeSegment(2);
    const { state, getLastTimeUpdate } = makeFakeState(false);
    const ret = PlaybackController.seekToTime(seg, -1, state);
    expect(ret).toBeCloseTo(0, 6);
    expect(getLastTimeUpdate() ?? -1).toBeCloseTo(0, 6);
  });

  it('seek(5) clamp 到 duration=2，progress>=1，onTimeUpdate 收到 2000ms', () => {
    const seg = makeFakeSegment(2);
    const { state, getLastTimeUpdate } = makeFakeState(false);
    const ret = PlaybackController.seekToTime(seg, 5, state);
    expect(ret).toBeCloseTo(2, 6);
    expect(seg.timeline.progress()).toBeGreaterThanOrEqual(1);
    expect(getLastTimeUpdate() ?? -1).toBeCloseTo(2000, 6);
  });

  it('seek(1) 返回 1，tl.time() 落在 1s，onTimeUpdate 收到 1000ms', () => {
    const seg = makeFakeSegment(2);
    const { state, getLastTimeUpdate } = makeFakeState(false);
    const ret = PlaybackController.seekToTime(seg, 1, state);
    expect(ret).toBeCloseTo(1, 6);
    expect(seg.timeline.time()).toBeCloseTo(1, 6);
    expect(getLastTimeUpdate() ?? -1).toBeCloseTo(1000, 6);
  });
});

describe('[3] playSegment 状态转换（R5-1/R6-1/R7-1）', () => {
  it('ended segment → ended 分支（seek(0)+clear）不抛错，progress 回到开头', () => {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(2); // ended
    const { state } = makeFakeState(false);
    expect(PlaybackController.derivePhase(seg, state)).toBe('ended');
    expect(() => PlaybackController.playSegment(seg, state)).not.toThrow();
    // ended 分支 seek(0) 后 progress 应回到 0（除非 duration 为 0）。
    expect(seg.timeline.progress()).toBeLessThan(0.5);
  });

  it('playing-mid → resume 分支不抛错', () => {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(1); // mid
    const { state } = makeFakeState(true);
    expect(PlaybackController.derivePhase(seg, state)).not.toBe('ended');
    expect(() => PlaybackController.playSegment(seg, state)).not.toThrow();
  });
});

describe('[4] deriveReplayMode（trivial，锁死未来分支化回归）', () => {
  it('seekToTime 经 deriveReplayMode 不抛错（当前恒 "static"；若未来按 phase 分支化须同步更新此批）', () => {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(1);
    const { state } = makeFakeState(true);
    // deriveReplayMode 是 private——经 seekToTime 间接覆盖即可，不单独调。
    expect(() => PlaybackController.seekToTime(seg, 0.5, state)).not.toThrow();
  });
});
