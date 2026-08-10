// 样式回放与 Graphics 清理回归 [6]-[12]（主题一：织网 S10 / playback 渐拆第 2 批）。
//
// 迁自 final-playback-test.ts 的 testResolvePauseDuration([6]) / testGraphicsInstantCleanup([7]) /
// testRealKineticTextGraphicsLayer([8]) / testReplayStylesSeekBack([9]) / testEndedReplayStyleReset([10]) /
// testPreHoldStyleBaseline([11]) / testDisplayAssemblerBaseline([11b]) /
// testBlockStyleBaselineRecapture([12])——共 92 条断言。
//
// 迁移保真策略：断言经 assert() shim 1:1 机械保留（expect(cond, message).toBe(true)，
// 原「实际 …」诊断文本作为 vitest 自定义消息完整保留——已探针验证消息可见）。本批 it() 粒度 =
// 原 testXxx 函数级（每条 assert 失败仍独立定位到消息行）；[9]-[12] 各小节 (1)-(6) 的后续细分
// 属可选精化，tripwire 计量的是断言数不是 it 数，细分不触碰账目。
//
// 单例触点与 teardown：
//   - [6] 写 layout.globalMarkers(var.delay_val) → 本 describe afterEach layout.reset(true)
//     （原脚本从不删除该变量，迁出后不留种——有意变更，singleFork 顺序无关化）
//   - [7][8] 调真实 PlaybackController.clearInstantEffects / effectManager.apply——apply 只画
//     target 不改注册表，无 teardown 需求
//   - [9]-[12] 纯局部 fake char / 真实 KineticChar 构造（setup.ts ticker stub 供构造通过）
//
// 诚实边界（原脚本注释保留）：fake char 测的是 replayStyles/playSegment 的重放语义而非
// KineticChar.resetStyle 内部正确性（SA-27：真实对象路径由 [11b]/[12] 的真实 KineticChar 补、
// 浏览器 e2e 兜底）；合成字体度量下几何不真实、style/seek 语义真实（setup.ts §1.4）。

import { describe, it, expect, afterEach } from 'vitest';
import { TextStyle } from 'pixi.js';
import { PlaybackController } from '@kmd/core/player/PlaybackController';
import { EffectProcessor } from '@kmd/core/effects/EffectProcessor';
import { effectManager } from '@kmd/core/effects/EffectManager';
import { styleManager } from '@kmd/core/effects/StyleManager';
import { layout } from '@kmd/core/layout/LayoutEngine';
import { KineticText } from '@kmd/core/KineticText';
import { KineticChar } from '@kmd/core/KineticChar';
import { DisplayAssembler } from '@kmd/core/render/text/DisplayAssembler';
import type { Segment } from '@kmd/core/state/Segment';
import type { LayoutGlyphPlan } from '@kmd/core/layout/LayoutPlanner';
import { G, approxEq, makeFakeState, build, fillHex } from './playback-harness';

/** 断言桥：1:1 保留原脚本 assert(cond, msg) 的诊断文本（vitest 自定义消息）。 */
function assert(cond: boolean, message: string): void {
  expect(Boolean(cond), message).toBe(true);
}

describe('[6] resolvePauseDuration 变量解析（R9-Medium）', () => {
  afterEach(() => layout.reset(true));

  it('数值透传 / 缺省回退 / var.* 解析 / 未注册回退 default', () => {
    // 纯数值透传
    assert(
      approxEq(EffectProcessor.resolvePauseDuration({ duration: 2 }, 0.5), 2),
      'resolvePauseDuration({duration:2}) = 2（纯数值）',
    );
    assert(
      approxEq(EffectProcessor.resolvePauseDuration({ d: 1.5 }, 0.5), 1.5),
      'resolvePauseDuration({d:1.5}) = 1.5（d 字段）',
    );
    assert(
      approxEq(EffectProcessor.resolvePauseDuration({ 0: 3 }, 0.5), 3),
      'resolvePauseDuration({0:3}) = 3（位置参数）',
    );
    assert(
      approxEq(EffectProcessor.resolvePauseDuration({}, 0.5), 0.5),
      'resolvePauseDuration({}) = defaultValue 0.5（缺省）',
    );
    // var.* 解析（R9-Medium 关键）——需先在 layout.globalMarkers 注册变量。
    // RuntimeValueResolver.resolveReference 读 layout.globalMarkers.get("var.X")。
    layout.globalMarkers.set('var.delay_val', { x: 1.5, y: 1.5 });
    const resolved = EffectProcessor.resolvePauseDuration({ 0: 'var.delay_val' }, 0.5);
    assert(
      approxEq(resolved, 1.5),
      `resolvePauseDuration({0:'var.delay_val'}) = 1.5（var 解析，R9-Medium 复现点）→ 实得 ${resolved}`,
    );
    // 未注册变量回退到 default（不是 NaN）
    const missing = EffectProcessor.resolvePauseDuration({ 0: 'var.nonexistent' }, 0.5);
    assert(
      approxEq(missing, 0.5),
      `resolvePauseDuration({0:'var.nonexistent'}) = 0.5（未注册回退 default，非 NaN）→ 实得 ${missing}`,
    );
  });
});

