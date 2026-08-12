import { expect, test } from '@playwright/test';
import {
  attachErrorObservers,
  attachRuntimeEventRecorder,
  collectRuntimeEvents,
  loadExample,
  sendRuntimeCommand,
  waitForEvent,
  waitForProgressTimeMs,
} from './helpers';

type RenderProbe = {
  filterCount: number;
  filteredNodeCount: number;
  maxFrameGapMs: number;
};

async function probeSeek(
  page: import('@playwright/test').Page,
  timeMs: number,
): Promise<RenderProbe> {
  await page.evaluate(() => {
    (globalThis as any).__KMD_PROBE_FRAMES__ = [];
  });
  await sendRuntimeCommand(page, 'seek', { timeMs });
  await page.waitForTimeout(750);

  return page.evaluate(() => {
    const app = (globalThis as any).__PIXI_APP__;
    const nodes: any[] = [];
    const visit = (node: any) => {
      nodes.push(node);
      for (const child of node?.children ?? []) visit(child);
    };
    visit(app.stage);

    const frames = (globalThis as any).__KMD_PROBE_FRAMES__ as number[];
    let maxFrameGapMs = 0;
    for (let index = 1; index < frames.length; index += 1) {
      maxFrameGapMs = Math.max(maxFrameGapMs, frames[index]! - frames[index - 1]!);
    }

    return {
      filterCount: nodes.reduce((sum, node) => sum + (node?.filters?.length ?? 0), 0),
      filteredNodeCount: nodes.filter((node) => (node?.filters?.length ?? 0) > 0).length,
      maxFrameGapMs,
    };
  });
}

async function probeNatural(
  page: import('@playwright/test').Page,
  startTimeMs: number,
  endTimeMs: number,
): Promise<RenderProbe> {
  await sendRuntimeCommand(page, 'seek', { timeMs: Math.max(0, startTimeMs - 50) });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    (globalThis as any).__KMD_PROBE_FRAMES__ = [];
  });
  await sendRuntimeCommand(page, 'updateSettings', { timeScale: 1 });
  await sendRuntimeCommand(page, 'play', {});
  await waitForProgressTimeMs(page, endTimeMs, 5_000);
  await sendRuntimeCommand(page, 'pause', {});

  return page.evaluate(() => {
    const app = (globalThis as any).__PIXI_APP__;
    const nodes: any[] = [];
    const visit = (node: any) => {
      nodes.push(node);
      for (const child of node?.children ?? []) visit(child);
    };
    visit(app.stage);
    const frames = (globalThis as any).__KMD_PROBE_FRAMES__ as number[];
    return {
      filterCount: nodes.reduce((sum, node) => sum + (node?.filters?.length ?? 0), 0),
      filteredNodeCount: nodes.filter((node) => (node?.filters?.length ?? 0) > 0).length,
      maxFrameGapMs: frames.slice(1).reduce(
        (max, time, index) => Math.max(max, time - frames[index]!),
        0,
      ),
    };
  });
}

test('cyberpunk title chains keep first-frame filter fan-out bounded', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);
  await page.addInitScript(() => {
    (globalThis as any).__KMD_PROBE_FRAMES__ = [];
    const tick = (time: number) => {
      (globalThis as any).__KMD_PROBE_FRAMES__.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadExample('cyberpunk/cyber-crt-blacksite.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'cyberpunk-performance-e2e', title: 'cyberpunk performance e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];
  const markerTime = (needle: string) => {
    const marker = markers.find((candidate) => candidate.label?.includes(needle));
    expect(marker?.timeMs, `marker ${needle} in ${JSON.stringify(markers)}`).toBeDefined();
    return marker!.timeMs!;
  };

  // speed=34ms/char；+50ms 锁定首字阶段，验证 :group filter 不等待 token-end。
  // +900ms 再覆盖 20–23 字标题的末字，验证容器滤镜没有随揭示过程重复堆积。
  const blacksiteStart = markerTime('BLACKSITE TERMINAL ONLINE');
  const blacksiteFirstGlyph = await probeSeek(page, blacksiteStart + 50);
  const blacksite = await probeSeek(page, blacksiteStart + 900);
  const countermeasure = await probeSeek(page, markerTime('COUNTERMEASURE ACTIVE') + 900);
  const coordinates = await probeSeek(page, markerTime('COORDINATES EXTRACTED') + 900);
  const blacksiteNatural = await probeNatural(page, blacksiteStart, blacksiteStart + 900);

  console.log('[cyberpunk-performance]', {
    blacksiteFirstGlyph,
    blacksite,
    countermeasure,
    coordinates,
    blacksiteNatural,
  });

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // 数量门禁故意留有少量容器/场景累积余量：回归前三个 seek 点依次为
  // 43 / 175 / 282 个 filter。帧间隔作为诊断数据输出，不设硬阈值，避免 CI 负载
  // 把性能探针变成时序假阳性。
  expect(blacksiteFirstGlyph.filterCount).toBeGreaterThan(0);
  expect(blacksiteFirstGlyph.filterCount).toBeLessThanOrEqual(8);
  expect(blacksiteFirstGlyph.filteredNodeCount).toBeLessThanOrEqual(3);
  expect(blacksite.filterCount).toBeLessThanOrEqual(8);
  expect(countermeasure.filterCount).toBeLessThanOrEqual(24);
  expect(coordinates.filterCount).toBeLessThanOrEqual(32);
  expect(blacksiteNatural.filterCount).toBeLessThanOrEqual(8);
  expect(blacksiteNatural.filteredNodeCount).toBeLessThanOrEqual(3);
});
