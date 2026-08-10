// stage 默认参数 + bg 生命周期回归 [24]-[33]（主题一：织网 S13 / playback 渐拆第 5 批）。
//
// 迁自 final-playback-test.ts 的 testStageDefaultParamAlignment([24]) / testBgStringParamPreservation([25]) /
// testBgClearInvalidatesPendingLoad([26]) / testBgDeferredExecution([27]) /
// testBgSameUrlReplaceDoesNotUnloadSharedTexture([28]) /
// testBgLoadStateWithoutSpriteInvalidatesPendingLoad([29]) / testBgReplayResolvesLiveSpriteTarget([30]) /
// testBgReplayBeforeBgFilterReplay([31]) / testBgMultiSeekBeforeResolve([32]) /
// testBackgroundSurfaceProfilesAndReplayBoundary([33])。
//
// ⚠️ 有意变更一（顺序无关化）：原脚本 [26] 断言「初始 sprite === null」依赖**前序 bg 用例的 finally
// 清理**这一隐式顺序前提。迁出后每个 bg describe 显式 beforeEach/afterEach setBackgroundSprite(null,
// {unloadTexture:false})——顺序无关性即迁移正确性判据。[26] 的「初始 null」断言保留（验证 beforeEach
// 清空契约 + getBackgroundSprite 行为）。
//
// ⚠️ 有意变更二（monkeypatch → vi.spyOn）：原脚本手写 save/restore 的 effectManager.apply /
// stageManager.apply / Assets.load/unload 替换统一转 vi.spyOn + vi.restoreAllMocks（afterEach 兜底 +
// 用例内 finally 针对 sprite 状态）。语义等价，恢复路径从手工变机制。
//
// 诚实边界：stageManager 为真实单例（pixi v8 懒初始化，构造不触发 WebGL）；Assets.load/unload 被
// mock 的用例不触真实纹理加载；[33] 前半段用真实 effectManager.apply 产真实 filter 实例（instanceof
// 断言依赖 vitest 环境不 minify 的类身份，与 constructor.name 断言同属「环境稳定面」约定）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Assets, Container, Sprite, Texture } from 'pixi.js';
import { PlaybackController } from '@kmd/core/player/PlaybackController';
import { EffectProcessor } from '@kmd/core/effects/EffectProcessor';
import { effectManager } from '@kmd/core/effects/EffectManager';
import { stageManager } from '@kmd/core/stage/StageManager';
import { StageRuntime } from '@kmd/core/stage/StageRuntime';
import { buildStageModifierApplyParams, buildStageModifierRecord } from '@kmd/core/stage/stagePresets';
import { layout } from '@kmd/core/layout/LayoutEngine';
import { TextDuotoneFilter, BackgroundDuotoneFilter } from '@kmd/core/filters/duotone';
import { TextEmbossFilter, BackgroundEmbossFilter } from '@kmd/core/filters/emboss';
import { GrayFilter } from '@kmd/core/filters/GrayFilter';
import { G } from './playback-harness';

/** 断言桥：1:1 保留原脚本 assert(cond, msg) 的诊断文本（vitest 自定义消息）。 */
function assert(cond: boolean, message: string): void {
  expect(Boolean(cond), message).toBe(true);
}

/** bg describe 共享的 sprite 清场（unloadTexture:false——测试 URL 从未真实加载，不触发 Assets.unload）。 */
function clearBgSprite(): void {
  stageManager.setBackgroundSprite(null, null, { unloadTexture: false });
}