describe('[7] Graphics instant 特效 seek 回退清理（R12-High）', () => {
  it('graphicsLayer cleanup 走 g.clear()；filter 通道独立不受影响', () => {
    // fake Graphics：clear() 记录调用次数
    let clearCount = 0;
    const fakeG = { clear: () => { clearCount++; } };
    // fake target：getGraphicsLayer(name) 返回 fakeG（模拟 TokenWrapper/KineticText 的层）
    const fakeTarget = {
      getGraphicsLayer: (_name: string) => fakeG,
      filters: null as any,
    };
    // 模拟 registerInstantEffects 对 void result 推 graphicsLayer cleanup（与真实逻辑一致）
    const state = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [
        { target: fakeTarget, filterInstance: undefined as any, graphicsLayer: 'box' },
      ],
      onTimeUpdate: () => {},
    } as any;
    clearCount = 0;
    PlaybackController.clearInstantEffects(state);
    assert(
      clearCount === 1,
      `R12: clearInstantEffects 对 graphicsLayer cleanup 调 g.clear()（count=${clearCount}）`,
    );
    assert(
      state.activeInstantCleanups.length === 0,
      'R12: clearInstantEffects 清空 activeInstantCleanups',
    );
    // filter cleanup 不受 graphicsLayer 路径影响——filterInstance 通道仍正常（void filterInstance 不走 filter 分支）
    {
      let clearCount2 = 0;
      const fakeG2 = { clear: () => { clearCount2++; } };
      const fakeTarget2 = { getGraphicsLayer: () => fakeG2, filters: null as any };
      const state2 = {
        isAutoPlaying: false,
        activeBehaviorCleanups: [],
        activeInstantCleanups: [
          { target: fakeTarget2, filterInstance: undefined as any, graphicsLayer: 'border' },
        ],
        onTimeUpdate: () => {},
      } as any;
      clearCount2 = 0;
      PlaybackController.clearInstantEffects(state2);
      assert(
        clearCount2 === 1,
        "R12: border 层也清（graphicsLayer='border' → g.clear()）",
      );
    }
    // 无 graphicsLayer 的 cleanup（纯 filter）不受影响——不调 getGraphicsLayer
    {
      let layerAccessed = false;
      const fakeTarget3 = { getGraphicsLayer: () => { layerAccessed = true; return { clear() {} }; }, filters: null as any };
      const state3 = {
        isAutoPlaying: false,
        activeBehaviorCleanups: [],
        activeInstantCleanups: [
          // filter cleanup：filterInstance 是 fake filter 对象，无 graphicsLayer → 不走 Graphics 路径
          { target: fakeTarget3, filterInstance: { destroy() {} } as any },
        ],
        onTimeUpdate: () => {},
      } as any;
      PlaybackController.clearInstantEffects(state3);
      assert(
        !layerAccessed,
        'R12: filter cleanup（无 graphicsLayer）不调 getGraphicsLayer（filter 通道独立）',
      );
    }
  });
});

describe('[8] bg/border:block 真实 KineticText + 真实 Graphics（R12 阻塞修复）', () => {
  it('真实 apply 画到 Graphics 层 + 坐标补偿 + 真实 clearInstantEffects 清层', () => {
    // 最小 char stub：getContentBounds 读 c.width/height/layoutX/layoutY/anchor.x/y。
    // anchor 设 0.5（与 KineticChar 默认中心锚点一致），使 minX = layoutX - width*0.5。
    function makeCharStub(layoutX: number, layoutY: number, width: number, height: number) {
      return {
        width, height, layoutX, layoutY,
        anchor: { x: 0.5, y: 0.5 },
        // KineticChar 字段，防其他读取报错
        inFlow: true,
      } as any;
    }

    // 构造真实 KineticText（externalMarkers 空.Map，BlockOptions 全可选）。不调 init/build——
    // 直接注入 _displayAssembly.chars 控 bounds，绕开字体/布局 headless 不稳。
    function makeKineticText(chars: any[]): KineticText {
      const kt = new KineticText({ externalMarkers: new Map() as any });
      kt._displayAssembly = { tokens: [], chars, executionItems: [] } as any;
      return kt;
    }

    // 读取 Graphics 第一条绘制指令的矩形坐标（rect/roundRect 的 path[0].data = [x, y, w, h, ...]）。
    // Graphics v8：context.instructions[i].data.path.instructions[0].{action, data}。
    function firstRectCoords(g: any): { x: number; y: number; w: number; h: number } | null {
      const ctxInsts = g?.context?.instructions;
      if (!Array.isArray(ctxInsts) || ctxInsts.length === 0) return null;
      const pathInsts = ctxInsts[0]?.data?.path?.instructions;
      if (!Array.isArray(pathInsts) || pathInsts.length === 0) return null;
      const d = pathInsts[0]?.data;
      if (!Array.isArray(d) || d.length < 4) return null;
      return { x: d[0], y: d[1], w: d[2], h: d[3] };
    }

    // (1) 真实能力：apply bg 真画到 KineticText 的 Graphics 层。
    {
      const kt = makeKineticText([
        makeCharStub(50, 30, 40, 50),
        makeCharStub(90, 30, 40, 50),
      ]);
      const bounds = kt.getContentBounds();
      // bounds.x = min(50-20, 90-20) = 30；确认 bounds.x 非零（验证 stub 正确）
      assert(approxEq(bounds.x, 30), `KineticText.getContentBounds().x 非零（center 模拟，x=${bounds.x}）`);

      const result = effectManager.apply(kt, 'box', { color: 0x333333, alpha: 1, padding: 5, radius: 4 }, true);
      // box 返回 void（画 Graphics 非 filter）
      assert(result === undefined, 'R12: box 对真实 KineticText 返回 void（Graphics 非 filter）');
      const g = kt.getGraphicsLayer('box');
      const coords = firstRectCoords(g);
      assert(coords !== null, "R12: box 真画到 KineticText.getGraphicsLayer('box')（instructions 非空）");
      // 坐标补偿：x = bounds.x - padding = 30 - 5 = 25（旧画 -5 会偏左 30px）
      assert(
        coords !== null && approxEq(coords.x, bounds.x - 5),
        `R12: box 坐标补偿 x=bounds.x-padding=${bounds.x - 5}（实际 ${coords?.x}），非 -padding`,
      );
      assert(
        coords !== null && approxEq(coords.y, bounds.y - 5),
        `R12: box 坐标补偿 y=bounds.y-padding=${bounds.y - 5}（实际 ${coords?.y}）`,
      );
    }

    // (2) border 同理（rect + stroke，非 fill）。
    {
      const kt = makeKineticText([makeCharStub(100, 80, 40, 50)]);
      const bounds = kt.getContentBounds();
      const result = effectManager.apply(kt, 'border', { color: 0xff0000, width: 2, padding: 5 }, true);
      assert(result === undefined, 'R12: border 对真实 KineticText 返回 void');
      const g = kt.getGraphicsLayer('border');
      const coords = firstRectCoords(g);
      assert(coords !== null, "R12: border 真画到 KineticText.getGraphicsLayer('border')");
      assert(
        coords !== null && approxEq(coords.x, bounds.x - 5),
        `R12: border 坐标补偿 x=bounds.x-padding=${bounds.x - 5}（实际 ${coords?.x}）`,
      );
    }

    // (3) align:center 显著非零 bounds.x（模拟居中段落：char layoutX 被 correction 推右）。
    //     验证坐标补偿在 center 模式生效——旧画法 -padding 会偏在内容左侧 bounds.x+padding 像素。
    {
      const kt = makeKineticText([makeCharStub(300, 30, 40, 50)]); // bounds.x = 300-20 = 280
      const bounds = kt.getContentBounds();
      assert(bounds.x > 250, `center 模拟 bounds.x 显著非零（x=${bounds.x}）`);
      effectManager.apply(kt, 'box', { padding: 5, radius: 4 }, true);
      const g = kt.getGraphicsLayer('box');
      const coords = firstRectCoords(g);
      assert(
        coords !== null && coords.x > 250,
        `R12: center 模式 box 画在 bounds.x 侧（x=${coords?.x}），旧 -padding 画法会偏到 -5（此断言锁定补偿不回退）`,
      );
      assert(
        coords !== null && approxEq(coords.x, bounds.x - 5),
        `R12: center 模式 box x = bounds.x - padding = ${bounds.x - 5}（实际 ${coords?.x}）`,
      );
    }

    // (4) 真实 seek-replay 链路：registerInstantEffects 对真实 KineticText void result 登记 graphicsLayer
    //     cleanup，clearInstantEffects 清该层。registerInstantEffects 是 private，但其登记逻辑与
    //     SegmentBuilder block-instant 路径同源（守卫 typeof getGraphicsLayer === "function"）——
    //     此处用真实 effectManager.apply 复现登记 + 真实 PlaybackController.clearInstantEffects 清理，
    //     覆盖之前 fake target 跳过的「真实 KineticText.getGraphicsLayer 存在」守卫。
    {
      const kt = makeKineticText([makeCharStub(60, 40, 40, 50)]);
      const meta = effectManager.getMetadata('box');
      assert(meta?.mutexGroup === 'box', "R12: box meta.mutexGroup = 'box'（graphicsLayer 层名源）");
      // 真实 apply（与 registerInstantEffects 内 effectManager.apply 同源）
      const result = effectManager.apply(kt, 'box', { padding: 5, radius: 4 }, true);
      // 复现 registerInstantEffects 的 void-result 登记分支（守卫对真实 KineticText 现在为 true）
      const state = {
        isAutoPlaying: false,
        activeBehaviorCleanups: [],
        activeInstantCleanups: [] as any[],
        onTimeUpdate: () => {},
      } as any;
      if (!result && meta?.mutexGroup && typeof (kt as any).getGraphicsLayer === 'function') {
        state.activeInstantCleanups.push({
          target: kt,
          filterInstance: undefined as any,
          graphicsLayer: meta.mutexGroup,
        });
      }
      assert(
        state.activeInstantCleanups.length === 1,
        'R12: 真实 KineticText 有 getGraphicsLayer → void-result graphicsLayer cleanup 登记成功（守卫为 true）',
      );
      // 清理前 Graphics 有指令
      const g = kt.getGraphicsLayer('box');
      assert(firstRectCoords(g) !== null, 'R12: 清理前 box Graphics 有绘制指令');
      // 真实 clearInstantEffects
      PlaybackController.clearInstantEffects(state);
      assert(
        firstRectCoords(g) === null,
        'R12: clearInstantEffects 对真实 KineticText 清 box 层（g.clear() → instructions 空）',
      );
      assert(state.activeInstantCleanups.length === 0, 'R12: clearInstantEffects 清空 activeInstantCleanups');
    }
  });
});

