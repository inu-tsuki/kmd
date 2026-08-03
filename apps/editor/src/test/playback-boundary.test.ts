// reset boundary 过滤语义 [5]（主题一：织网 S14 / playback 渐拆第 6 批 · 镜像算法）。
//
// 迁自 final-playback-test.ts 的 testResetBoundaryFilter（原 [5]，R8-1/R8-2/R8-3/R9/R10/R11 全形态）。
//
// ⚠️ 诚实注记一（镜像而非真调）：r8WhichToReplay 是 PlaybackController.replayStageModifiers 的
// boundary + skip 过滤循环的**复制镜像**（原脚本 SA-23 记录的方法）——因为真调路径经
// stageManager.apply → StageRuntime.apply → gsap.getTweensOf，tsx 下不可 headless 跑非空 records。
// 本套件测的是「哪些 record 被判定为可重放」的纯逻辑形状，**不是**真实 apply 管线；后者由
// [13]-[20.5]（playback-pipeline.test.ts）与浏览器 e2e 覆盖。
//   镜像源码对照：apps/editor/src/core/player/PlaybackController.ts 的 replayStageModifiers
//   （R8-3 + R9-High + R10 修复后版本）。若该方法演进，本镜像必须同步，否则此套件验证的是历史算法。
//
// ⚠️ 诚实注记二（为何不暴露私有方法直接测）：把 replayStageModifiers 提为 public 或抽 helper
// 会改动 Phase B 拥有的生产代码结构——渐拆原则是测试搬家、生产零改动。镜像 + 同步注记是
// 代价最小的合规路径；Phase B 重写 PlaybackController 时此镜像应一并退役或重写。
//
// 语义模型（R8 三轮修复根因：用单一标量阈值表达二维 clear 语义——见 SA-24）：
// reset 在 effectiveTime(=timePosition+resetDuration) 调 clearModifiers，清掉所有
// timePosition < effectiveTime 的存活 modifier（clear-all，不分创建序）。skip 维度有二：
//   时间维：timePosition < lastClearBoundaryEffectiveTime
//   创建序维：同 effectiveTime 时 record.sequence（push 序）——R11 证明 ordered 索引在
//            >>> overlap 下错误，sequence 字段必需。

import { describe, it, expect } from 'vitest';

/** 断言桥：1:1 保留原脚本 assert(cond, msg) 的诊断文本（vitest 自定义消息）。 */
function assert(cond: boolean, message: string): void {
  expect(Boolean(cond), message).toBe(true);
}

interface R8Record {
  command: string;
  timePosition: number;
  isClearBoundary?: boolean;
  resetDuration?: number;
  duration?: number;
  params: any;
  /** build/push 顺序（R11）。未设时回退到 ordered 索引（兼容旧行为）。 */
  sequence?: number;
}

/** 镜像 PlaybackController.replayStageModifiers 的 boundary + skip 过滤（R8-3 + R9-High + R10 修复后版本）。 */
function r8WhichToReplay(records: R8Record[], currentTime: number): R8Record[] {
  const ordered = [...records].sort((a, b) => a.timePosition - b.timePosition);
  let lastClearBoundaryEffectiveTime = -1;
  let lastClearBoundarySequence = -1;
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    if (record.timePosition > currentTime) break;
    if (record.isClearBoundary) {
      const resetDur = record.resetDuration ?? 0;
      const effectiveTime = record.timePosition + resetDur;
      if (effectiveTime <= currentTime) {
        // R9-High：取最大 effective clear time；R11：同 max 取较大 sequence（更晚 push 的 reset）。
        const seq = record.sequence ?? i; // 回退到 ordered 索引（兼容旧 record）
        if (effectiveTime > lastClearBoundaryEffectiveTime
            || (effectiveTime === lastClearBoundaryEffectiveTime && seq > lastClearBoundarySequence)) {
          lastClearBoundaryEffectiveTime = effectiveTime;
          lastClearBoundarySequence = seq;
        }
      }
    }
  }
  const replay: R8Record[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    if (record.timePosition > currentTime) continue;
    // R8-3 + R10 + R11：skip 双维度（时间 + 创建序用 record.sequence 而非 ordered 索引）。
    if (lastClearBoundaryEffectiveTime >= 0) {
      if (record.timePosition < lastClearBoundaryEffectiveTime) continue;
      const seq = record.sequence ?? i; // 回退到 ordered 索引（兼容旧 record）
      if (record.timePosition === lastClearBoundaryEffectiveTime
          && seq <= lastClearBoundarySequence) continue;
    }
    if (record.isClearBoundary) continue;
    if (record.duration !== undefined && isFinite(record.duration)
        && currentTime >= record.timePosition + record.duration) continue;
    replay.push(record);
  }
  return replay;
}

