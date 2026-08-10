// Reader runtime session 契约套件（主题一：织网 S3 / 审查整改 1 号问题补交付）。
//
// 钉死 ReaderRuntimeWebSession 的会话层行为（纯协议/资产策略由 reader-runtime-protocol.test.ts /
// runtime-asset-policy.test.ts 覆盖；本套件覆盖会话状态机与命令分发）：
//   - 状态机：事件驱动转移（loading→ready），state getter 镜像 onPlaybackStateChanged
//   - workId 戳记（wrapCallbacks 覆写 activeWorkId）
//   - seek 数学：timeMs 优先；progress → durationMs×clamp01；均无 → SEEK_TARGET_MISSING
//   - receive() 永不抛：六种信封错误 + LOAD_SCRIPT_PAYLOAD_INVALID + COMMAND_FAILED 全走 error 事件
//   - dispose：幂等、state→idle、后续回调静默、ensureActive 抛错路径
//   - updateSettings：timeScale 透传；fontScale rebuild 门（scroll/page 触发、stage 忽略）
//   - inspect：空 issues + mode 透传
//
// headless 可行性：构造函数无 DOM/WebGL/fetch 依赖（final-playback-test.ts [34] 判例，现已退役，
// 判例语义由 playback-typography.test.ts 承接）；loadSource 走真实 parser→SegmentBuilder 管线
//（setup.ts shim）。readerApp.loadFonts 经 vi.spyOn stub（node 无 FontFace）。
//
// 会话隔离纪律：session 构造重绑共享 scriptPlayer 回调（ReaderRuntimeSession.ts:61）——
// 单进程顺序执行下一 it 一 session，afterEach restore mocks；不做跨 it 会话共存。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readerApp } from '../core/App';
import { scriptPlayer } from '../core/player/ScriptPlayer';
import { ReaderRuntimeWebSession } from '../core/runtime/ReaderRuntimeSession';

const SOURCE = '{Hello} @ f.hold(1s).bold';

interface Recorder {
  ready: any[];
  progress: any[];
  stateChanges: Array<{ isPlaying: boolean; state: string }>;
  errors: any[];
  inspections: any[];
}

function makeRecorder() {
  const recorder: Recorder = { ready: [], progress: [], stateChanges: [], errors: [], inspections: [] };
  const callbacks = {
    onReady: (event: any) => recorder.ready.push(event),
    onProgress: (event: any) => recorder.progress.push(event),
    onPlaybackStateChanged: (event: any) => recorder.stateChanges.push(event),
    onError: (error: any) => recorder.errors.push(error),
    onInspectionReported: (event: any) => recorder.inspections.push(event),
  };
  return { recorder, callbacks };
}