describe('[9] replayStyles seek 回退清 style（R13-High / SA-28）', () => {
  /**
   * 与 KineticChar 的 style/resetStyle 契约同构的 fake：构造快照 base fill，resetStyle 写回，
   * styleManager.apply 经真实 fn 写 style.fill（如 red 写 "#ff4d4f"）。replayStyles 只读/写这两者。
   */
  function makeFakeChar(baseFill: string): { style: { fill: string }; resetStyle: () => void } {
    const style = { fill: baseFill };
    const snapshot = baseFill;
    return {
      style,
      resetStyle: () => { style.fill = snapshot; },
    };
  }

  /** 真实 timeline（含占位 tween 使 duration>0）+ 单条 red StyleRecord@Ns 的 segment。 */
  function makeStyleSegment(fakeChar: any, recordAt: number, duration = 2): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration }, 0);
    return {
      timeline: tl,
      duration,
      behaviors: [],
      styleRecords: [{ char: fakeChar, styleName: 'red', params: {}, timePosition: recordAt }],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: '' },
      exitCheckpoint: { time: duration, label: '' },
    } as unknown as Segment;
  }

  it('seek 跨生效点再回退必须清回 base；停留/往返/多 char 各自语义', () => {
    // (1) 核心复现点：seek 跨过生效点再回退——字符必须回到 base。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 1);
      const { state } = makeFakeState(false);
      assert(
        ch.style.fill === '#000000',
        'base fill = #000000（reset 目标）',
      );
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        ch.style.fill === '#ff4d4f',
        `R13 seek 1.5s（red 已生效）fill = #ff4d4f（实际 ${ch.style.fill}）`,
      );
      // 关键：seek 回退到 red 生效之前。旧逻辑不 reset（无 record 满足 ≤0.5）→ 残留红色。
      PlaybackController.seekToTime(seg, 0.5, state);
      assert(
        ch.style.fill === '#000000',
        `R13 seek 回退 0.5s（red 之前）fill 回 base #000000（实际 ${ch.style.fill}，旧逻辑残留 #ff4d4f）`,
      );
    }

    // (2) seek 跨过生效点后停在那：字符保持生效样式（确认 reset 不会误清当前生效样式）。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 1);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        ch.style.fill === '#ff4d4f',
        'R13 seek 1.5s 后停留：red 仍生效（reset→base 后 reapply@1.5 重上 red）',
      );
    }

    // (3) 从头 seek 到生效点之前：base（向后兼容——从未应用过 red）。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 1);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 0.3, state);
      assert(
        ch.style.fill === '#000000',
        'R13 从头 seek 0.3s（red 之前）fill = base（无样式应用过）',
      );
    }

    // (4) 多次往返 seek 幂等：跨生效点 → 回退 → 再跨，结果一致。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 1);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state); // 红
      PlaybackController.seekToTime(seg, 0.5, state); // 回退 base
      PlaybackController.seekToTime(seg, 0.5, state); // 再停 0.5（幂等）
      assert(ch.style.fill === '#000000', 'R13 回退后重复 seek 0.5 幂等（base）');
      PlaybackController.seekToTime(seg, 1.5, state); // 再跨
      assert(ch.style.fill === '#ff4d4f', 'R13 再 seek 1.5（red 重上，幂等）');
      PlaybackController.seekToTime(seg, 0.5, state); // 再回退
      assert(ch.style.fill === '#000000', 'R13 再回退 0.5（reset 清回 base）');
    }

    // (5) 两个 char 各自的 red 在不同时间生效：seek 回退只清各自生效过的，不影响另一个在当前时间仍生效的。
    {
      const ch1 = makeFakeChar('#000000');
      const ch2 = makeFakeChar('#000000');
      const tl = G.timeline();
      tl.to({ p: 0 }, { p: 1, duration: 3 }, 0);
      const seg = {
        timeline: tl,
        duration: 3,
        behaviors: [],
        styleRecords: [
          { char: ch1, styleName: 'red', params: {}, timePosition: 1 },
          { char: ch2, styleName: 'red', params: {}, timePosition: 2 },
        ],
        instantEffects: [],
        entranceFilters: [],
        stageModifierRecords: [],
        stageTweenRecords: [],
        paragraphs: [],
        entryCheckpoint: { time: 0, label: '' },
        exitCheckpoint: { time: 3, label: '' },
      } as unknown as Segment;
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 2.5, state);
      assert(ch1.style.fill === '#ff4d4f', 'R13 多 char seek 2.5：ch1 red 生效');
      assert(ch2.style.fill === '#ff4d4f', 'R13 多 char seek 2.5：ch2 red 生效');
      // 回退到 ch1 生效后、ch2 生效前（1.5）：ch1 保持 red，ch2 应回 base。
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        ch1.style.fill === '#ff4d4f',
        `R13 seek 1.5（ch1 red 仍生效）：ch1 fill #ff4d4f（实际 ${ch1.style.fill}）`,
      );
      assert(
        ch2.style.fill === '#000000',
        `R13 seek 1.5（ch2 red 之前）：ch2 回 base #000000（实际 ${ch2.style.fill}，旧逻辑残留红）`,
      );
    }
  });
});

