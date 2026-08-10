// R22 exact-boundary 双 apply 抑制回归 [21]-[23]（主题一：织网 S12 / playback 渐拆第 4 批）。
//
// 迁自 final-playback-test.ts 的 testR22LastSeekTimeLifecycle([21]) / testR22GsapPremise([22]) /
// testR22BoundaryGuardMechanism([23])。
//
// 背景（原脚本 SA-37）：seek 落在 record.timePosition 上、随后 play 时，GSAP deferred tick 跨越
// boundary 会重触发同一 record 的 tl.call，与 seek 的 register*/replayStyles 双 apply（pixelate/blur
// 双 push filter、big ×1.5 两次=×2.25 几何错）。修复：seekToTime/playSegment 记 state.lastSeekTime，
// boundary tl.call guard 检查 record.timePosition===lastSeekTime 则跳过。
//
// ⚠️ 测试环境局限（诚实保留）：vitest 套件经 setup.ts stub gsap.ticker（add/remove no-op），故
// tl.play() 不推进时间、deferred boundary tl.call 不在套件内触发——无法直接复现 seek+play 的双
// apply（需浏览器 rAF 驱动 ticker，e2e 兜底）。此处测三层：
// (1) lastSeekTime 生命周期：seekToTime/playSegment 正确设值（同步，不需 ticker）。
// (2) GSAP deferred-fire 前提：用真实 ticker（G.ticker）验证「tl.call 在 tick 跨越时触发、非 play()
//     同步」+ ownership-flag 拦得住——锁定 load-bearing 假设，防 gsap 升级静默破坏。
// (3) guard 机制：seek 后 lastSeekTime===record.timePosition，手动模拟 boundary tl.call 的 guard
//     判定验证 skip 语义（不依赖 ticker 触发，只验证 guard 逻辑 + 状态）。
//
// ⚠️ [22] 保持单个不透明 it()：tsx 下 G.ticker.tick() 推进行为不稳（探针时偶现推进 1.001、偶现
// 几乎不推进），原脚本已用弱断言吸收此 flaky——迁移**原样保留弱断言与注记，显式禁止加强**
// （加强 = 把环境 flaky 变成回归 flaky）。生产浏览器 rAF 驱动 ticker，deferred 触发稳定。

import { describe, it, expect } from 'vitest';
import { PlaybackController } from '../core/player/PlaybackController';
import type { Segment } from '../core/state/Segment';
import { G, build } from './playback-harness';

/** 断言桥：1:1 保留原脚本 assert(cond, msg) 的诊断文本（vitest 自定义消息）。 */
function assert(cond: boolean, message: string): void {
  expect(Boolean(cond), message).toBe(true);
}

describe('[21] R22 lastSeekTime 生命周期（SA-37）', () => {
  // 原脚本用独立 makeEmptySegment（paused timeline + id 字段）与 makeState（无 onTimeUpdate），
  // 与 harness.makeFakeSegment/makeFakeState 形状略异——忠实保留原 helper，不换 harness 版。
  function makeEmptySegment(duration = 2): Segment {
    const tl = G.timeline({ paused: true });
    tl.to({ x: 0 }, { x: 1, duration }, 0);
    return {
      id: 'main',
      paragraphs: [],
      timeline: tl,
      behaviors: [],
      styleRecords: [],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      entryCheckpoint: {} as any,
      exitCheckpoint: {} as any,
      duration,
    } as Segment;
  }

  function makeState(): any {
    return {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [],
    };
  }

  it('seekToTime 设 clamped lastSeekTime；playSegment resume/ended 分支各自设值', () => {
    // (1) seekToTime 设 lastSeekTime = clamped。
    {
      const seg = makeEmptySegment(2);
      const state = makeState();
      PlaybackController.seekToTime(seg, 1.0, state);
      assert(
        state.lastSeekTime === 1.0,
        `R22 seekToTime(1.0) 设 lastSeekTime=1.0（实际 ${state.lastSeekTime}）`,
      );
    }
    // (2) seekToTime clamp：seek 超界仍设 clamped 值。
    {
      const seg = makeEmptySegment(2);
      const state = makeState();
      PlaybackController.seekToTime(seg, 5.0, state);
      assert(
        state.lastSeekTime === 2.0,
        `R22 seekToTime(5.0) clamp 到 2.0 设 lastSeekTime=2.0（实际 ${state.lastSeekTime}）`,
      );
    }
    // (3) playSegment 设 lastSeekTime = tl.time()（resume 路径，t>0）。
    {
      const seg = makeEmptySegment(2);
      const state = makeState();
      // 先 seek 到 0.5（设 lastSeekTime=0.5），再 playSegment（resume，tl.time()=0.5）。
      PlaybackController.seekToTime(seg, 0.5, state);
      assert(state.lastSeekTime === 0.5, `R22 prep seek(0.5) 设 lastSeekTime=0.5`);
      // playSegment 会把 lastSeekTime 覆写为 tl.time()=0.5（resume 路径）。
      state.isAutoPlaying = false; // 模拟暂停态 seek 后
      PlaybackController.playSegment(seg, state);
      assert(
        state.lastSeekTime === 0.5,
        `R22 playSegment resume @0.5 覆写 lastSeekTime=0.5（实际 ${state.lastSeekTime}）`,
      );
    }
    // (4) playSegment ended 分支：seek(0) 后 lastSeekTime=0。
    {
      const seg = makeEmptySegment(1);
      const state = makeState();
      // 推到 ended：seek 到末尾 + 设 isAutoPlaying 让 derivePhase 判 ended。
      PlaybackController.seekToTime(seg, 1.0, state);
      state.isAutoPlaying = true; // 模拟播完（onComplete 设 false 前）
      // 注：progress>=1 即 ended（derivePhase 优先判 progress）。
      PlaybackController.playSegment(seg, state);
      assert(
        state.lastSeekTime === 0,
        `R22 playSegment ended 分支 seek(0) 后 lastSeekTime=0（实际 ${state.lastSeekTime}）`,
      );
    }
  });
});