beforeEach(() => {
  vi.spyOn(readerApp as any, 'loadFonts').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('session 状态机与 workId 戳记', () => {
  it('初始 idle + sessionId 非空', () => {
    const { callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    expect(session.state).toBe('idle');
    expect(typeof session.sessionId).toBe('string');
    expect(session.sessionId.length).toBeGreaterThan(0);
  });

  it('loadSource：事件驱动 loading→ready，workId 戳记，初始 progress timeMs 0', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    await session.loadSource(SOURCE, { id: 'w-session-1' });

    const states = recorder.stateChanges.map((event) => event.state);
    expect(states).toContain('loading');
    expect(states[states.length - 1]).toBe('ready');
    expect(session.state, 'state getter 镜像最后一次 onPlaybackStateChanged').toBe('ready');

    expect(recorder.ready.length).toBe(1);
    expect(recorder.ready[0].workId, 'wrapCallbacks 以 activeWorkId 覆写').toBe('w-session-1');
    expect(recorder.ready[0].durationMs).toBeGreaterThan(0);

    expect(recorder.progress.length).toBeGreaterThan(0);
    expect(recorder.progress[0].timeMs, 'ready 前初始 progress').toBe(0);
    expect(recorder.progress[0].workId).toBe('w-session-1');
  });
});

describe('seek 数学与 SEEK_TARGET_MISSING', () => {
  it('timeMs 优先于 progress；progress 映射 durationMs×clamp01', async () => {
    const { callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    await session.loadSource(SOURCE, { id: 'w-seek' });
    const durationMs = scriptPlayer.durationMs;
    expect(durationMs).toBeGreaterThan(0);

    const seekSpy = vi.spyOn(scriptPlayer, 'seekToTime').mockImplementation(() => {});
    session.seek({ timeMs: 1500, progress: 0.1 });
    expect(seekSpy, 'timeMs 优先（progress 不参与）').toHaveBeenCalledWith(1.5);

    session.seek({ progress: 0.5 });
    expect(seekSpy).toHaveBeenLastCalledWith((durationMs * 0.5) / 1000);

    session.seek({ progress: 2 });
    expect(seekSpy, 'progress clamp01 上界').toHaveBeenLastCalledWith(durationMs / 1000);
  });

  it('无 timeMs/progress → SEEK_TARGET_MISSING + state error（markerId 等不消解，协议注记在案）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    await session.loadSource(SOURCE, { id: 'w-seek-missing' });

    session.seek({ markerId: 'whatever' });
    expect(recorder.errors.length).toBe(1);
    expect(recorder.errors[0].code).toBe('SEEK_TARGET_MISSING');
    expect(recorder.errors[0].recoverable).toBe(true);
    expect(session.state).toBe('error');
    // reportError 同时发 playbackStateChanged(state:error, isPlaying:false)
    const last = recorder.stateChanges[recorder.stateChanges.length - 1];
    expect(last).toMatchObject({ isPlaying: false, state: 'error' });
  });
});

describe('loadScript 源消解错误码', () => {
  it('三源皆无 → SCRIPT_SOURCE_MISSING（resolves，错误走事件）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    await session.loadScript({ work: { id: 'w-missing' } } as any);
    expect(recorder.errors.map((error) => error.code)).toEqual(['SCRIPT_SOURCE_MISSING']);
    expect(recorder.errors[0].workId).toBe('w-missing');
    expect(session.state).toBe('error');
  });

  it('受控 https sourceUrl fetch 失败 → SCRIPT_SOURCE_LOAD_FAILED（recoverable）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    await session.loadScript({
      work: { id: 'w-fetch-fail' },
      sourceUrl: 'https://cdn.example.com/script.kmd',
    });
    expect(recorder.errors.map((error) => error.code)).toEqual(['SCRIPT_SOURCE_LOAD_FAILED']);
    expect(recorder.errors[0].message).toContain('network down');
    expect(recorder.errors[0].recoverable).toBe(true);
  });
});

describe('receive() 永不抛——信封错误全走 error 事件', () => {
  it('六种信封错误 resolves + 错误码 + commandId 回显（如有）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });

    await session.receive('{not json');
    await session.receive({ version: 2, id: 'c-version', type: 'play' } as any);
    await session.receive({ version: 1, type: 'play' } as any);
    await session.receive({ version: 1, id: 'c-type', type: 42 } as any);
    await session.receive({ version: 1, id: 'c-unknown', type: 'rewind' } as any);
    await session.receive('42'); // JSON 合法但非对象 → COMMAND_ENVELOPE_INVALID

    const codes = recorder.errors.map((error) => error.code);
    expect(codes).toEqual([
      'COMMAND_JSON_INVALID',
      'UNSUPPORTED_PROTOCOL_VERSION',
      'COMMAND_ID_MISSING',
      'COMMAND_TYPE_MISSING',
      'UNKNOWN_COMMAND',
      'COMMAND_ENVELOPE_INVALID',
    ]);
    expect(recorder.errors[1].commandId, 'version 错误在 id 存在时回显').toBe('c-version');
    expect(recorder.errors[2].commandId, 'COMMAND_ID_MISSING 无 id 可回显').toBeUndefined();
    expect(recorder.errors[4].commandId).toBe('c-unknown');
  });

  it('loadScript payload 非法 → LOAD_SCRIPT_PAYLOAD_INVALID（commandId 回显）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    await session.receive({
      version: 1,
      id: 'c-load-bad',
      type: 'loadScript',
      payload: { work: { id: '' }, source: SOURCE }, // work.id 空串 → isLoadScriptPayload false
    });
    expect(recorder.errors.map((error) => error.code)).toEqual(['LOAD_SCRIPT_PAYLOAD_INVALID']);
    expect(recorder.errors[0].commandId).toBe('c-load-bad');
  });

  it('handler 抛错 → COMMAND_FAILED（recoverable，命令 id 回显）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    vi.spyOn(scriptPlayer, 'loadSourceContent').mockRejectedValue(new Error('build broke'));
    await session.receive({
      version: 1,
      id: 'c-load-crash',
      type: 'loadScript',
      payload: { work: { id: 'w-crash' }, source: SOURCE },
    });
    expect(recorder.errors.map((error) => error.code)).toEqual(['COMMAND_FAILED']);
    expect(recorder.errors[0].message).toContain('build broke');
    expect(recorder.errors[0].commandId).toBe('c-load-crash');
  });
});