describe('[5] reset boundary 过滤（R8-1 + R8-2 + R8-3：reset clear 语义三维）', () => {
  it('R8-1：reset 结束后新 drift 恢复；中途/之前 reset 前 drift 仍在', () => {
    // R8-1 形态：drift@0 → reset(1s)@1 → drift@2
    const records = [
      { command: 'cam.drift', params: { speed: 1 }, timePosition: 0 },
      { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
      { command: 'cam.drift', params: { speed: 2 }, timePosition: 2 },
    ];
    // reset 结束点及之后：新 drift 必须恢复（R8-1 复现点）
    for (const t of [2, 2.5, 3]) {
      const replay = r8WhichToReplay(records, t);
      const drifts = replay.filter((r) => r.command === 'cam.drift');
      assert(
        drifts.length === 1 && drifts[0].timePosition === 2,
        `R8-1 seek ${t}: reset 后的 drift 恢复（timePosition=2，非被 skip）`,
      );
    }
    // reset 动画中途（1.5）：reset 未完成，reset 前 drift 仍在（不应 skip）
    {
      const replay = r8WhichToReplay(records, 1.5);
      assert(
        replay.some((r) => r.command === 'cam.drift' && r.timePosition === 0),
        'R8-1 seek 1.5（reset 动画中途）: reset 前 drift 仍在（reset 未完成，不 skip）',
      );
    }
    // reset 之前（0.5）：drift 恢复
    {
      const replay = r8WhichToReplay(records, 0.5);
      assert(
        replay.some((r) => r.command === 'cam.drift' && r.timePosition === 0),
        'R8-1 seek 0.5（reset 之前）: drift 恢复',
      );
    }
    // reset 起点（1.0，未完成）：reset 前 drift 仍在
    {
      const replay = r8WhichToReplay(records, 1.0);
      assert(
        replay.some((r) => r.command === 'cam.drift' && r.timePosition === 0),
        'R8-1 seek 1.0（reset 起点，未完成）: reset 前 drift 仍在',
      );
    }
    // reset 之前的 shake（有 duration），seek 到 reset 之后应被 skip（reset 清了它）
    {
      const recs2 = [
        { command: 'cam.shake', params: {}, timePosition: 0, duration: 5 },
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
      ];
      const replay = r8WhichToReplay(recs2, 3);
      assert(
        !replay.some((r) => r.command === 'cam.shake'),
        'seek 3（reset 后）: reset 前的 shake 被 skip（boundary 清了它）',
      );
    }
  });

  it('R8-2：同 timestamp、reset 前创建的 drift 被 skip（Coco 第二轮）', () => {
    // R8-2 形态（Coco 第二轮）：drift@1 → reset@1（同 timestamp，drift 在 reset 之前 push）。
    // 真实 build 路径：SegmentBuilder 连续 stage configs 不推进 cursor → drift 与 reset 同 timePosition。
    // 正常播放 drift 先 apply，reset 结束时 clearModifiers → seek 到 reset 后不应恢复旧 drift。
    {
      const recs3 = [
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 1 },
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
      ];
      // seek 到 reset 完成后（2/2.5/3）：旧 drift 必须被 skip（timePosition 1 < effectiveTime 2）
      for (const t of [2, 2.5, 3]) {
        const replay = r8WhichToReplay(recs3, t);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          `R8-2 seek ${t}: reset 前同时间戳的 drift 被 skip（不应复活，Coco 复现点）`,
        );
      }
      // seek 到 reset 动画中途（1.5）：reset 未完成，drift 仍在
      {
        const replay = r8WhichToReplay(recs3, 1.5);
        assert(
          replay.some((r) => r.command === 'cam.drift' && r.timePosition === 1),
          'R8-2 seek 1.5（reset 动画中途）: 同时间戳 drift 仍在（reset 未完成）',
        );
      }
    }
    // R8-2 组合：drift@1 → reset@1 → drift@2（reset 前 drift 被 skip，reset 后 drift 恢复）
    {
      const recs4 = [
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 1 },
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
        { command: 'cam.drift', params: { strength: 2 }, timePosition: 2 },
      ];
      for (const t of [2, 2.5, 3]) {
        const replay = r8WhichToReplay(recs4, t);
        const drifts = replay.filter((r) => r.command === 'cam.drift');
        assert(
          drifts.length === 1 && drifts[0].timePosition === 2,
          `R8-2 组合 seek ${t}: reset 前 drift skip、reset 后 drift 恢复（只 timePosition=2）`,
        );
      }
    }
  });

  it('R8-3：reset 动画窗口内 apply 的 drift 被 skip（Coco 第三轮）', () => {
    // R8-3 形态（Coco 第三轮）：reset@1(duration=1, effective@2) → drift@1.5（reset 动画窗口内 apply）。
    // 真实 build 路径：非 blocking reset 不推进 cursor，但 drift 可来自后续段落（不同 timePosition）。
    // 正常播放：drift@1.5 apply → reset@2.0 clearModifiers（清 drift）→ seek 到 2.5 不应 replay drift。
    // R8-2 的 i <= boundaryIndex 漏了这个（drift@1.5 index > reset index → 不 skip）。
    // R8-3：用 timePosition < effectiveTime（drift@1.5 < 2 → skip）。
    {
      const recs5 = [
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 1.5 },
      ];
      for (const t of [2, 2.5, 3]) {
        const replay = r8WhichToReplay(recs5, t);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          `R8-3 seek ${t}: reset 动画窗口内的 drift 被 skip（reset clear 时已 apply，Coco 复现点）`,
        );
      }
      // seek 到 reset 动画中途（1.5）：reset 未完成（effectiveTime 2 > 1.5），drift 仍在
      {
        const replay = r8WhichToReplay(recs5, 1.5);
        assert(
          replay.some((r) => r.command === 'cam.drift' && r.timePosition === 1.5),
          'R8-3 seek 1.5（reset 动画中途）: 窗口内 drift 仍在（reset 未完成）',
        );
      }
    }
    // R8-3 组合：reset@1(dur=1) → drift@1.5 → drift@2.5（窗口内 drift skip，窗口后 drift 恢复）
    {
      const recs6 = [
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 1.5 },
        { command: 'cam.drift', params: { strength: 2 }, timePosition: 2.5 },
      ];
      for (const t of [2.5, 3]) {
        const replay = r8WhichToReplay(recs6, t);
        const drifts = replay.filter((r) => r.command === 'cam.drift');
        assert(
          drifts.length === 1 && drifts[0].timePosition === 2.5,
          `R8-3 组合 seek ${t}: 窗口内 drift skip、窗口后 drift 恢复（只 timePosition=2.5）`,
        );
      }
    }
  });

  it('R9-High：多 reset 重叠取最大 effective clear time（Coco 第四轮）', () => {
    // Coco 第四轮复现：reset@1(dur=10, effective@11) + reset@5(dur=1, effective@6) + drift@7，seek@12。
    // 正常播放：reset@5 在 6.0 clear（清 drift@5 之前），reset@1 在 11.0 clear（清 drift@7）。seek@12 应
    // 用最近触发的 clear（effectiveTime=11）判定 → drift@7（7<11）被 skip。原顺序赋值让 reset@5 覆盖成
    // effectiveTime=6 → drift@7（7>6）不被 skip → 错误重放。
    {
      const recs7 = [
        { command: 'cam.reset', params: { duration: 10 }, timePosition: 1, isClearBoundary: true, resetDuration: 10 },
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 5, isClearBoundary: true, resetDuration: 1 },
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 7 },
      ];
      for (const t of [11, 12, 15]) {
        const replay = r8WhichToReplay(recs7, t);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          `R9-High seek ${t}: 多 reset 重叠取最大 effective（11），drift@7(7<11) 被 skip（不复活，Coco 复现点）`,
        );
      }
      // seek 到两个 reset 都已生效但 drift@7 之前（如 10）：reset@1 effective@11 > 10 未生效，
      // reset@5 effective@6 ≤ 10 生效 → lastClearBoundaryEffectiveTime=6 → drift@7(7>6) 不 skip（drift 仍在）
      {
        const replay = r8WhichToReplay(recs7, 10);
        assert(
          replay.some((r) => r.command === 'cam.drift' && r.timePosition === 7),
          'R9-High seek 10（仅 reset@5 生效）: drift@7 仍在（reset@1 effective@11 未到，7>6）',
        );
      }
      // drift@12（在最大 effective 11 之后）应恢复——证明取 max 不误删 reset 之后的 modifier
      {
        const recs8 = [
          { command: 'cam.reset', params: { duration: 10 }, timePosition: 1, isClearBoundary: true, resetDuration: 10 },
          { command: 'cam.reset', params: { duration: 1 }, timePosition: 5, isClearBoundary: true, resetDuration: 1 },
          { command: 'cam.drift', params: { strength: 2 }, timePosition: 12 },
        ];
        const replay = r8WhichToReplay(recs8, 15);
        const drifts = replay.filter((r) => r.command === 'cam.drift');
        assert(
          drifts.length === 1 && drifts[0].timePosition === 12,
          'R9-High seek 15: reset 后 drift@12(12>11) 恢复（取 max 不误删 reset 之后的 modifier）',
        );
      }
    }
  });

  it('R10：resetDuration=0 同 timestamp 时按创建序 skip（Coco 第五轮）', () => {
    // R10-High（Coco 第五轮）：reset 默认零时长（resetDuration=0）时同 timestamp 复活。
    // 真实 build 路径：非 blocking drift + 默认 cam.reset 共享 cursor → drift@1 + reset@1(resetDuration=0)。
    // effectiveTime = 1 + 0 = 1 === timePosition。R8-3 的 `timePosition < effectiveTime`（1<1 false）放过 drift
    // → seek 到 1+ 后 drift 复活。正常播放：drift 的 segmentTl.call 先触发（push 在前）→ reset clearModifiers 清它。
    // R10：加创建序维度——同 timestamp（timePosition === effectiveTime）时 i <= boundaryIndex skip（drift 索引 < reset 索引）。
    {
      const recs9 = [
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 1 },
        { command: 'cam.reset', params: {}, timePosition: 1, isClearBoundary: true, resetDuration: 0 },
      ];
      // seek 到 reset 之后（1, 1.5, 2）：drift 必须被 skip（resetDuration=0 同 timestamp，创建序判定）
      for (const t of [1, 1.5, 2]) {
        const replay = r8WhichToReplay(recs9, t);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          `R10 seek ${t}: resetDuration=0 同 timestamp 的 reset 前 drift 被 skip（不复活，Coco 复现点）`,
        );
      }
      // seek 到 reset 之前（0.5）：drift 仍在（boundary 未生效）
      {
        const replay = r8WhichToReplay(recs9, 0.5);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          'R10 seek 0.5（reset 前）：drift timePosition=1 > 0.5 不在 currentTime 内（不 replay，正确）',
        );
      }
    }
    // R10 组合：drift@1 + reset@1(resetDuration=0) + drift@1（reset 之后同 timestamp push）
    // reset 之前 drift skip，reset 之后同 timestamp drift 不 skip（i > boundaryIndex）
    {
      const recs10 = [
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 1 },
        { command: 'cam.reset', params: {}, timePosition: 1, isClearBoundary: true, resetDuration: 0 },
        { command: 'cam.drift', params: { strength: 2 }, timePosition: 1 },
      ];
      for (const t of [1, 1.5, 2]) {
        const replay = r8WhichToReplay(recs10, t);
        const drifts = replay.filter((r) => r.command === 'cam.drift');
        assert(
          drifts.length === 1 && drifts[0].params.strength === 2,
          `R10 组合 seek ${t}: reset 前 drift skip、reset 后同 timestamp drift(strength=2) 恢复`,
        );
      }
    }
  });

  it('R11：>>> overlap 下 record.sequence 是必需的（ordered 索引会错误复活）', () => {
    // R11-High（Coco 第六轮）：>>> overlap 时不同 timePosition 但同 effectiveTime 的 modifier 复活。
    // p1 child timeline（>>> 让 p2 从 1 开始）：drift@global2.0（p1，push 序 0）。
    // p2 从 1 开始：reset@1 duration=1（push 序 1，effective@2.0）。
    // 正常播放：p1 child 的 drift@2 segmentTl.call 先触发（p1 先 add，overlap 时同 tick 内 p1 call 在前）
    // → p2 reset clearModifiers@2 清掉 drift。seek 到 t>=2 应不 replay drift。
    // **R10/R8 的 ordered 索引在此失效**：排序后 reset@1(index 0) 在 drift@2(index 1) 前，drift index 1 >
    // boundaryIndex 0 → 不 skip → 复活。只有 record.sequence（push 序：drift 0 < reset 1）能正确 skip。
    {
      const recs11 = [
        { command: 'cam.drift', params: { strength: 1 }, timePosition: 2, sequence: 0 },        // p1 先 push
        { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1, sequence: 1 }, // p2 后 push
      ];
      // seek 到 effectiveTime 及之后（2, 2.5, 3）：drift 必须被 skip（sequence 0 <= reset sequence 1）
      for (const t of [2, 2.5, 3]) {
        const replay = r8WhichToReplay(recs11, t);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          `R11 seek ${t}: >>> overlap 同 effectiveTime、drift sequence(0) <= reset sequence(1) → skip（不复活，Coco 复现点）`,
        );
      }
      // seek 到 reset 动画中途（1.5）：reset 未完成（effectiveTime 2 > 1.5），drift timePosition 2 > 1.5 不在 currentTime 内
      {
        const replay = r8WhichToReplay(recs11, 1.5);
        assert(
          !replay.some((r) => r.command === 'cam.drift'),
          'R11 seek 1.5（reset 动画中途）: drift@2 > 1.5 不在 currentTime 内（不 replay）',
        );
      }
      // 组合：drift@2(p1, seq0) + reset@1(dur1, seq1) + drift@2.5(p2, seq2)
      // p1 drift skip（seq0<=1），p2 drift@2.5 恢复（timePosition 2.5 > effectiveTime 2）
      {
        const recs12 = [
          { command: 'cam.drift', params: { strength: 1 }, timePosition: 2, sequence: 0 },
          { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1, sequence: 1 },
          { command: 'cam.drift', params: { strength: 2 }, timePosition: 2.5, sequence: 2 },
        ];
        for (const t of [2.5, 3]) {
          const replay = r8WhichToReplay(recs12, t);
          const drifts = replay.filter((r) => r.command === 'cam.drift');
          assert(
            drifts.length === 1 && drifts[0].params.strength === 2 && drifts[0].timePosition === 2.5,
            `R11 组合 seek ${t}: p1 drift skip（seq）、p2 drift@2.5 恢复`,
          );
        }
      }
      // 验证 ordered 索引在此场景错误（回退路径会复活 drift）——无 sequence 时
      {
        const recsNoSeq = [
          { command: 'cam.drift', params: { strength: 1 }, timePosition: 2 },        // 无 sequence → 回退 ordered index
          { command: 'cam.reset', params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 }, // 无 sequence
        ];
        const replay = r8WhichToReplay(recsNoSeq, 2.5);
        // 无 sequence 时回退 ordered 索引：drift ordered index 1 > boundaryIndex 0 → 不 skip（错误复活）
        // 这证明 sequence 字段是必需的——ordered 索引在 >>> overlap 下错误。
        assert(
          replay.some((r) => r.command === 'cam.drift'),
          'R11 验证: 无 sequence 时 ordered 索引错误复活 drift（证明 sequence 字段必需）',
        );
      }
    }
  });
});