describe('[24] R22-followup stage modifier 默认参数对齐（SA-38）', () => {
  afterEach(() => layout.reset(true));

  it('自然播放（applyParams）与 seek 重放（record）两条路径共享同一份构建期预解析', () => {
    // (1) cam.shake 缺失变量：自然播放（buildStageModifierApplyParams）与 seek 重放
    //     （buildStageModifierRecord.baseStrength/duration）都用命令预设默认值。
    {
      const raw = { strength: 'var.missing', duration: 'var.missingDur' };
      const applyParams = buildStageModifierApplyParams('cam.shake', raw);
      const record = buildStageModifierRecord('cam.shake', raw);
      assert(
        applyParams.strength === 5 && applyParams.duration === 0.5,
        `R22-followup cam.shake(var.missing) 自然播放 params=strength5/duration0.5（实际 s=${applyParams.strength} d=${applyParams.duration}）`,
      );
      assert(
        record?.baseStrength === 5 && record?.duration === 0.5,
        `R22-followup cam.shake(var.missing) seek 重放 record.baseStrength5/duration0.5（实际 s=${record?.baseStrength} d=${record?.duration}）`,
      );
      assert(
        applyParams.strength === record?.baseStrength && applyParams.duration === record?.duration,
        `R22-followup cam.shake 两路径默认值一致（自然=${applyParams.strength}/${applyParams.duration} vs seek=${record?.baseStrength}/${record?.duration}）`,
      );
    }
    // (2) cam.shake 已定义变量：两路径都解析成定义值（fallback 不参与）。
    {
      const raw = { strength: 'var.defined', duration: 'var.definedDur' };
      // 注入定义变量到 layout.globalMarkers（resolveStageNumeric 经 RuntimeValueResolver 读它）。
      (layout as any).globalMarkers.set('var.defined', { x: 8, y: 8 });
      (layout as any).globalMarkers.set('var.definedDur', { x: 1.5, y: 1.5 });
      const applyParams = buildStageModifierApplyParams('cam.shake', raw);
      const record = buildStageModifierRecord('cam.shake', raw);
      assert(
        applyParams.strength === 8 && applyParams.duration === 1.5,
        `R22-followup cam.shake(var.defined) 自然播放解析=8/1.5（实际 ${applyParams.strength}/${applyParams.duration}）`,
      );
      assert(
        record?.baseStrength === 8 && record?.duration === 1.5,
        `R22-followup cam.shake(var.defined) seek 重放解析=8/1.5（实际 ${record?.baseStrength}/${record?.duration}）`,
      );
      // 原脚本在此显式 delete；afterEach layout.reset(true) 亦兜底（singleFork 不留种）。
      (layout as any).globalMarkers.delete('var.defined');
      (layout as any).globalMarkers.delete('var.definedDur');
    }
    // (3) cam.drift 缺失变量：两路径都用默认值（strength=5/speed=0.001）。
    {
      const raw = { strength: 'var.missing', speed: 'var.missingSpeed' };
      const applyParams = buildStageModifierApplyParams('cam.drift', raw);
      assert(
        applyParams.strength === 5 && applyParams.speed === 0.001,
        `R22-followup cam.drift(var.missing) 自然播放 params=strength5/speed0.001（实际 s=${applyParams.strength} sp=${applyParams.speed}）`,
      );
    }
    // (4) 数字直接传：两路径都原样透传（不 fallback）。
    {
      const raw = { strength: 12, duration: 0.8 };
      const applyParams = buildStageModifierApplyParams('cam.shake', raw);
      const record = buildStageModifierRecord('cam.shake', raw);
      assert(
        applyParams.strength === 12 && applyParams.duration === 0.8,
        `R22-followup cam.shake(12,0.8) 自然播放原样透传（实际 ${applyParams.strength}/${applyParams.duration}）`,
      );
      assert(
        record?.baseStrength === 12 && record?.duration === 0.8,
        `R22-followup cam.shake(12,0.8) seek 重放原样透传（实际 ${record?.baseStrength}/${record?.duration}）`,
      );
    }
  });
});

