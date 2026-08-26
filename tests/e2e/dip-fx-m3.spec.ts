import { expect, test, type Page } from '@playwright/test';
import {
  attachErrorObservers,
  attachRuntimeEventRecorder,
  collectRuntimeEvents,
  loadExample,
  sendRuntimeCommand,
  stubFixtureAsset,
  waitForEvent,
  waitForProgressTimeMs,
  type RuntimeEvent,
} from './helpers';

// DIP-FX M3 的 production-reader 作品 smoke。
//
// 控制面只走 Reader Runtime v1 协议；观测面只读 __PIXI_APP__ display tree。这里钉的是
// 可自动化的工程事实：七个镜头被自然播放经过、背景 profile/纹理存活、seek 往返不堆 filter、
// 同源 reload 经 ScriptPlayer.stop() teardown 后可再次播放、全程零 runtime/page/console error。
// “镜头是否好看、运动叙事是否清楚”仍需真实浏览器人工审计，不把 filter 数量当视觉质量。

type TimelineMarker = NonNullable<RuntimeEvent['payload']>['timelineMarkers'] extends Array<infer T>
  ? T
  : never;

type FxStageSnapshot = {
  contentChildCount: number;
  filterCount: number;
  filteredNodeCount: number;
  maxFiltersPerNode: number;
  hasBackground: boolean;
  backgroundFilterProfiles: string[];
  backgroundSpriteDestroyed: boolean | null;
  backgroundTextureDestroyed: boolean | null;
  backgroundSourceDestroyed: boolean | null;
};

type SeekExpectation =
  | { backgroundProfile: string }
  | { noBackground: true; minFilterCount: number };

function sceneMarkers(ready: RuntimeEvent): TimelineMarker[] {
  const markers = ready.payload?.timelineMarkers ?? [];
  return Array.from({ length: 7 }, (_, index) => {
    const scene = index + 1;
    // 每幕的注释、舞台命令和标题属于同一 paragraph；marker label 因而是首行注释，
    // duration 则覆盖正文打字。视觉 checkpoint 必须使用这份完整 duration（见下方）。
    const marker = markers.find((candidate) => candidate.label?.includes(`镜头 ${scene}`));
    expect(marker?.timeMs, `镜头 ${scene} marker in ${JSON.stringify(markers)}`).toBeDefined();
    return marker!;
  });
}

function checkpointTime(marker: TimelineMarker): number {
  const duration = marker.duration ?? 1_000;
  // 每个非 clear paragraph 后有 2s 展示留白；完整打字后再留 750ms 观察 behavior，
  // 同时仍距下一次 scene.clear 至少 1.25s。
  return marker.timeMs! + duration + 750;
}