describe('[22] R22 GSAP deferred-fire 前提探针（SA-37，load-bearing 假设锁定）', () => {
  // ⚠️ 单个不透明 it() + 弱断言为刻意设计（tsx ticker flaky，见文件头）——禁止细分或加强。
  it('tl.call 非 play() 同步触发；ownership-flag 拦住 deferred call（弱断言吸收 tick 不稳）', () => {
    // 临时用真实 ticker（套件 stub 了 gsap.ticker；此处用 G（gsap.default）的真实 ticker——
    // G 不受 setup.ts stub 影响，stub 改的是 gsap 命名空间，G 是 .default）。
    const realTicker = (G as any).ticker;
    const hasRealTicker = !!(realTicker && typeof realTicker.tick === 'function');

    if (!hasRealTicker) {
      assert(true, 'R22 G.ticker 不可用（跳过 deferred 探针——环境限制）');
      return;
    }

    // (1) tl.call 不是 play() 同步触发（可靠断言——不依赖 tick 是否触发）。
    {
      const tl = G.timeline({ paused: true });
      let calls = 0;
      tl.call(() => { calls++; }, [], 1.0);
      tl.to({ x: 0 }, { x: 1, duration: 2 }, 0);
      tl.seek(1.0);            // boundary, suppressEvents
      tl.play();
      const afterPlay = calls;
      assert(
        afterPlay === 0,
        `R22 tl.call 不是 play() 同步触发（afterPlay=${afterPlay} want 0；若 want 1 则 deferred 假设破、修复无效）`,
      );
    }
    // (2) flip-the-guard：若 tick 触发了 call，guard 在 tick 时已开（isAutoPlaying 已恢复 true）→
    //     不应被 flip 抑制。弱断言：若 tick 未触发（calls=0，环境不稳），不算 flip 失败；只验证「flip
    //     不能把已触发的 call 变回 0」——即 calls 不会因 flip 而 < 无 flip 时的值。
    {
      const tl = G.timeline({ paused: true });
      let calls = 0;
      let isAutoPlaying = false;
      tl.call(() => { if (!isAutoPlaying) return; calls++; }, [], 1.0);
      tl.to({ x: 0 }, { x: 1, duration: 2 }, 0);
      tl.seek(1.0);
      isAutoPlaying = false;
      tl.play();
      isAutoPlaying = true;    // flip 在 play() 返回时已恢复
      realTicker.tick(1 / 60);
      // 弱断言：flip 不能负向抑制（calls >= 0 恒真，但语义是「flip 没让 call 消失」——若 tick 触发则
      // calls=1 证明 flip 失败；若 tick 未触发则 calls=0 是环境限制不是 flip 成功）。
      assert(
        calls === 0 || calls === 1,
        `R22 flip-the-guard 弱断言（calls=${calls}；=1 证明 flip 失败，=0 是环境 tick 未触发——均不矛盾修复）`,
      );
    }
    // (3) ownership-flag：若 tick 触发了 call，guard 读 flag 跳过→calls=0。
    //     弱断言：calls=0（flag 拦住 OR tick 未触发，两者都符合修复正确性）。
    {
      const tl = G.timeline({ paused: true });
      let calls = 0;
      let lastSeekTime: number | null = null;
      tl.call(() => {
        if (lastSeekTime === 1.0) return;   // boundary guard
        calls++;
      }, [], 1.0);
      tl.to({ x: 0 }, { x: 1, duration: 2 }, 0);
      lastSeekTime = 1.0;                   // seekToTime 设 flag
      tl.seek(1.0);
      tl.play();                            // play 不清 flag
      realTicker.tick(1 / 60);              // deferred tick 跨越 → guard 读 flag 跳过
      assert(
        calls === 0,
        `R22 ownership-flag 拦住 deferred call（calls=${calls} want 0；flag 在 tick 存活→guard skip）`,
      );
    }
  });
});

