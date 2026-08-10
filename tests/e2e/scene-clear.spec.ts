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

// scene.clear 面（主题一：织网 S17）。fixture: fx-bloom.kmd（5 节，`---` 场景分隔）。
//
// `---` lowering 为 scene.clear + 隐式 pause(0.5)（parser lowering.ts:108-125）。
// 钉死：跨 `---` seek 两侧内容层都存活且可见、backgroundLayer 连续、零错误事件；
// 自然播放跨越场景边界无 pageerror/console error（scene.clear 的淡出/重建在真实渲染下不崩）。
// settle 态断言用 expect.poll/waitForTimeout，不断补间中间值（browser-e2e.md 约定）。

test('seek across scene-clear boundaries keeps content and background layer alive', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadFixture('fx-bloom.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'scene-clear-e2e', title: 'scene-clear e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];
  const sectionA = markers.find((marker) => marker.label?.startsWith('// block 作用域'));
  const sectionB = markers.find((marker) => marker.label?.startsWith('// 改参强辉光'));
  const sectionC = markers.find((marker) => marker.label?.startsWith('// 白字黑底'));
  expect(
    [sectionA?.timeMs, sectionB?.timeMs, sectionC?.timeMs],
    `timeline markers: ${JSON.stringify(markers)}`,
  ).not.toContain(undefined);

  // A 节（第一场景）：内容存活、可见。
  await sendRuntimeCommand(page, 'seek', { timeMs: sectionA!.timeMs! + 200 });
  await expect.poll(async () => (await inspectRenderedStage(page)).contentChildCount).toBeGreaterThan(0);
  const stageA = await inspectRenderedStage(page);
  expect(stageA.contentVisible).toBe(true);

  // 跨第一个 `---` 到 B 节：scene.clear 后新内容重建，内容层仍存活、可见。
  await sendRuntimeCommand(page, 'seek', { timeMs: sectionB!.timeMs! + 200 });
  await page.waitForTimeout(700); // scene.clear 淡出 + 隐式 pause(0.5) 后 settle
  const stageB = await inspectRenderedStage(page);
  expect(stageB.contentChildCount).toBeGreaterThan(0);
  expect(stageB.contentVisible).toBe(true);

  // 再跨一个 `---` 到 C 节：连续场景清除后 backgroundLayer 结构连续（world 首子节点仍在）。
  await sendRuntimeCommand(page, 'seek', { timeMs: sectionC!.timeMs! + 200 });
  await page.waitForTimeout(700);
  const stageC = await inspectRenderedStage(page);
  expect(stageC.contentChildCount).toBeGreaterThan(0);
  const worldIntact = await page.evaluate(() => {
    const app = globalThis.__PIXI_APP__;
    const world = app?.stage?.children?.[0];
    return {
      worldExists: Boolean(world),
      childCount: world?.children?.length ?? 0,
    };
  });
  expect(worldIntact.worldExists).toBe(true);
  expect(worldIntact.childCount).toBeGreaterThanOrEqual(2); // backgroundLayer + contentLayer

  // 回 seek 到 A 节：往返后仍存活（scene.clear 可逆，不累积坏状态）。
  await sendRuntimeCommand(page, 'seek', { timeMs: sectionA!.timeMs! + 200 });
  await page.waitForTimeout(700);
  const stageReturn = await inspectRenderedStage(page);
  expect(stageReturn.contentChildCount).toBeGreaterThan(0);
  expect(stageReturn.contentVisible).toBe(true);

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('natural playback across scene-clear boundaries produces no errors', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadFixture('fx-bloom.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'scene-clear-natural-e2e', title: 'scene-clear natural e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];
  const sectionC = markers.find((marker) => marker.label?.startsWith('// 白字黑底'));
  expect(sectionC?.timeMs, `timeline markers: ${JSON.stringify(markers)}`).toBeDefined();

  // 4x 速自然播放跨越前两个场景边界到 C 节：淡出/重建在真实 ticker 驱动下无崩。
  await sendRuntimeCommand(page, 'updateSettings', { timeScale: 4 });
  await sendRuntimeCommand(page, 'play', {});
  await waitForProgressTimeMs(page, sectionC!.timeMs! + 250, 20_000);
  await sendRuntimeCommand(page, 'pause', {});

  const stage = await inspectRenderedStage(page);
  expect(stage.contentChildCount).toBeGreaterThan(0);
  expect(stage.contentVisible).toBe(true);

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
