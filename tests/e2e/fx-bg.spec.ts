import { expect, test } from '@playwright/test';
import {
  attachErrorObservers,
  attachRuntimeEventRecorder,
  collectRuntimeEvents,
  inspectRenderedStage,
  loadFixture,
  sendRuntimeCommand,
  stubFixtureAsset,
  waitForEvent,
  waitForProgressTimeMs,
} from './helpers';

test('fx-bg keeps the shared background texture alive across consecutive seeks', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);
  await stubFixtureAsset(page, 'tests/assets/sample-bg.jpg', 'assets/sample-bg.jpg', 'image/jpeg');

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');

  const source = await loadFixture('fx-bg.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'fx-bg-e2e', title: 'fx-bg e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];

  const checkpoints = [
    { labelPrefix: '// B1 + B2 组合', filtered: false },
    { labelPrefix: '// B3: :bg filter', filtered: true },
  ];
  const targetTimes = checkpoints.map(({ labelPrefix }) => {
    const marker = markers.find((candidate) => candidate.label?.startsWith(labelPrefix));
    return marker?.timeMs ?? marker?.startTime;
  });
  expect(targetTimes, `timeline markers: ${JSON.stringify(markers)}`).not.toContain(undefined);

  for (const [targetIndex, timeMs] of (targetTimes as number[]).entries()) {
    await sendRuntimeCommand(page, 'seek', { timeMs });
    await expect.poll(async () => (await inspectRenderedStage(page)).hasBackground).toBe(true);
    // bg(src) resolves asynchronously. Observe the settled sprite rather than the old sprite
    // that may still be mounted during the first microtasks after seek.
    await page.waitForTimeout(500);

    const stage = await inspectRenderedStage(page);
    expect(stage).toMatchObject({
      hasBackground: true,
      spriteDestroyed: false,
      textureDestroyed: false,
      sourceDestroyed: false,
      textureSize: [800, 600],
    });
    expect(stage.backgroundLayerHasSprite).toBe(true);
    expect(stage.contentChildCount).toBeGreaterThan(0);
    expect(stage.contentVisible).toBe(true);
    expect(stage.contentAlpha).toBe(1);
    if (checkpoints[targetIndex]?.filtered) expect(stage.backgroundFilterCount).toBeGreaterThan(0);
  }

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('fx-bg applies settled background profiles during natural playback', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);
  await stubFixtureAsset(page, 'tests/assets/sample-bg.jpg', 'assets/sample-bg.jpg', 'image/jpeg');

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadFixture('fx-bg.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'fx-bg-natural-e2e', title: 'fx-bg natural e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];
  const checkpoints = [
    { labelPrefix: '// B1 + B2 组合', filterName: null },
    { labelPrefix: '// B3: :bg filter', filterName: 'duotone:background' },
    { labelPrefix: '// :bg emboss', filterName: 'emboss:background' },
    { labelPrefix: '// :bg gray +', filterName: 'gray' },
  ].map((checkpoint) => ({
    ...checkpoint,
    timeMs: markers.find((marker) => marker.label?.startsWith(checkpoint.labelPrefix))?.timeMs,
  }));
  expect(checkpoints.map((checkpoint) => checkpoint.timeMs), `timeline markers: ${JSON.stringify(markers)}`)
    .not.toContain(undefined);

  await sendRuntimeCommand(page, 'updateSettings', { timeScale: 4 });
  await sendRuntimeCommand(page, 'play', {});

  let controlScreenshot: Buffer | null = null;
  for (const checkpoint of checkpoints) {
    await waitForProgressTimeMs(page, checkpoint.timeMs! + 250);
    await sendRuntimeCommand(page, 'pause', {});

    if (checkpoint.filterName) {
      await expect.poll(async () => (await inspectRenderedStage(page)).backgroundFilterNames)
        .toEqual([checkpoint.filterName]);
    } else {
      await expect.poll(async () => (await inspectRenderedStage(page)).hasBackground).toBe(true);
      expect((await inspectRenderedStage(page)).backgroundFilterNames).toEqual([]);
    }

    const screenshot = await page.screenshot();
    if (!controlScreenshot) {
      controlScreenshot = screenshot;
    } else {
      expect(screenshot.equals(controlScreenshot)).toBe(false);
    }
    await sendRuntimeCommand(page, 'play', {});
  }

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