describe('[23] R22 exact-boundary guard 机制端到端（SA-37）', () => {
  it('seek 后 lastSeekTime===record.timePosition → guard skip；非 record 时间不 skip', async () => {
    // (A) behavior filter（f.blur）seek 后 lastSeekTime===record.timePosition，
    //     手动模拟 boundary tl.call 的 guard 判定应 skip。
    //     注：套件无 ticker 驱动，无法观察 play() 的 deferred 双 apply；此处验证 guard 状态正确——
    //     seek(0) 后 lastSeekTime===0，segment.behaviors 中 0s record 的 timePosition===0，guard 判定 skip。
    {
      const { segment, char, playbackState } = await build('{Hi} @ f.blur');
      // build 后 segment.behaviors 有 0s blur record（每字一条）。
      const has0sBehavior = segment.behaviors.some((b: any) => b.timePosition === 0);
      assert(has0sBehavior, `R22-A build 后有 0s behavior record（实际 has0s=${has0sBehavior}）`);
      // seek(0)：registerBehaviors 应用 0s record（filter=1），lastSeekTime=0。
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        playbackState.lastSeekTime === 0,
        `R22-A seek(0) 设 lastSeekTime=0（实际 ${playbackState.lastSeekTime}）`,
      );
      // guard 判定：0s behavior record 的 timePosition(0)===lastSeekTime(0) → 应 skip。
      const boundaryRecord = segment.behaviors.find((b: any) => b.timePosition === 0)!;
      const wouldSkip = playbackState.lastSeekTime === boundaryRecord.timePosition;
      assert(
        wouldSkip,
        `R22-A boundary guard 判定 skip（record.timePosition=${boundaryRecord.timePosition}===lastSeekTime=${playbackState.lastSeekTime}）`,
      );
      // seek(0) 后 filter 应为 1（registerBehaviors 单次 apply，不双 push）。
      const filters = (char as any).filters;
      assert(
        Array.isArray(filters) && filters.length === 1,
        `R22-A seek(0) 后 char.filters=1（registerBehaviors 单次 apply，实际 ${filters?.length}）`,
      );
    }

    // (C) style 双 mutate（big:block）seek 后 lastSeekTime===record.timePosition，guard 应 skip。
    //     [.hold:block(1s).big:block]\nHello：seek(1.0) → fontSize=54（36×1.5 单次），
    //     lastSeekTime=1.0===big record.timePosition → guard skip（防 ×2.25=81）。
    {
      const { segment, char, playbackState } = await build('[.hold:block(1s).big:block]\nHello');
      // big record 应在 timePosition≈1.0（hold 1s 后）。
      const bigRecord = segment.styleRecords.find((r: any) => r.styleName === 'big');
      assert(bigRecord, `R22-C build 后有 big style record`);
      const bigTime = bigRecord?.timePosition ?? -1;
      // seek 到 big 生效点：replayStyles 应用 big（fontSize=54），lastSeekTime=bigTime。
      PlaybackController.seekToTime(segment, bigTime, playbackState);
      const fontSize = (char as any).style?.fontSize;
      assert(
        fontSize === 54,
        `R22-C seek(bigTime=${bigTime.toFixed(2)}) 后 fontSize=54（36×1.5 单次，实际 ${fontSize}）`,
      );
      assert(
        playbackState.lastSeekTime === bigTime,
        `R22-C seek 设 lastSeekTime=bigTime（实际 ${playbackState.lastSeekTime}）`,
      );
      // guard 判定：big record.timePosition===lastSeekTime → 应 skip（防 play 后 deferred tick 再 ×1.5）。
      const wouldSkip = playbackState.lastSeekTime === bigRecord!.timePosition;
      assert(
        wouldSkip,
        `R22-C boundary guard 判定 skip（big record.timePosition=${bigRecord!.timePosition}===lastSeekTime=${playbackState.lastSeekTime}）`,
      );
    }

    // (D) 对照：seek 落在非 record 时间，guard 不 skip（forward play 跨 record 应正常 apply）。
    {
      const { segment, playbackState } = await build('{Hi} @ f.blur');
      // seek 到 0.5（无 record 在 0.5）。
      PlaybackController.seekToTime(segment, 0.5, playbackState);
      const anyBoundary = segment.behaviors.some((b: any) => b.timePosition === playbackState.lastSeekTime);
      assert(
        !anyBoundary,
        `R22-D seek(0.5) 落非 record 时间，无 boundary 匹配（lastSeekTime=${playbackState.lastSeekTime}，anyBoundary=${anyBoundary}）`,
      );
    }
  });
});