describe('[25] SA-39 bg 非数字字符串参数保留（StageRuntime.apply 字符串透传）', () => {
  it('非数字字符串（src URL / hex color）透传；数值字符串仍 resolveNumeric', () => {
    const rt = new StageRuntime({
      getDesignMetrics: () => ({ width: 1920, height: 1080 }),
      getAuditPort: () => ({ record: () => {}, clear: () => {} }),
    });

    // (1) bg(src="...")：src 必须保留为字符串 URL，不能被 resolveNumeric 吞成 0。
    {
      let captured: any = null;
      rt.register('bg', (p: any) => { captured = p; });
      rt.apply('bg', { src: 'tests/assets/sample-bg.jpg' });
      assert(
        typeof captured.src === 'string' && captured.src === 'tests/assets/sample-bg.jpg',
        `SA-39 bg(src) 参数保留为字符串（实际 typeof=${typeof captured.src} val=${captured.src}）`,
      );
    }

    // (2) bg(color="#1a0a2e")：color 必须保留为 hex 字符串。
    {
      let captured: any = null;
      rt.register('bg', (p: any) => { captured = p; });
      rt.apply('bg', { color: '#1a0a2e' });
      assert(
        typeof captured.color === 'string' && captured.color === '#1a0a2e',
        `SA-39 bg(color) 参数保留为 hex 字符串（实际 typeof=${typeof captured.color} val=${captured.color}）`,
      );
    }

    // (3) bg(color, src) 组合：两个都必须是字符串。
    {
      let captured: any = null;
      rt.register('bg', (p: any) => { captured = p; });
      rt.apply('bg', { color: '#0f3460', src: 'tests/assets/sample-bg.jpg' });
      assert(
        typeof captured.color === 'string' && typeof captured.src === 'string',
        `SA-39 bg(color,src) 两个参数均保留字符串（color typeof=${typeof captured.color} src typeof=${typeof captured.src}）`,
      );
    }

    // (4) 回归保护：数值字符串仍被 resolveNumeric 解析（cam.move 的 "200" → 200）。
    {
      let captured: any = null;
      rt.register('testNum', (p: any) => { captured = p; });
      rt.apply('testNum', { x: '200', y: '0', duration: '1s' });
      assert(
        typeof captured.x === 'number' && captured.x === 200,
        `SA-39 数值字符串仍解析为数字（x typeof=${typeof captured.x} val=${captured.x}）`,
      );
      assert(
        typeof captured.duration === 'number' && captured.duration === 1,
        `SA-39 时间单位字符串仍解析为秒数（duration typeof=${typeof captured.duration} val=${captured.duration}）`,
      );
    }

    // (5) 位置参数字符串（bg("#1a0a2e")）也必须保留字符串。
    {
      let captured: any = null;
      rt.register('bg', (p: any) => { captured = p; });
      rt.apply('bg', { '0': '#1a0a2e' });
      assert(
        typeof captured['0'] === 'string' && captured['0'] === '#1a0a2e',
        `SA-39 位置参数非数字字符串保留（typeof=${typeof captured['0']} val=${captured['0']}）`,
      );
    }
  });
});