describe('[10] ended 重播清 style（R14-High / SA-29）', () => {
  // 与 [9] 同构的 fake char（resetStyle/apply 经真实 styleManager 写 fill）。
  function makeFakeChar(baseFill: string): { style: { fill: string }; resetStyle: () => void } {
    const style = { fill: baseFill };
    const snapshot = baseFill;
    return { style, resetStyle: () => { style.fill = snapshot; } };
  }

  function makeStyleSegment(fakeChar: any, recordAt: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration: 2 }, 0);
    return {
      timeline: tl,
      duration: 2,
      behaviors: [],
      styleRecords: [{ char: fakeChar, styleName: 'red', params: {}, timePosition: recordAt }],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: '' },
      exitCheckpoint: { time: 2, label: '' },
    } as unknown as Segment;
  }

  it('ended 重播 = 回到时间起点：reset 全部 styleRecords，只重放 timePosition<=0', () => {
    // (1) 核心复现点：seek 到 red 生效 → ended → playSegment 重播 → 字符回 base。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 1);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(ch.style.fill === '#ff4d4f', 'R14 seek 1.5s（red 生效）fill = #ff4d4f');
      // 推到结尾（ended）。
      PlaybackController.seekToTime(seg, 2, state);
      assert(seg.timeline.progress() >= 1, 'R14 seek 2.0s 后 progress>=1（ended）');
      assert(ch.style.fill === '#ff4d4f', 'R14 ended 时 red 仍生效（#ff4d4f）');
      // 点播放重播 → playSegment 走 ended 分支。旧逻辑时间线回 0 但 fill 残留红。
      PlaybackController.playSegment(seg, state);
      assert(
        ch.style.fill === '#000000',
        `R14 重播后 fill 回 base #000000（实际 ${ch.style.fill}，旧逻辑残留 #ff4d4f）`,
      );
      assert(seg.timeline.time() === 0, 'R14 重播后 tl.time()=0（时间起点）');
      assert(state.isAutoPlaying === true, 'R14 重播后 isAutoPlaying=true（开始播放）');
    }

    // (2) 多次 ended 重播幂等：第二次重播也不残留。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 1);
      const { state } = makeFakeState(false);
      // 第一轮：生效 → ended → 重播（回 base）。
      PlaybackController.seekToTime(seg, 1.5, state);
      PlaybackController.seekToTime(seg, 2, state);
      PlaybackController.playSegment(seg, state);
      assert(ch.style.fill === '#000000', 'R14 第一轮重播后 base');
      // 第二轮：再次生效 → ended → 重播。
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(ch.style.fill === '#ff4d4f', 'R14 第二轮 seek 1.5 red 生效');
      PlaybackController.seekToTime(seg, 2, state);
      PlaybackController.playSegment(seg, state);
      assert(ch.style.fill === '#000000', 'R14 第二轮重播后 base（幂等）');
    }

    // (3) ended 重播不误清 timePosition<=0 的样式（回到起点应保留起点生效的样式）。
    //     red@0（时间起点即生效）→ 重播后仍应是 red（replayStyles(0) 重放 timePosition<=0）。
    {
      const ch = makeFakeChar('#000000');
      const seg = makeStyleSegment(ch, 0); // red 在 0s 生效
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 0, state);
      assert(ch.style.fill === '#ff4d4f', 'R14 red@0：seek 0 时 red 生效（timePosition<=0）');
      PlaybackController.seekToTime(seg, 2, state);
      assert(ch.style.fill === '#ff4d4f', 'R14 red@0：ended 时 red 仍生效');
      PlaybackController.playSegment(seg, state);
      assert(
        ch.style.fill === '#ff4d4f',
        `R14 red@0 重播后 red 仍生效（实际 ${ch.style.fill}，replayStyles(0) 应重放 timePosition<=0）`,
      );
    }

    // (4) 多 char：重播后各自回到"时间起点应有的状态"（无一残留）。
    {
      const ch1 = makeFakeChar('#000000');
      const ch2 = makeFakeChar('#000000');
      const tl = G.timeline();
      tl.to({ p: 0 }, { p: 1, duration: 3 }, 0);
      const seg = {
        timeline: tl, duration: 3, behaviors: [],
        styleRecords: [
          { char: ch1, styleName: 'red', params: {}, timePosition: 0 }, // 起点生效，重播后应保留
          { char: ch2, styleName: 'red', params: {}, timePosition: 2 }, // 中途生效，重播后应回 base
        ],
        instantEffects: [], entranceFilters: [], stageModifierRecords: [], stageTweenRecords: [],
        paragraphs: [], entryCheckpoint: { time: 0, label: '' }, exitCheckpoint: { time: 3, label: '' },
      } as unknown as Segment;
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 2.5, state);
      assert(ch1.style.fill === '#ff4d4f', 'R14 多 char seek 2.5：ch1 red 生效');
      assert(ch2.style.fill === '#ff4d4f', 'R14 多 char seek 2.5：ch2 red 生效');
      PlaybackController.seekToTime(seg, 3, state);
      PlaybackController.playSegment(seg, state);
      assert(
        ch1.style.fill === '#ff4d4f',
        `R14 多 char 重播：ch1 red@0 保留（实际 ${ch1.style.fill}）`,
      );
      assert(
        ch2.style.fill === '#000000',
        `R14 多 char 重播：ch2 red@2 回 base（实际 ${ch2.style.fill}，旧逻辑残留红）`,
      );
    }
  });
});