async function inspectFxStage(page: Page): Promise<FxStageSnapshot> {
  return page.evaluate(() => {
    const app = globalThis.__PIXI_APP__;
    if (!app) throw new Error('Pixi app is unavailable');

    const world = app.stage.children[0];
    const backgroundLayer = world?.children?.[0];
    const contentLayer = world?.children?.[1];
    const nodes: any[] = [];
    const visit = (node: any) => {
      if (!node) return;
      nodes.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(app.stage);

    const filtersByNode = nodes.map((node) => node?.filters ?? []);
    // bg(src) 的 sprite 不承诺是 backgroundLayer 的直接 child。与共享 e2e probe
    // 一致，递归寻找面积最大的纹理节点，避免把 Pixi display-tree 形状误当协议契约。
    const background = nodes
      .filter((node) => node?.texture?.source)
      .sort((left, right) => (
        (right.texture.width * right.texture.height) - (left.texture.width * left.texture.height)
      ))[0];
    return {
      contentChildCount: contentLayer?.children?.length ?? 0,
      filterCount: filtersByNode.reduce((sum, filters) => sum + filters.length, 0),
      filteredNodeCount: filtersByNode.filter((filters) => filters.length > 0).length,
      maxFiltersPerNode: filtersByNode.reduce((max, filters) => Math.max(max, filters.length), 0),
      hasBackground: Boolean(background),
      backgroundFilterProfiles: background?.filters?.map((filter: any) => (
        filter?.kmdEffectProfile ?? 'unprofiled'
      )) ?? [],
      backgroundSpriteDestroyed: background?.destroyed ?? null,
      backgroundTextureDestroyed: background?.texture?.destroyed ?? null,
      backgroundSourceDestroyed: background?.texture?.source?.destroyed ?? null,
    };
  });
}

async function waitForPresentationFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

async function rememberMountedFilters(page: Page, key: string): Promise<number> {
  return page.evaluate((probeKey) => {
    const app = globalThis.__PIXI_APP__;
    const filters: any[] = [];
    const visit = (node: any) => {
      filters.push(...(node?.filters ?? []));
      for (const child of node?.children ?? []) visit(child);
    };
    visit(app?.stage);
    const probes = ((globalThis as any).__KMD_M3_FILTER_PROBES__ ??= {});
    probes[probeKey] = filters;
    return filters.length;
  }, key);
}

async function mountedFilterOverlap(page: Page, key: string): Promise<number> {
  return page.evaluate((probeKey) => {
    const previous = new Set<any>((globalThis as any).__KMD_M3_FILTER_PROBES__?.[probeKey] ?? []);
    const current: any[] = [];
    const visit = (node: any) => {
      current.push(...(node?.filters ?? []));
      for (const child of node?.children ?? []) visit(child);
    };
    visit(globalThis.__PIXI_APP__?.stage);
    return current.filter((filter) => previous.has(filter)).length;
  }, key);
}

async function eventCount(page: Page, type: string, state?: string): Promise<number> {
  return page.evaluate(({ eventType, playbackState }) => {
    const events = (globalThis as any).__KMD_E2E_EVENTS__ as RuntimeEvent[];
    return events.filter((event) => (
      event.type === eventType
      && (playbackState === undefined || event.payload?.state === playbackState)
    )).length;
  }, { eventType: type, playbackState: state });
}

async function waitForNextEvent(
  page: Page,
  type: string,
  previousCount: number,
  state?: string,
): Promise<RuntimeEvent> {
  const handle = await page.waitForFunction(({ eventType, before, playbackState }) => {
    const events = (globalThis as any).__KMD_E2E_EVENTS__ as RuntimeEvent[];
    const matches = events.filter((event) => (
      event.type === eventType
      && (playbackState === undefined || event.payload?.state === playbackState)
    ));
    return matches.length > before ? matches.at(-1) : undefined;
  }, { eventType: type, before: previousCount, playbackState: state });
  return handle.jsonValue();
}

async function settleAt(
  page: Page,
  marker: TimelineMarker,
  expected: SeekExpectation,
): Promise<FxStageSnapshot> {
  await sendRuntimeCommand(page, 'seek', { timeMs: checkpointTime(marker) });

  if ('backgroundProfile' in expected) {
    await expect.poll(async () => {
      const snapshot = await inspectFxStage(page);
      return {
        hasBackground: snapshot.hasBackground,
        profiles: snapshot.backgroundFilterProfiles,
        spriteAlive: snapshot.backgroundSpriteDestroyed === false,
        textureAlive: snapshot.backgroundTextureDestroyed === false,
        sourceAlive: snapshot.backgroundSourceDestroyed === false,
      };
    }, { message: `background profile ${expected.backgroundProfile} becomes live after seek` }).toEqual({
      hasBackground: true,
      profiles: [expected.backgroundProfile],
      spriteAlive: true,
      textureAlive: true,
      sourceAlive: true,
    });
  } else {
    await expect.poll(async () => {
      const snapshot = await inspectFxStage(page);
      return {
        hasBackground: snapshot.hasBackground,
        enoughFilters: snapshot.filterCount >= expected.minFilterCount,
        hasContent: snapshot.contentChildCount > 0,
      };
    }, { message: 'color-background scene replaces any async texture and mounts expected filters' }).toEqual({
      hasBackground: false,
      enoughFilters: true,
      hasContent: true,
    });
  }

  return inspectFxStage(page);
}

function expectNoErrors(events: RuntimeEvent[], pageErrors: string[], consoleErrors: string[]) {
  expect(events.filter((event) => event.type === 'error')).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

test('cyberpunk title completes natural playback and can replay from ended', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);
  await stubFixtureAsset(page, 'tests/assets/sample-bg.jpg', 'assets/sample-bg.jpg', 'image/jpeg');

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadExample('cyberpunk/fx-cyberpunk-title.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'dip-fx-m3-natural-e2e', title: 'DIP-FX M3 natural e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = sceneMarkers(ready);
  const endedBefore = await eventCount(page, 'playbackStateChanged', 'ended');

  await sendRuntimeCommand(page, 'updateSettings', { timeScale: 4 });
  await sendRuntimeCommand(page, 'play', {});

  const snapshots: FxStageSnapshot[] = [];
  for (const [index, marker] of markers.entries()) {
    await waitForProgressTimeMs(page, checkpointTime(marker), 30_000);
    await sendRuntimeCommand(page, 'pause', {});
    // pause 冻结 segment timeline，但 gravity/wave 等 realtime behavior 仍由 GSAP ticker 推进。
    // 这里只等两个 RAF 让协议状态与 presentation 刷新，随即取样；不声称画面已“settled”。
    await waitForPresentationFrames(page);
    snapshots.push(await inspectFxStage(page));
    // Human-review artifact only: never used as a pixel assertion.
    await page.screenshot({
      path: testInfo.outputPath(`dip-fx-m3-scene-${String(index + 1).padStart(2, '0')}.png`),
    });
    await sendRuntimeCommand(page, 'play', {});
  }
  await waitForNextEvent(page, 'playbackStateChanged', endedBefore, 'ended');

  // 自然播放 checkpoint 验证“确实经过且当场有内容”，异步 bg(src) 的 profile 契约由下方
  // 确定性 seek predicate 独立验证，不把资源完成时序绑死在视觉截图瞬间。
  for (const [index, snapshot] of snapshots.entries()) {
    expect(snapshot.contentChildCount, `镜头 ${index + 1} content`).toBeGreaterThan(0);
    // char filter 的总数随标题字数线性增长；约束总 fan-out 防止失控，同时用下一条断言
    // 钉住真正的逐节点堆叠上限。
    expect(snapshot.filterCount, `镜头 ${index + 1} filter fan-out`).toBeLessThanOrEqual(64);
    expect(snapshot.maxFiltersPerNode, `镜头 ${index + 1} per-node filters`).toBeLessThanOrEqual(4);
  }

  // ended -> play 是 production replay 契约：同一 segment 清理 record-driven 资源、seek(0) 后重播。
  const playingBeforeReplay = await eventCount(page, 'playbackStateChanged', 'playing');
  await sendRuntimeCommand(page, 'play', {});
  await waitForNextEvent(page, 'playbackStateChanged', playingBeforeReplay, 'playing');
  await waitForProgressTimeMs(page, checkpointTime(markers[0]!), 10_000);
  await sendRuntimeCommand(page, 'pause', {});
  await waitForPresentationFrames(page);
  const replay = await inspectFxStage(page);
  expect(replay.contentChildCount).toBeGreaterThan(0);
  expect(replay.filterCount).toBeLessThanOrEqual(64);
  expect(replay.maxFiltersPerNode).toBeLessThanOrEqual(4);

  expectNoErrors(await collectRuntimeEvents(page), pageErrors, consoleErrors);
});

test('cyberpunk title survives backward/forward seeks and stop-path reload without filter reuse', async ({ page }) => {
  test.setTimeout(45_000);
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);
  await stubFixtureAsset(page, 'tests/assets/sample-bg.jpg', 'assets/sample-bg.jpg', 'image/jpeg');

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadExample('cyberpunk/fx-cyberpunk-title.kmd');
  const load = () => sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'dip-fx-m3-seek-e2e', title: 'DIP-FX M3 seek e2e' },
  });
  await load();
  let ready = await waitForEvent(page, 'ready');
  let markers = sceneMarkers(ready);

  const duotone = await settleAt(page, markers[0]!, { backgroundProfile: 'duotone:background' });
  expect(duotone).toMatchObject({
    hasBackground: true,
    backgroundFilterProfiles: ['duotone:background'],
    backgroundSpriteDestroyed: false,
    backgroundTextureDestroyed: false,
    backgroundSourceDestroyed: false,
  });

  const underwaterA = await settleAt(page, markers[3]!, { noBackground: true, minFilterCount: 3 });
  expect(underwaterA.filterCount).toBeGreaterThanOrEqual(3);
  expect(underwaterA.maxFiltersPerNode).toBeLessThanOrEqual(4);
  expect(await rememberMountedFilters(page, 'underwater-a')).toBe(underwaterA.filterCount);

  const emboss = await settleAt(page, markers[5]!, { backgroundProfile: 'emboss:background' });
  expect(emboss).toMatchObject({
    hasBackground: true,
    backgroundFilterProfiles: ['emboss:background'],
    backgroundTextureDestroyed: false,
    backgroundSourceDestroyed: false,
  });
  expect(await mountedFilterOverlap(page, 'underwater-a')).toBe(0);

  const crt = await settleAt(page, markers[1]!, { noBackground: true, minFilterCount: 3 }); // backward seek across scene.clear
  expect(crt.hasBackground).toBe(false);
  expect(crt.filterCount).toBeGreaterThanOrEqual(3);
  expect(crt.filterCount).toBeLessThanOrEqual(32);

  const underwaterB = await settleAt(page, markers[3]!, { noBackground: true, minFilterCount: 3 }); // forward again
  expect(underwaterB.filterCount).toBe(underwaterA.filterCount);
  expect(underwaterB.filteredNodeCount).toBe(underwaterA.filteredNodeCount);
  expect(await mountedFilterOverlap(page, 'underwater-a')).toBe(0);
  await rememberMountedFilters(page, 'before-reload');

  // Reader Runtime v1 没有公开 stop command。同源 loadScript 是 production 可达的 stop 路径：
  // ReaderRuntimeSession.loadScript -> ScriptPlayer.loadSourceContent -> stop({ suppressIdle:true })。
  // 因此这里验证真实 teardown + rebuild，而非直接戳 ScriptPlayer singleton。
  const readyBeforeReload = await eventCount(page, 'ready');
  await load();
  ready = await waitForNextEvent(page, 'ready', readyBeforeReload);
  markers = sceneMarkers(ready);
  expect(await mountedFilterOverlap(page, 'before-reload')).toBe(0);

  const underwaterAfterReload = await settleAt(
    page,
    markers[3]!,
    { noBackground: true, minFilterCount: 3 },
  );
  expect(underwaterAfterReload.filterCount).toBe(underwaterA.filterCount);
  expect(underwaterAfterReload.filteredNodeCount).toBe(underwaterA.filteredNodeCount);
  expect(underwaterAfterReload.maxFiltersPerNode).toBeLessThanOrEqual(4);

  // reload 已经走过 production stop teardown；再向前 seek，证明新 segment 的背景 profile
  // 能从 record 重建。ended -> replay 的状态机契约由上一条用例独立覆盖。
  const duotoneAfterReload = await settleAt(
    page,
    markers[0]!,
    { backgroundProfile: 'duotone:background' },
  );
  expect(duotoneAfterReload.backgroundFilterProfiles).toEqual(['duotone:background']);
  expect(duotoneAfterReload.backgroundTextureDestroyed).toBe(false);

  expectNoErrors(await collectRuntimeEvents(page), pageErrors, consoleErrors);
});