describe('[26] SA-40 bg(color) 清除使待 resolve 的 bg(src) 异步加载过期', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('setBackgroundSprite(null) 推进 epoch → pending resolve 被守卫丢弃', () => {
    // (1) 初始状态（beforeEach 已清场——原脚本此断言依赖前序用例 finally，现由 beforeEach 显式保证）。
    const initialEpoch = stageManager.currentBgEpoch;
    assert(
      stageManager.getBackgroundSprite() === null,
      `SA-40 初始 sprite 为 null（实际 ${stageManager.getBackgroundSprite()}）`,
    );

    // (2) 模拟 bg(src) 启动异步加载：nextBgEpoch 返回加载纪元
    const loadEpoch = stageManager.nextBgEpoch();
    assert(
      loadEpoch === initialEpoch + 1,
      `SA-40 nextBgEpoch 返回 initialEpoch+1（实际 loadEpoch=${loadEpoch} initial=${initialEpoch}）`,
    );

    // (3) 模拟 bg(color) 清除 sprite：应推进 epoch
    stageManager.setBackgroundSprite(null);
    const epochAfterClear = stageManager.currentBgEpoch;
    assert(
      epochAfterClear > loadEpoch,
      `SA-40 setBackgroundSprite(null) 后 epoch > loadEpoch（实际 epochAfterClear=${epochAfterClear} loadEpoch=${loadEpoch}）`,
    );

    // (4) 验证：异步 resolve 检查 currentBgEpoch !== epoch 会被丢弃
    assert(
      stageManager.currentBgEpoch !== loadEpoch,
      `SA-40 currentBgEpoch !== loadEpoch → 待 resolve 的异步加载会被 epoch 守卫丢弃（实际 current=${stageManager.currentBgEpoch} load=${loadEpoch}）`,
    );

    // (5) 回归保护：setBackgroundSprite(null) 后 sprite 仍为 null
    assert(
      stageManager.getBackgroundSprite() === null,
      `SA-40 清除后 sprite 仍 null（实际 ${stageManager.getBackgroundSprite()}）`,
    );
  });
});

describe('[27] SA-41 bg 命令延迟执行（buildStageModifierRecord 产出 record）', () => {
  it('bg 走 segmentTl.call 延迟路径：record 非 null、非 clearBoundary、persistent', () => {
    // (1) buildStageModifierRecord 对 bg 返回非 null
    const bgRecord = buildStageModifierRecord('bg', { color: '#1a0a2e' });
    assert(
      bgRecord !== null,
      `SA-41 buildStageModifierRecord("bg") 返回非 null（实际 ${bgRecord}）`,
    );
    assert(
      bgRecord!.command === 'bg',
      `SA-41 record.command === "bg"（实际 ${bgRecord!.command}）`,
    );

    // (2) bg 不是 clear boundary（不应 clearModifiers）
    assert(
      !bgRecord!.isClearBoundary,
      `SA-41 bg record 不是 isClearBoundary（实际 ${bgRecord!.isClearBoundary}）`,
    );

    // (3) bg 的 params 被正确保存（供 replayStageModifiers 重放）
    assert(
      (bgRecord!.params as any).color === '#1a0a2e',
      `SA-41 bg record 保留 color 参数（实际 ${JSON.stringify(bgRecord!.params)}）`,
    );

    // (4) bg with src
    const bgSrcRecord = buildStageModifierRecord('bg', { src: 'tests/assets/sample-bg.jpg' });
    assert(
      bgSrcRecord !== null && (bgSrcRecord!.params as any).src === 'tests/assets/sample-bg.jpg',
      `SA-41 bg(src) record 保留 src 参数（实际 ${JSON.stringify(bgSrcRecord?.params)}）`,
    );

    // (5) bg 无 duration（persistent，seek 时总是重放，与 cam.drift 同语义）
    assert(
      bgRecord!.duration === undefined,
      `SA-41 bg record duration undefined（persistent，实际 ${bgRecord!.duration}）`,
    );

    // (6) 回归保护：cam.shake 仍走 modifierBased 路径（不被 bg 改动影响）
    const shakeRecord = buildStageModifierRecord('cam.shake', { strength: 10, duration: 0.5 });
    assert(
      shakeRecord !== null && shakeRecord!.baseStrength === 10 && shakeRecord!.duration === 0.5,
      `SA-41 cam.shake 仍正常返回 record（baseStrength=${shakeRecord?.baseStrength} duration=${shakeRecord?.duration}）`,
    );

    // (7) 回归保护：cam.move 仍返回 null（走 tween capture 路径，不进 tl.call 延迟）
    const moveRecord = buildStageModifierRecord('cam.move', { x: 200, y: 0, duration: 1 });
    assert(
      moveRecord === null,
      `SA-41 cam.move 仍返回 null（走 tween 路径，实际 ${moveRecord}）`,
    );
  });
});