describe('[11] pre-hold 样式 baseline 错位 + record 去重（R15-High / SA-30）', () => {
  /**
   * 与 KineticChar 新 baseline 语义同构的 fake char：baseStyleSnapshot 在构造时从传入 style
   * 捕获（= 构建期烘焙态，含 pre-hold 样式），resetStyle 写回该快照。styleManager.apply 经真实
   * fn 写 style.fill / style.fontSize（red 写 "#ff4d4f"，big 写 fontSize*1.5）。
   */
  function makeFakeChar(bakedStyle: { fill: string; fontSize: number; fontWeight: string }) {
    const style = { fill: bakedStyle.fill, fontSize: bakedStyle.fontSize, fontWeight: bakedStyle.fontWeight };
    const snapshot = { fill: bakedStyle.fill, fontSize: bakedStyle.fontSize, fontWeight: bakedStyle.fontWeight };
    return {
      style,
      resetStyle: () => {
        style.fill = snapshot.fill; style.fontSize = snapshot.fontSize; style.fontWeight = snapshot.fontWeight;
      },
    };
  }

  /** 构建期烘焙：用真实 styleManager.apply(force=false) 把 pre-hold 样式烘到 bakedStyle。 */
  function bakeStyle(rawFill: string, rawSize: number, preHoldStyles: string[]) {
    const baked = { fill: rawFill, fontSize: rawSize, fontWeight: 'normal' };
    // 用真实 styleManager 烘焙（与 LayoutPlanner.applyInitialStylesToStyle 同路径，force=false）
    for (const name of preHoldStyles) {
      styleManager.apply(baked as any, name, {}, false);
    }
    return baked;
  }

  function makeSegment(fakeChar: any, styleRecords: any[], duration: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration }, 0);
    return {
      timeline: tl,
      duration,
      behaviors: [],
      styleRecords,
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: '' },
      exitCheckpoint: { time: duration, label: '' },
    } as unknown as Segment;
  }

  it('baseline = 烘焙态；pre-hold 不进 record；相对样式不重复放大；post-hold 仍重放', () => {
    // (1) 核心复现：pre-hold red 烘到 baseline → seek 0 → resetStyle 回 baseline（红），不回原始 base。
    //     R15 后 pre-hold 样式不进 styleRecords → replayStyles(0) 只 reset（回 baseline=红）不重放。
    {
      const baked = bakeStyle('#000000', 24, ['red']); // 构建期烘焙 red → fill #ff4d4f
      const ch = makeFakeChar(baked); // baseline snapshot = 烘焙态（红）
      // R15 后：pre-hold 样式不在 styleRecords（site 1 删除）。styleRecords 为空。
      const seg = makeSegment(ch, [], 2);
      const { state } = makeFakeState(false);
      assert(ch.style.fill === '#ff4d4f', 'R15 构建期 red 烘到 baseline（fill #ff4d4f）');
      PlaybackController.seekToTime(seg, 0, state);
      assert(
        ch.style.fill === '#ff4d4f',
        `R15 seek 0：reset 回 baseline（红 #ff4d4f，不是原始 base #000000）（实际 ${ch.style.fill}）`,
      );
      // 自然播放推进到字符揭示后：无 record 重放，仍 baseline 红。
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        ch.style.fill === '#ff4d4f',
        `R15 seek 1.5（无 post-hold record）：仍 baseline 红（实际 ${ch.style.fill}）`,
      );
    }

    // (2) big 相对样式不重复放大：pre-hold big 烘到 baseline（24→36）→ seek 0 → reset 回 36，无 record
    //     重放 → 保持 36（不是 54）。旧逻辑：baseline=24，record 重放 big → 36；或 baseline=36 + record
    //     重放 big → 54。R15：baseline=36，无 record → 36。
    {
      const baked = bakeStyle('#000000', 24, ['big']); // 构建期 big → 36
      const ch = makeFakeChar(baked); // baseline snapshot = 36
      const seg = makeSegment(ch, [], 2);
      const { state } = makeFakeState(false);
      assert(ch.style.fontSize === 36, 'R15 构建期 big 烘到 baseline（fontSize 36）');
      PlaybackController.seekToTime(seg, 0, state);
      assert(
        ch.style.fontSize === 36,
        `R15 seek 0：big 不重复放大（保持 36，不是 54）（实际 ${ch.style.fontSize}）`,
      );
    }

    // (3) post-hold 动态样式仍重放：pre-hold red（baseline）+ post-hold bold record@1s → seek 1.5
    //     → reset 回 baseline(red) + 重放 bold record → red + bold。post-hold record 保留。
    {
      const baked = bakeStyle('#000000', 24, ['red']); // pre-hold red → baseline 红
      const ch = makeFakeChar(baked);
      // post-hold bold record（site 2/3 的 post-hold 部分，R15 保留）。
      const seg = makeSegment(ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        ch.style.fill === '#ff4d4f',
        `R15 pre+post：seek 1.5 baseline red 保留（实际 ${ch.style.fill}）`,
      );
      assert(
        ch.style.fontWeight === 'bold',
        `R15 pre+post：seek 1.5 post-hold bold record 重放（fontWeight bold）（实际 ${ch.style.fontWeight}）`,
      );
    }

    // (4) seek 回退到 post-hold 之前：pre-hold red（baseline）+ post-hold bold@1s → seek 0.5
    //     → reset 回 baseline(red)，bold record 不重放（timePosition>0.5）→ 仅 red。
    {
      const baked = bakeStyle('#000000', 24, ['red']);
      const ch = makeFakeChar(baked);
      const seg = makeSegment(ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 0.5, state);
      assert(
        ch.style.fill === '#ff4d4f',
        `R15 seek 0.5（bold 之前）：baseline red 保留（实际 ${ch.style.fill}）`,
      );
      assert(
        ch.style.fontWeight !== 'bold',
        `R15 seek 0.5：bold record 未重放（timePosition 1 > 0.5）（实际 fontWeight ${ch.style.fontWeight}）`,
      );
    }

    // (5) ended 重播：pre-hold red（baseline）+ post-hold bold@1s → 播完 ended → playSegment 重播
    //     → reset 回 baseline(red) + 重放 timePosition<=0（无）→ 仅 red（不残留 bold）。
    //     同时验证 R14 的 ended-replay 修复在 R15 baseline 语义下仍正确。
    {
      const baked = bakeStyle('#000000', 24, ['red']);
      const ch = makeFakeChar(baked);
      const seg = makeSegment(ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2);
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state); // red + bold
      assert(ch.style.fontWeight === 'bold', 'R15 ended 重播前：bold 生效');
      PlaybackController.seekToTime(seg, 2, state); // ended
      PlaybackController.playSegment(seg, state); // 重播
      assert(
        ch.style.fill === '#ff4d4f',
        `R15 ended 重播：baseline red 保留（实际 ${ch.style.fill}）`,
      );
      assert(
        ch.style.fontWeight !== 'bold',
        `R15 ended 重播：bold 不残留（实际 fontWeight ${ch.style.fontWeight}）`,
      );
    }

    // (6) 多 char 各自 baseline：char1 pre-hold red（baseline 红）、char2 无 pre-hold（baseline base）
    //     → seek 0 → char1 红、char2 base。pre-hold 不进 record → 互不干扰。
    {
      const baked1 = bakeStyle('#000000', 24, ['red']); // char1 烘 red
      const baked2 = bakeStyle('#000000', 24, []); // char2 无 pre-hold
      const ch1 = makeFakeChar(baked1);
      const ch2 = makeFakeChar(baked2);
      // 两个 char 的 pre-hold 都不进 record。char2 有 post-hold red@1s（测 char2 的 post-hold 不被
      // char1 baseline 干扰）。
      const seg = makeSegment(
        ch1,
        [{ char: ch2, styleName: 'red', params: {}, timePosition: 1 }],
        2,
      );
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 0, state);
      assert(
        ch1.style.fill === '#ff4d4f',
        `R15 多 char seek 0：ch1 baseline 红（实际 ${ch1.style.fill}）`,
      );
      assert(
        ch2.style.fill === '#000000',
        `R15 多 char seek 0：ch2 baseline base（实际 ${ch2.style.fill}）`,
      );
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        ch1.style.fill === '#ff4d4f',
        `R15 多 char seek 1.5：ch1 baseline 红保留（无 record 干扰）（实际 ${ch1.style.fill}）`,
      );
      assert(
        ch2.style.fill === '#ff4d4f',
        `R15 多 char seek 1.5：ch2 post-hold red record 重放（实际 ${ch2.style.fill}）`,
      );
    }
  });
});

