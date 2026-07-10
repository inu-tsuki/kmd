import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(repoRoot, 'apps/editor/public/tests/fx-bg.kmd');
const backgroundPath = path.join(repoRoot, 'apps/editor/public/tests/assets/sample-bg.jpg');

type RuntimeEvent = {
  type: string;
  payload?: {
    durationMs?: number;
    timelineMarkers?: Array<{
      label?: string;
      content?: string;
      line?: number;
      timeMs?: number;
      startTime?: number;
    }>;
    code?: string;
    message?: string;
  };
};

async function sendRuntimeCommand(page: Page, type: string, payload: unknown) {
  await page.evaluate(async ({ commandType, commandPayload }) => {
    await window.KmdRuntime?.receive({
      version: 1,
      id: `e2e-${commandType}-${Date.now()}`,
      type: commandType as any,
      payload: commandPayload as any,
    });
  }, { commandType: type, commandPayload: payload });
}

async function waitForEvent(page: Page, type: string): Promise<RuntimeEvent> {
  const handle = await page.waitForFunction((eventType) => {
    const events = (window as any).__KMD_E2E_EVENTS__ as RuntimeEvent[];
    return events.find((event) => event.type === eventType);
  }, type);
  return handle.jsonValue();
}

async function inspectRenderedStage(page: Page) {
  return page.evaluate(async () => {
    const app = globalThis.__PIXI_APP__;
    if (!app) throw new Error('Pixi app is unavailable');

    const nodes: any[] = [];
    const visit = (node: any) => {
      nodes.push(node);
      for (const child of node?.children ?? []) visit(child);
    };
    visit(app.stage);

    const background = nodes
      .filter((node) => node?.texture?.source)
      .sort((left, right) => (
        (right.texture.width * right.texture.height) - (left.texture.width * left.texture.height)
      ))[0];
    const world = app.stage.children[0];
    const backgroundLayer = world?.children?.[0];
    const contentLayer = world?.children?.[1];
    return {
      hasBackground: Boolean(background),
      spriteDestroyed: background?.destroyed ?? null,
      textureDestroyed: background?.texture?.destroyed ?? null,
      sourceDestroyed: background?.texture?.source?.destroyed ?? null,
      textureSize: background ? [background.texture.width, background.texture.height] : null,
      backgroundLayerHasSprite: backgroundLayer?.children?.includes(background) ?? false,
      contentChildCount: contentLayer?.children?.length ?? 0,
      contentVisible: contentLayer?.visible ?? false,
      contentAlpha: contentLayer?.alpha ?? 0,
      backgroundFilterCount: background?.filters?.length ?? 0,
      backgroundFilterNames: background?.filters?.map((filter: any) => (
        filter?.kmdEffectProfile ?? filter?.glProgram?.name ?? filter?.constructor?.name ?? "unknown"
      )) ?? [],
    };
  });
}

test('fx-bg keeps the shared background texture alive across consecutive seeks', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    (window as any).__KMD_E2E_EVENTS__ = [];
    window.KmdRuntimeConfig = { autoDemo: false };
    window.addEventListener('kmd-runtime-event', (event) => {
      (window as any).__KMD_E2E_EVENTS__.push((event as CustomEvent).detail);
    });
  });
  await page.route('**/tests/assets/sample-bg.jpg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: await fs.readFile(backgroundPath),
    });
  });

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');

  const source = await fs.readFile(fixturePath, 'utf8');
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

  const runtimeErrors = ((await page.evaluate(() => (window as any).__KMD_E2E_EVENTS__)) as RuntimeEvent[])
    .filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('fx-bg applies settled background profiles during natural playback', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    (window as any).__KMD_E2E_EVENTS__ = [];
    window.KmdRuntimeConfig = { autoDemo: false };
    window.addEventListener('kmd-runtime-event', (event) => {
      (window as any).__KMD_E2E_EVENTS__.push((event as CustomEvent).detail);
    });
  });
  await page.route('**/tests/assets/sample-bg.jpg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: await fs.readFile(backgroundPath),
    });
  });

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await fs.readFile(fixturePath, 'utf8');
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
    await page.waitForFunction((targetTime) => {
      const events = (window as any).__KMD_E2E_EVENTS__ as RuntimeEvent[];
      const progress = [...events].reverse().find((event) => event.type === 'progressChanged');
      return (progress?.payload as any)?.timeMs >= targetTime;
    }, checkpoint.timeMs! + 250, { timeout: 15_000 });
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

  const runtimeErrors = ((await page.evaluate(() => (window as any).__KMD_E2E_EVENTS__)) as RuntimeEvent[])
    .filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
