// reader typography settings 回归 [34]（主题一：织网 S14 / playback 渐拆第 7 批）。
//
// 迁自 final-playback-test.ts 的 testReaderTypographySettings（原 [34]，R3-I）。
//
// ⚠️ 有意变更一（configure 自设置）：原脚本调 TextBuildContextResolver.configure({...}) 后从不回退
// （该静态配置无回退 API）。迁出后本 it 在开头自行 configure 所需 typography——单进程顺序执行下
// 自设置即自清理（后续套件若依赖该静态配置须同样自设置，不继承本套件残留）。
//
// ⚠️ 有意变更二（monkeypatch → vi.spyOn）：原脚本手写 save/restore 的 scriptPlayer.rebuildForTypography
// 与 readerApp.loadFonts 替换转 vi.spyOn + afterEach vi.restoreAllMocks。
//
// session 隔离注记：ReaderRuntimeWebSession 构造会重绑共享 scriptPlayer 的回调（会话不隔离，
// ReaderRuntimeSession.ts:61）——本用例只断言 typography 消解与 rebuild 计数，不订阅事件，
// 三会话共存无交叉影响；S3 契约套件已钉死会话生命周期与事件门控。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { scriptPlayer } from '../core/player/ScriptPlayer';
import { readerApp } from '../core/App';
import { TextBuildContextResolver } from '../core/render/text/TextBuildContextResolver';
import { ReaderRuntimeWebSession } from '../core/runtime/ReaderRuntimeSession';

/** 断言桥：1:1 保留原脚本 assert(cond, msg) 的诊断文本（vitest 自定义消息）。 */
function assert(cond: boolean, message: string): void {
  expect(Boolean(cond), message).toBe(true);
}

describe('[34] R3-I reader typography settings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scroll/page 按 fontScale 比例重算 typography + 触发 rebuild；stage 忽略 host fontScale', async () => {
    const target = { x: 0, y: 0, _options: {
      fontSize: 20, lineHeight: 30, maxWidth: 800, indent: 0, align: 'left',
      letterSpacing: 0, externalMarkers: [],
    } } as any;

    let rebuildCalls = 0;
    vi.spyOn(scriptPlayer as any, 'rebuildForTypography').mockImplementation(async () => { rebuildCalls += 1; });
    vi.spyOn(readerApp as any, 'loadFonts').mockImplementation(async () => {});

    // 自设置 typography 基准（原脚本在 :3752 调 configure 从不回退——本 it 自设置，见文件头）。
    const scrollSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: 'scroll', fontScale: 1 },
    });
    TextBuildContextResolver.configure({ typography: { fontSize: 20, lineHeight: 30 } });
    let context = TextBuildContextResolver.fromTarget(target);
    assert(
      (context.baseStyle as any).fontSize === 20 && context.layoutOptions.fontSize === 20 && context.layoutOptions.lineHeight === 30,
      'R3-I Scroll 初始字号同时作用于 Pixi TextStyle 与 layout',
    );
    await scrollSession.updateSettings({ fontScale: 1.25 });
    context = TextBuildContextResolver.fromTarget(target);
    assert(
      (context.baseStyle as any).fontSize === 25 && context.layoutOptions.fontSize === 25 && context.layoutOptions.lineHeight === 37.5,
      'R3-I Scroll 热更新按比例重算字体与行高',
    );
    assert(rebuildCalls === 1, 'R3-I Scroll fontScale 变化触发一次 typography rebuild');

    const pageSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: 'page', fontScale: 1.1 },
    });
    context = TextBuildContextResolver.fromTarget(target);
    assert((context.baseStyle as any).fontSize === 22 && context.layoutOptions.lineHeight === 33,
      'R3-I Page 初始字号按比例作用于 typography');
    await pageSession.updateSettings({ fontScale: 0.9 });
    context = TextBuildContextResolver.fromTarget(target);
    assert((context.baseStyle as any).fontSize === 18 && context.layoutOptions.lineHeight === 27,
      'R3-I Page 热更新按比例重算 typography');
    assert(rebuildCalls === 2, 'R3-I Page fontScale 变化触发一次 typography rebuild');

    const stageSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: 'stage', fontScale: 1 },
    });
    await stageSession.updateSettings({ fontScale: 1.5 });
    context = TextBuildContextResolver.fromTarget(target);
    assert((context.baseStyle as any).fontSize === 20 && context.layoutOptions.lineHeight === 30,
      'R3-I Stage 忽略 host fontScale，保持 1x typography');
    assert(rebuildCalls === 2, 'R3-I Stage fontScale 变化不进入 typography rebuild');
  });
});