describe('[11b] DisplayAssembler baseline = pre-hold 烘焙态（R15-High / SA-30，真实 KineticChar）', () => {
  it('materializeGlyphPlan 的 baseline 捕获 = glyphPlan.style（烘焙态），不被 raw base 覆盖', () => {
    // 构建期 pre-hold 烘焙后的 style（含 red）：模拟 LayoutPlanner 的 measurementStyle。
    const bakedStyle = new TextStyle({
      fill: '#ff4d4f', fontSize: 24, fontWeight: 'normal', fontStyle: 'normal',
      fontFamily: 'Arial', dropShadow: false, stroke: undefined,
    });
    // 原始 base snapshot（LayoutPlanner:70 在 applyInitialStylesToStyle 之前捕获）。
    const rawBaseSnapshot = {
      fill: '#000000', fontSize: 24, fontWeight: 'normal', fontStyle: 'normal',
      fontFamily: 'Arial', dropShadow: false, stroke: undefined,
    };

    const glyphPlan: LayoutGlyphPlan = {
      kind: 'char',
      text: 'A',
      style: bakedStyle,                 // ← pre-hold 烘焙态（红）
      baseStyleSnapshot: rawBaseSnapshot, // ← 原始 base（黑）
      effects: [],
      timingSugars: [],
      tokenIdx: 0,
      charIdx: 0,
      width: 10, height: 24, ascent: 18, descent: 6,
      stageInstructions: [],
      line: 0,
    };

    const result = DisplayAssembler.materializeGlyphPlan(glyphPlan);
    const char = result.char as KineticChar;

    // (1) baseline snapshot = 烘焙态（红），不是原始 base（黑）。
    assert(
      char.baseStyleSnapshot.fill === '#ff4d4f',
      `R15 baseline snapshot = 烘焙态红 #ff4d4f（实际 ${char.baseStyleSnapshot.fill}，旧逻辑覆盖成 #000000）`,
    );

    // (2) resetStyle() 回 baseline（红），不回原始 base（黑）。
    char.resetStyle();
    assert(
      (char.style as any).fill === '#ff4d4f',
      `R15 resetStyle 回 baseline 红 #ff4d4f（实际 ${(char.style as any).fill}，旧逻辑回 #000000）`,
    );

    // (3) fontSize baseline 同理（big 烘焙后 baseline=36，resetStyle 回 36 非 24）。
    const bakedBig = new TextStyle({
      fill: '#000000', fontSize: 36, fontWeight: 'normal', fontStyle: 'normal',
      fontFamily: 'Arial', dropShadow: false, stroke: undefined,
    });
    const glyphPlanBig: LayoutGlyphPlan = {
      kind: 'char', text: 'B', style: bakedBig,
      baseStyleSnapshot: { ...rawBaseSnapshot },
      effects: [], timingSugars: [], tokenIdx: 0, charIdx: 0,
      width: 12, height: 36, ascent: 27, descent: 9, stageInstructions: [], line: 0,
    };
    const charBig = DisplayAssembler.materializeGlyphPlan(glyphPlanBig).char as KineticChar;
    assert(
      charBig.baseStyleSnapshot.fontSize === 36,
      `R15 baseline snapshot.fontSize = 烘焙态 36（实际 ${charBig.baseStyleSnapshot.fontSize}，旧逻辑覆盖成 24）`,
    );
    charBig.resetStyle();
    assert(
      (charBig.style as any).fontSize === 36,
      `R15 resetStyle 回 baseline 36（实际 ${(charBig.style as any).fontSize}，旧逻辑回 24）`,
    );
  });
});

