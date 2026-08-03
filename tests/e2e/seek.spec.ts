import { expect, test } from '@playwright/test';
import {
  attachErrorObservers,
  attachRuntimeEventRecorder,
  collectRuntimeEvents,
  inspectRenderedStage,
  loadFixture,
  sendRuntimeCommand,
  waitForEvent,
  waitForProgressTimeMs,
} from './helpers';

// seek 面（主题一：织网 S16）。fixture: 07-behaviors-seek.kmd。
//
// 钉死三件事：
//  (1) runtimeReady.capabilities === DEFAULT_CAPABILITIES（契约 D1 委托给浏览器层的钉死——
//      node 侧伪造 attach 会掩盖真实行为，故在此钉，见 ReaderRuntimeSession.ts:29-38）。
//  (2) timeMs seek 往返：进度事件反映目标、内容层存活、零错误；behavior 存活性的逻辑层
//      由 playback-pipeline.test.ts [15]-[17] 钉（seek 幂等/cleanup 不堆积），此处钉协议级往返。
//  (3) progressChanged.timeMs 分段单调：段内不减，回落只允许落到 0（多段落脚本段间切换）。
//
// ⚠️ 实现现状钉（超前/落后文档处）：Session.seek 当前只消解 timeMs 与 progress——markerId 等
// 是 android-webview-runtime-protocol.md 的 v1.5 未来字段，传入（无 timeMs/progress 时）触发
// SEEK_TARGET_MISSING 错误事件而非定位。本 spec 钉此现状；协议文档实现现状标注见主题一文档台账。

test('runtimeReady carries the exact DEFAULT_CAPABILITIES', async ({ page }) => {
  await attachRuntimeEventRecorder(page);
  await page.goto('/');
  const ready = await waitForEvent(page, 'runtimeReady');
  expect(ready.payload?.runtime).toBeTruthy();
  expect(ready.payload?.version).toBe(1);
  // 精确对象钉死（ReaderRuntimeSession.ts DEFAULT_CAPABILITIES）：宿主 UI 显隐押在此表。
  expect(ready.payload?.capabilities).toEqual({
    protocolVersion: 1,
    supportsSourceText: true,
    supportsSourceUrl: true,
    supportsAssetManifest: true,
    supportsSeekTime: true,
    supportsTimelineMarkers: true,
    supportsInspection: true,
    supportsInteractiveSegments: false,
  });
});

test('seek by timeMs round-trips; markerId-only seek reports SEEK_TARGET_MISSING (v1 reality)', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadFixture('07-behaviors-seek.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'seek-e2e', title: 'seek e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];
  expect(markers.length, `timeline markers: ${JSON.stringify(markers)}`).toBeGreaterThan(0);

  // 取「// 测试」marker 的时间点作 seek 目标（无则退回 duration 中点）。
  const testMarker = markers.find((marker) => marker.label?.startsWith('// 测试'));
  const durationMs = ready.payload?.durationMs ?? 0;
  const targetTimeMs = testMarker?.timeMs ?? durationMs / 2;
  expect(targetTimeMs).toBeGreaterThan(0);

  // seek 到目标：最近一条 progressChanged 的 timeMs 应落在目标附近（±300ms，含 checkpoint 量化）。
  await sendRuntimeCommand(page, 'seek', { timeMs: targetTimeMs });
  await waitForProgressTimeMs(page, targetTimeMs - 300);
  const afterSeek = await inspectRenderedStage(page);
  expect(afterSeek.contentChildCount).toBeGreaterThan(0);
  expect(afterSeek.contentVisible).toBe(true);

  // seek 回起点：progress 回落，内容层仍存活（seek 往返不破坏场景）。
  await sendRuntimeCommand(page, 'seek', { timeMs: 0 });
  await expect.poll(async () => {
    const events = await collectRuntimeEvents(page);
    const progress = [...events].reverse().find((event) => event.type === 'progressChanged');
    return progress?.payload?.timeMs ?? -1;
  }).toBeLessThanOrEqual(300);
  const afterReturn = await inspectRenderedStage(page);
  expect(afterReturn.contentChildCount).toBeGreaterThan(0);

  // markerId-only seek：v1 实现现状 = SEEK_TARGET_MISSING 错误事件（非定位）。
  await sendRuntimeCommand(page, 'seek', { markerId: 'whatever-marker' });
  await expect.poll(async () => {
    const events = await collectRuntimeEvents(page);
    return events.some((event) => event.type === 'error' && event.payload?.code === 'SEEK_TARGET_MISSING');
  }).toBe(true);

  const runtimeErrors = (await collectRuntimeEvents(page))
    .filter((event) => event.type === 'error' && event.payload?.code !== 'SEEK_TARGET_MISSING');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('progressChanged.timeMs is piecewise monotonic (reset only to 0 at segment switches)', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadFixture('07-behaviors-seek.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'seek-monotonic-e2e', title: 'seek monotonic e2e' },
  });
  await waitForEvent(page, 'ready');

  await sendRuntimeCommand(page, 'updateSettings', { timeScale: 4 });
  await sendRuntimeCommand(page, 'play', {});
  const durationMs = (await waitForEvent(page, 'ready')).payload?.durationMs ?? 0;
  await waitForProgressTimeMs(page, Math.max(1000, durationMs / 2), 20_000);
  await sendRuntimeCommand(page, 'pause', {});

  // 多段落脚本 = 多 segment：ScriptPlayer 段间切换时 timeMs 回 0（新段起点）——这是自然语义，
  // 不是回退。真实契约：段内单调不减，回落只允许落到 0（段切换）。段中途回退 = 回归。
  const timeSeries = (await collectRuntimeEvents(page))
    .filter((event) => event.type === 'progressChanged')
    .map((event) => event.payload?.timeMs ?? 0);
  expect(timeSeries.length).toBeGreaterThan(1);
  let segmentSwitches = 0;
  for (let i = 1; i < timeSeries.length; i++) {
    if (timeSeries[i]! < timeSeries[i - 1]! - 1e-6) {
      expect(
        timeSeries[i],
        `progressChanged.timeMs 回落只允许落到 0（段切换），index ${i}: ${timeSeries[i - 1]} → ${timeSeries[i]}`,
      ).toBeLessThanOrEqual(1e-6);
      segmentSwitches++;
    }
  }
  expect(segmentSwitches, `段切换次数应有限（实际 ${segmentSwitches}）`).toBeLessThanOrEqual(8);

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