describe('[28] SA-42 bg(src) 同 URL 替换不卸载共享 texture', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('同 URL 替换/同轮 clear→load 取消 pending unload；不同 URL 与清空仍卸载', async () => {
    const unloadCalls: string[] = [];
    vi.spyOn(Assets, 'load').mockImplementation(() => Promise.resolve(Texture.WHITE));
    vi.spyOn(Assets, 'unload').mockImplementation((url: string) => {
      unloadCalls.push(url);
      return Promise.resolve();
    });
    const flushUnloadTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), '/tests/assets/sample-bg.jpg');
    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), '/tests/assets/sample-bg.jpg');
    assert(
      unloadCalls.length === 0,
      `SA-42 同 URL 替换不调用 Assets.unload（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(null, null, { unloadTexture: false });
    await flushUnloadTick();
    assert(
      unloadCalls.length === 0,
      `SA-42 同 URL bg(color,src) fallback 清屏不卸载缓存（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(null);
    stageManager.loadBackgroundFromUrl('/tests/assets/sample-bg.jpg');
    await Promise.resolve();
    await flushUnloadTick();
    assert(
      unloadCalls.length === 0,
      `SA-42 同轮 clear → load(same URL) 必须取消 pending unload（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), '/tests/assets/other-bg.jpg');
    await flushUnloadTick();
    assert(
      unloadCalls.length === 1 && unloadCalls[0] === '/tests/assets/sample-bg.jpg',
      `SA-42 不同 URL 替换卸载旧 URL（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(null);
    await flushUnloadTick();
    assert(
      unloadCalls.length === 2 && unloadCalls[1] === '/tests/assets/other-bg.jpg',
      `SA-42 清空 sprite 卸载当前 URL（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    // 原脚本 finally 的 sprite 清场：afterEach clearBgSprite 承接（unloadTexture:false，不触发 mock unload）。
  });
});

describe('[29] SA-43 loadState(no bgSpriteUrl) 取消 pending bg(src)', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('恢复到 bgSpriteUrl=null 的 checkpoint 无条件推进 epoch', async () => {
    const pendingEpoch = stageManager.nextBgEpoch();
    assert(
      stageManager.getBackgroundSprite() === null,
      `SA-43 pending load 期间 sprite 可为 null（实际 ${stageManager.getBackgroundSprite()}）`,
    );

    stageManager.loadState({
      camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
      cameraOffset: { x: 0, y: 0, zoom: 1, rotation: 0 },
      designWidth: 1920,
      designHeight: 1080,
      isFixedRatio: true,
      backgroundColor: '#000000',
      bgSpriteUrl: null,
    });

    assert(
      stageManager.currentBgEpoch > pendingEpoch,
      `SA-43 loadState(no bgSpriteUrl) 后 epoch > pendingEpoch（current=${stageManager.currentBgEpoch} pending=${pendingEpoch}）`,
    );
  });
});

describe('[30] SA-44 :bg replay 重新解析 live sprite target', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('seek 到 :bg record 时 target 取 live 背景 sprite，而非 build-time fallback', () => {
    const bgSprite = new Sprite(Texture.WHITE);
    stageManager.setBackgroundSprite(bgSprite, '/tests/assets/sample-bg.jpg');

    const fallbackTarget = new Container();
    const tl = G.timeline({ paused: true });
    tl.to({ x: 0 }, { x: 1, duration: 2 });
    const segment: any = {
      timeline: tl,
      duration: 2,
      behaviors: [{
        char: fallbackTarget,
        target: fallbackTarget,
        targetLevel: 'bg',
        effectName: 'probeBehavior',
        params: {},
        charIndex: 0,
        timePosition: 1,
      }],
      instantEffects: [{
        target: fallbackTarget,
        targetLevel: 'bg',
        effectName: 'probeInstant',
        params: {},
        charIndex: 0,
        timePosition: 1,
      }],
      styleRecords: [],
      entranceFilters: [],
      stageModifierRecords: [],
    };
    const state: any = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [],
    };

    const calls: any[] = [];
    vi.spyOn(effectManager, 'apply').mockImplementation((target: any, name: string) => {
      calls.push({ target, name });
      return null;
    });

    PlaybackController.seekToTime(segment, 1, state);
    assert(
      calls.length === 2,
      `SA-44 behavior + instant 两条 :bg replay 都应 apply（实际 ${calls.map((c) => c.name).join(',')})`,
    );
    assert(
      calls.every((c) => c.target === bgSprite),
      `SA-44 :bg replay target 必须是 live bg sprite，而非 fallback paragraphText`,
    );
  });
});

describe('[31] SA-45 bg replay 先于 :bg filter replay', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('seek 顺序：replayStageModifiers 恢复当前 bg → 再注册 :bg filter（打在 live sprite 上）', () => {
    const fallbackTarget = new Container();
    const liveSprite = new Sprite(Texture.WHITE);
    const tl = G.timeline({ paused: true });
    tl.to({ x: 0 }, { x: 1, duration: 2 });
    const segment: any = {
      timeline: tl,
      duration: 2,
      behaviors: [],
      instantEffects: [{
        target: fallbackTarget,
        targetLevel: 'bg',
        effectName: 'probeInstant',
        params: {},
        charIndex: 0,
        timePosition: 1,
      }],
      styleRecords: [],
      entranceFilters: [],
      stageModifierRecords: [{
        command: 'bg',
        params: { src: 'tests/assets/sample-bg.jpg' },
        timePosition: 1,
      }],
    };
    const state: any = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [],
    };

    const order: string[] = [];
    vi.spyOn(stageManager, 'apply').mockImplementation((command: string) => {
      order.push(`stage:${command}`);
      if (command === 'bg') stageManager.setBackgroundSprite(liveSprite, '/tests/assets/sample-bg.jpg');
    });
    vi.spyOn(effectManager, 'apply').mockImplementation((target: any, name: string) => {
      order.push(`effect:${name}:${target === liveSprite ? 'live' : 'fallback'}`);
      return null;
    });

    PlaybackController.seekToTime(segment, 1, state);
    assert(
      order.join(' > ') === 'stage:bg > effect:probeInstant:live',
      `SA-45 顺序应为 bg replay 后再 :bg filter replay（实际 ${order.join(' > ')}）`,
    );
  });
});

describe('[32] SA-46 bg 未 resolve 时连续 seek 不重复 apply :bg 特效', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('pending 句柄每轮取消上一轮：resolve 后 behavior/instant 各只 apply 一次', () => {
    const fallbackTarget = new Container();
    const tl = G.timeline({ paused: true });
    tl.to({ x: 0 }, { x: 1, duration: 5 });
    const segment: any = {
      timeline: tl,
      duration: 5,
      behaviors: [{
        char: fallbackTarget,
        target: fallbackTarget,
        targetLevel: 'bg',
        effectName: 'probeBehavior',
        params: {},
        charIndex: 0,
        timePosition: 1,
      }],
      instantEffects: [{
        target: fallbackTarget,
        targetLevel: 'bg',
        effectName: 'probeInstant',
        params: {},
        charIndex: 0,
        timePosition: 1,
      }],
      styleRecords: [],
      entranceFilters: [],
      stageModifierRecords: [{
        command: 'bg',
        params: { src: 'tests/assets/sample-bg.jpg' },
        timePosition: 0,
      }],
    };
    const state: any = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [],
    };

    const behaviorCalls: any[] = [];
    const instantCalls: any[] = [];
    // stageManager.apply("bg", ...) 的 mock：不真正加载图片，让 sprite 保持 null。
    vi.spyOn(stageManager, 'apply').mockImplementation((command: string) => {
      if (command === 'bg') return; // 不加载图片，保持 sprite null
    });
    vi.spyOn(effectManager, 'apply').mockImplementation((target: any, name: string) => {
      if (name === 'probeBehavior') behaviorCalls.push({ target });
      if (name === 'probeInstant') instantCalls.push({ target });
      return null;
    });

    // 第一次 seek——bg 未 resolve，注册 onBackgroundReady 延后回调
    PlaybackController.seekToTime(segment, 2, state);
    assert(
      behaviorCalls.length === 0,
      `SA-46 第一次 seek 时 bg 未 resolve，behavior 不应 apply（实际 ${behaviorCalls.length}）`,
    );
    assert(
      instantCalls.length === 0,
      `SA-46 第一次 seek 时 bg 未 resolve，instant 不应 apply（实际 ${instantCalls.length}）`,
    );

    // 第二次 seek——旧实现会再注册一组闭包，resolve 后两组都执行
    PlaybackController.seekToTime(segment, 3, state);
    assert(
      behaviorCalls.length === 0,
      `SA-46 第二次 seek 时 bg 仍未 resolve，behavior 不应 apply（实际 ${behaviorCalls.length}）`,
    );
    assert(
      instantCalls.length === 0,
      `SA-46 第二次 seek 时 bg 仍未 resolve，instant 不应 apply（实际 ${instantCalls.length}）`,
    );

    // 模拟 bg resolve——只有最后一次 seek 注册的闭包应执行
    const resolveSprite = new Sprite(Texture.WHITE);
    stageManager.setBackgroundSprite(resolveSprite, 'tests/assets/sample-bg.jpg');

    assert(
      behaviorCalls.length === 1,
      `SA-46 bg resolve 后 behavior 应只 apply 一次（实际 ${behaviorCalls.length}）——连续 seek 不应累积闭包`,
    );
    assert(
      instantCalls.length === 1,
      `SA-46 bg resolve 后 instant 应只 apply 一次（实际 ${instantCalls.length}）——连续 seek 不应累积闭包`,
    );
    assert(
      behaviorCalls[0]?.target === resolveSprite,
      `SA-46 behavior apply target 应为 resolve 后的 live sprite`,
    );
    assert(
      instantCalls[0]?.target === resolveSprite,
      `SA-46 instant apply target 应为 resolve 后的 live sprite`,
    );
  });
});

describe('[33] SA-47 background profile 路由 + latest bg boundary', () => {
  beforeEach(clearBgSprite);
  afterEach(() => { vi.restoreAllMocks(); clearBgSprite(); });

  it('text/background surface 选择对应 filter profile；latest bg boundary 之前的 record 不重放', () => {
    const profileTarget = new Container();
    const textDuotone = effectManager.apply(profileTarget, 'duotone', {}, true, 'text');
    const backgroundDuotone = effectManager.apply(profileTarget, 'duotone', {}, true, 'background');
    const textEmboss = effectManager.apply(profileTarget, 'emboss', {}, true, 'text');
    const backgroundEmboss = effectManager.apply(profileTarget, 'emboss', {}, true, 'background');
    const backgroundGray = effectManager.apply(profileTarget, 'gray', {}, true, 'background');
    assert(textDuotone instanceof TextDuotoneFilter, 'SA-47 text duotone 保持 alpha profile');
    assert(backgroundDuotone instanceof BackgroundDuotoneFilter, 'SA-47 bg duotone 选择 luma profile');
    assert(textEmboss instanceof TextEmbossFilter, 'SA-47 text emboss 保持 alpha profile');
    assert(backgroundEmboss instanceof BackgroundEmbossFilter, 'SA-47 bg emboss 选择 luma profile');
    assert(backgroundGray instanceof GrayFilter, 'SA-47 bg gray 复用现有 GrayFilter');
    assert(textDuotone.kmdEffectProfile === 'duotone:text', 'SA-47 text duotone 诊断标识稳定');
    assert(backgroundDuotone.kmdEffectProfile === 'duotone:background', 'SA-47 bg duotone 诊断标识稳定');
    assert(textEmboss.kmdEffectProfile === 'emboss:text', 'SA-47 text emboss 诊断标识稳定');
    assert(backgroundEmboss.kmdEffectProfile === 'emboss:background', 'SA-47 bg emboss 诊断标识稳定');
    assert(backgroundGray.kmdEffectProfile === 'gray', 'SA-47 gray 诊断标识稳定');

    const textUnderwater = effectManager.apply(profileTarget, 'underwater', {}, true, 'text');
    const backgroundUnderwater = effectManager.apply(profileTarget, 'underwater', {}, true, 'background');
    assert(
      textUnderwater.filters[1] instanceof TextDuotoneFilter,
      'SA-47 underwater:text 组合 TextDuotoneFilter',
    );
    assert(
      backgroundUnderwater.filters[1] instanceof BackgroundDuotoneFilter,
      'SA-47 underwater:background 组合 BackgroundDuotoneFilter',
    );

    const grayBgClassification = EffectProcessor.classifyCommand({ name: 'gray', params: {}, level: 'bg' });
    assert(
      grayBgClassification.lane === 'effect' && !grayBgClassification.isStyle,
      `SA-47 gray:bg 应优先走 effect lane（实际 lane=${grayBgClassification.lane} isStyle=${grayBgClassification.isStyle}）`,
    );

    G.ticker.remove(textUnderwater.tickerFn);
    G.ticker.remove(backgroundUnderwater.tickerFn);
    for (const filter of [
      textDuotone,
      backgroundDuotone,
      textEmboss,
      backgroundEmboss,
      backgroundGray,
      ...textUnderwater.filters,
      ...backgroundUnderwater.filters,
    ]) {
      filter?.destroy?.();
    }
    profileTarget.filters = [];

    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), 'tests/assets/sample-bg.jpg');
    const tl = G.timeline({ paused: true });
    tl.to({ x: 0 }, { x: 1, duration: 3 });
    const segment: any = {
      timeline: tl,
      duration: 3,
      behaviors: [
        { char: new Container(), target: new Container(), targetLevel: 'bg', effectName: 'oldBehavior', params: {}, charIndex: 0, timePosition: 1 },
        { char: new Container(), target: new Container(), targetLevel: 'bg', effectName: 'newBehavior', params: {}, charIndex: 0, timePosition: 2 },
      ],
      instantEffects: [
        { target: new Container(), targetLevel: 'bg', effectName: 'duotone', params: {}, charIndex: 0, timePosition: 1 },
        { target: new Container(), targetLevel: 'bg', effectName: 'emboss', params: {}, charIndex: 0, timePosition: 2 },
      ],
      styleRecords: [],
      entranceFilters: [],
      stageModifierRecords: [
        { command: 'bg', params: { src: 'tests/assets/sample-bg.jpg' }, timePosition: 1 },
        { command: 'bg', params: { src: 'tests/assets/sample-bg.jpg' }, timePosition: 2 },
      ],
    };
    const state: any = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [],
      pendingBgReadyCancels: [],
    };
    const calls: Array<{ name: string; surface: string }> = [];
    vi.spyOn(stageManager, 'apply').mockImplementation(() => {});
    vi.spyOn(effectManager, 'apply').mockImplementation((_target: any, name: string, _params: any, _force: boolean, surface: string) => {
      calls.push({ name, surface });
      return null;
    });
    PlaybackController.seekToTime(segment, 2.5, state);
    assert(
      calls.map((call) => call.name).join(',') === 'newBehavior,emboss',
      `SA-47 latest bg boundary 之前的 record 不重放（实际 ${calls.map((call) => call.name).join(',')})`,
    );
    assert(
      calls.every((call) => call.surface === 'background'),
      `SA-47 bg replay 全部显式选择 background profile`,
    );
  });
});