describe('[12] block/global 初始样式 recapture baseline（R16-High / SA-31，真实 KineticChar）', () => {
  function makeBaseTextStyle(fill = '#000000', fontSize = 24) {
    return new TextStyle({
      fill, fontSize, fontWeight: 'normal', fontStyle: 'normal',
      fontFamily: 'Arial', dropShadow: false, stroke: undefined,
    });
  }

  function makeSegmentWithRecord(char: KineticChar, records: any[], duration: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration }, 0);
    return {
      timeline: tl, duration, behaviors: [], styleRecords: records,
      instantEffects: [], entranceFilters: [], stageModifierRecords: [], stageTweenRecords: [],
      paragraphs: [], entryCheckpoint: { time: 0, label: '' }, exitCheckpoint: { time: duration, label: '' },
    } as unknown as Segment;
  }

  it('applyGroupEffects 同步写后 recapture baseline；动态 record 重放不丢 block 样式', () => {
    // (1) 核心复现：block red 同步应用后 recapture baseline → 动态 bold record seek 后 red+bold 都在。
    {
      const ch = new KineticChar('H', makeBaseTextStyle('#000000'));
      // 构造时 baseline = raw base（无 block 样式）——模拟 R15 后的 pre-hold 烘焙态（此处无 pre-hold）。
      assert(ch.baseStyleSnapshot.fill === '#000000', 'R16 构造时 baseline.fill = #000000（无 block 样式）');
      // 模拟 applyGroupEffects 同步应用 block red（force=true，applyStyleRecursively 逐字）。
      styleManager.apply((ch as any).style, 'red', {}, true);
      assert(
        (ch.style as any).fill === '#ff4d4f',
        'R16 block red 同步应用后 style.fill = #ff4d4f',
      );
      assert(
        ch.baseStyleSnapshot.fill === '#000000',
        `R16 recapture 前 baseline.fill 仍 #000000（block 样式没进 baseline，根因）（实际 ${ch.baseStyleSnapshot.fill}）`,
      );
      // R16 修复：recapture baseline = 当前 style（含 block red）。
      ch.recaptureBaseStyleSnapshot();
      assert(
        ch.baseStyleSnapshot.fill === '#ff4d4f',
        `R16 recapture 后 baseline.fill = #ff4d4f（block red 烘进 baseline）（实际 ${ch.baseStyleSnapshot.fill}）`,
      );
      // 动态 bold record（post-hold，timePosition=1）——模拟 f.hold(1s).bold 的 bold 走 record 路径。
      const seg = makeSegmentWithRecord(
        ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2,
      );
      const { state } = makeFakeState(false);
      // seek 1.5：reset 回 baseline(red) + 重放 bold record → red + bold（旧逻辑：reset 回 #000000 + bold → base+bold，red 丢）。
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        (ch.style as any).fill === '#ff4d4f',
        `R16 seek 1.5：block red baseline 保留（实际 ${(ch.style as any).fill}，旧逻辑丢成 #000000）`,
      );
      assert(
        (ch.style as any).fontWeight === 'bold',
        `R16 seek 1.5：动态 bold record 重放（实际 ${(ch.style as any).fontWeight}）`,
      );
    }

    // (2) seek 回退到动态 record 之前：block red（baseline）+ bold@1s → seek 0.5 → 仅 red（bold 不重放）。
    {
      const ch = new KineticChar('H', makeBaseTextStyle('#000000'));
      styleManager.apply((ch as any).style, 'red', {}, true);
      ch.recaptureBaseStyleSnapshot();
      const seg = makeSegmentWithRecord(
        ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2,
      );
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 0.5, state);
      assert(
        (ch.style as any).fill === '#ff4d4f',
        `R16 seek 0.5（bold 之前）：block red baseline 保留（实际 ${(ch.style as any).fill}）`,
      );
      assert(
        (ch.style as any).fontWeight !== 'bold',
        `R16 seek 0.5：bold record 不重放（timePosition 1 > 0.5）（实际 fontWeight ${(ch.style as any).fontWeight}）`,
      );
    }

    // (3) recapture 后 resetStyle 回 baseline（含 block 样式）——验证 recapture 不是一次性的，reset 可重现。
    {
      const ch = new KineticChar('H', makeBaseTextStyle('#000000'));
      styleManager.apply((ch as any).style, 'red', {}, true);
      ch.recaptureBaseStyleSnapshot();
      // 再叠一个动态样式再 reset，应回 recaptured baseline（red）。
      styleManager.apply((ch as any).style, 'bold', {}, true);
      assert((ch.style as any).fontWeight === 'bold', 'R16 叠加 bold 后 fontWeight=bold');
      ch.resetStyle();
      assert(
        (ch.style as any).fill === '#ff4d4f',
        `R16 resetStyle 后回 recaptured baseline（red，实际 ${(ch.style as any).fill}）`,
      );
      assert(
        (ch.style as any).fontWeight === 'normal',
        `R16 resetStyle 后 bold 清除（回 baseline，实际 fontWeight ${(ch.style as any).fontWeight}）`,
      );
    }

    // (4) block big（相对样式）recapture 后不重复放大：block big 同步应用（24→36）→ recapture baseline=36
    //     → 动态 bold record seek → reset 回 36 + bold。big 不进 record → 不重复放大（36，不是 54）。
    {
      const ch = new KineticChar('H', makeBaseTextStyle('#000000', 24));
      styleManager.apply((ch as any).style, 'big', {}, true); // 24→36
      ch.recaptureBaseStyleSnapshot(); // baseline=36
      assert(
        ch.baseStyleSnapshot.fontSize === 36,
        `R16 block big recapture baseline=36（实际 ${ch.baseStyleSnapshot.fontSize}）`,
      );
      const seg = makeSegmentWithRecord(
        ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2,
      );
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state);
      assert(
        (ch.style as any).fontSize === 36,
        `R16 seek 1.5：block big 不重复放大（保持 36，不是 54）（实际 ${(ch.style as any).fontSize}）`,
      );
      assert(
        (ch.style as any).fontWeight === 'bold',
        `R16 seek 1.5：动态 bold 重放（实际 ${(ch.style as any).fontWeight}）`,
      );
    }

    // (5) ended 重播：block red baseline + 动态 bold → 播完 ended → 重播 → reset 回 baseline(red) + 重放
    //     timePosition<=0（无）→ 仅 red（bold 不残留）。验证 R14 的 ended-replay 在 R16 baseline 下仍正确。
    {
      const ch = new KineticChar('H', makeBaseTextStyle('#000000'));
      styleManager.apply((ch as any).style, 'red', {}, true);
      ch.recaptureBaseStyleSnapshot();
      const seg = makeSegmentWithRecord(
        ch, [{ char: ch, styleName: 'bold', params: {}, timePosition: 1 }], 2,
      );
      const { state } = makeFakeState(false);
      PlaybackController.seekToTime(seg, 1.5, state); // red + bold
      PlaybackController.seekToTime(seg, 2, state); // ended
      PlaybackController.playSegment(seg, state); // 重播
      assert(
        (ch.style as any).fill === '#ff4d4f',
        `R16 ended 重播：block red baseline 保留（实际 ${(ch.style as any).fill}）`,
      );
      assert(
        (ch.style as any).fontWeight !== 'bold',
        `R16 ended 重播：bold 不残留（实际 fontWeight ${(ch.style as any).fontWeight}）`,
      );
    }
  });
});