describe('dispose 语义', () => {
  it('幂等 + state→idle + ensureActive 抛错 + 回调静默', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });
    await session.loadSource(SOURCE, { id: 'w-dispose' });
    expect(session.state).toBe('ready');

    await session.dispose();
    expect(session.state).toBe('idle');
    await session.dispose(); // 幂等，不抛
    expect(session.state).toBe('idle');

    // 同步命令：ensureActive 抛
    expect(() => session.play()).toThrow(/disposed/);
    expect(() => session.pause()).toThrow(/disposed/);
    expect(() => session.seek({ timeMs: 0 })).toThrow(/disposed/);
    // 异步命令：reject
    await expect(session.loadSource(SOURCE)).rejects.toThrow(/disposed/);
    // receive：resolves 且无事件（reportError 对 disposed 静默）
    const errorCountBefore = recorder.errors.length;
    await session.receive({ version: 1, id: 'c-after-dispose', type: 'play' } as any);
    expect(recorder.errors.length, 'disposed session 不再发错误事件').toBe(errorCountBefore);
  });
});

describe('updateSettings 门与 inspect', () => {
  it('timeScale 透传 setTimeScale；fontScale rebuild 门：stage 忽略、scroll 触发', async () => {
    const { callbacks } = makeRecorder();
    const timeScaleSpy = vi.spyOn(scriptPlayer, 'setTimeScale').mockImplementation(() => {});
    const rebuildSpy = vi.spyOn(scriptPlayer, 'rebuildForTypography').mockResolvedValue(undefined);

    const stageSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: 'stage' },
      callbacks,
    });
    await stageSession.updateSettings({ fontScale: 1.5, timeScale: 2 });
    expect(timeScaleSpy, 'timeScale 透传').toHaveBeenCalledWith(2);
    expect(rebuildSpy, 'stage 模式忽略 fontScale（作者坐标系）').not.toHaveBeenCalled();

    const scrollSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: 'scroll', fontScale: 1 },
      callbacks,
    });
    await scrollSession.updateSettings({ fontScale: 1.25 });
    expect(rebuildSpy, 'scroll 模式 fontScale 变化触发一次 typography rebuild').toHaveBeenCalledTimes(1);

    // fontScale 未变化不重复 rebuild
    await scrollSession.updateSettings({ fontScale: 1.25 });
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
  });

  it('inspect：空 issues + mode 透传；setInspectionEnabled(true) 触发 inspect', () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });

    session.inspect('full');
    expect(recorder.inspections.length).toBe(1);
    expect(recorder.inspections[0].issues).toEqual([]);
    expect(recorder.inspections[0].diagnostics).toEqual([]);
    expect(recorder.inspections[0].mode).toBe('full');

    session.setInspectionEnabled(true, 'performance');
    expect(recorder.inspections.length).toBe(2);
    expect(recorder.inspections[1].mode).toBe('performance');

    session.setInspectionEnabled(false, 'quick');
    expect(recorder.inspections.length, 'enabled=false 不触发 inspect').toBe(2);
  });
});

describe('updateSettings 防火墙（主题二 S4a / 处方 10）', () => {
  it('非 record payload → SETTINGS_PAYLOAD_INVALID + commandId 回显（复刻 LOAD_SCRIPT_PAYLOAD_INVALID 惯例）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const session = new ReaderRuntimeWebSession({ callbacks });

    await session.receive({ version: 1, id: 'c-settings-bad', type: 'updateSettings', payload: 'garbage' });
    await session.receive({ version: 1, id: 'c-settings-arr', type: 'updateSettings', payload: [1, 2, 3] });

    expect(recorder.errors.map((error) => error.code)).toEqual([
      'SETTINGS_PAYLOAD_INVALID',
      'SETTINGS_PAYLOAD_INVALID',
    ]);
    expect(recorder.errors[0].commandId).toBe('c-settings-bad');
    expect(recorder.errors[1].commandId).toBe('c-settings-arr');
    expect(recorder.errors[0].recoverable).toBe(true);
  });

  it('半垃圾 payload → sanitized merge 无错误事件（坏字段静默 strip，好字段生效）', async () => {
    const { recorder, callbacks } = makeRecorder();
    const timeScaleSpy = vi.spyOn(scriptPlayer, 'setTimeScale').mockImplementation(() => {});
    const session = new ReaderRuntimeWebSession({ callbacks });

    await session.receive({
      version: 1,
      id: 'c-settings-mixed',
      type: 'updateSettings',
      payload: { timeScale: 2, debugOverlay: 'true', unknownField: 1 },
    });

    expect(recorder.errors, '字段级垃圾走静默 strip，不发错误事件').toEqual([]);
    expect(timeScaleSpy, '好字段 timeScale 生效').toHaveBeenCalledWith(2);
  });
});