describe('[13] rainbow 白底收口 + 邻接 override（主题二 S3 / 处方 6(d)，真实管线 build + seekToTime）', () => {
  // 读 KineticChar 私有 modifiers Map 的键集合（测试专用窄访问；生产面不暴露）。
  const modIds = (c: any): string[] => [...((c as any).modifiers?.keys?.() ?? [])];

  it('rainbow 白底 + modifier 挂载 + seek 重放幂等（fill 恒白、rainbow modifier 恰好一个）', async () => {
    const { segment, char, playbackState } = await build('{彩虹} @ f.rainbow');
    // 构建期白底：rainbow 的 fillReset 经 styleManager.apply 写 "#ffffff"。
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === '#ffffff',
      `S3-① 构建后 baseline.fill 恒白（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    // seek 重放：registerBehaviors 清旧 modifier 后按 timePosition<=t 重 apply。
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      fillHex(char.style.fill) === '#ffffff',
      `S3-① SEEK 0.5 后 fill 恒白（实际 ${fillHex(char.style.fill)}）`,
    );
    assert(
      modIds(char).filter((id) => id === 'rainbow').length === 1,
      `S3-① SEEK 0.5 后 rainbow modifier 恰好一个（实际 ${modIds(char).join(',') || '∅'}）`,
    );
    // 多次 seek 往返幂等：modifier 不堆积、fill 不漂移。
    PlaybackController.seekToTime(segment, 0.2, playbackState);
    PlaybackController.seekToTime(segment, 0.8, playbackState);
    assert(
      fillHex(char.style.fill) === '#ffffff',
      `S3-① 多次 seek 往返后 fill 恒白（实际 ${fillHex(char.style.fill)}）`,
    );
    assert(
      modIds(char).filter((id) => id === 'rainbow').length === 1,
      `S3-① 多次 seek 往返后 rainbow modifier 仍恰好一个（实际 ${modIds(char).join(',') || '∅'}）`,
    );
  });

  it('f.red.f.rainbow 邻接 override：red 烘进 baseline，rainbow 重放时覆盖为白', async () => {
    const { segment, char, playbackState } = await build('{彩虹} @ f.red.f.rainbow');
    // red 是 pre-hold char 样式 → 烘进 baseline（P1 烘焙，探针验证 #ff4d4f）。
    // rainbow 是 behavior record，不在构建期改写 baseline；其 fillReset 在 record 重放
    // （seek/play）时覆盖为白——邻接 override 语义：同 color 互斥组后写者胜，
    // 但时序上 red 属构建期烘焙、rainbow 属运行期重放，两相位各归其位。
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
      `S3-② f.red.f.rainbow 构建后 baseline.fill = 红（P1 烘焙，实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      fillHex(char.style.fill) === '#ffffff',
      `S3-② SEEK 0.5 后 fill = 白（rainbow fillReset 重放覆盖 red，实际 ${fillHex(char.style.fill)}）`,
    );
    assert(
      modIds(char).filter((id) => id === 'rainbow').length === 1,
      `S3-② SEEK 0.5 后 rainbow modifier 恰好一个（实际 ${modIds(char).join(',') || '∅'}）`,
    );
  });
});
