// e2e 共享 helpers（主题一：织网 S5）。
//
// 纯重构自 fx-bg.spec.ts 的三个 file-local helper（sendRuntimeCommand / waitForEvent /
// inspectRenderedStage）+ 两个测试重复的 addInitScript 块，外加新通用件（loadFixture /
// stubFixtureAsset / attachErrorObservers / collectRuntimeEvents / waitForProgressTimeMs），
// 供 seek / scene-clear / cam / premultiply-probe 等后续 spec 复用。
//
// 约定（docs/knowledge/runtime/browser-e2e.md "Test Boundary"）：
//   - 控制面只走协议（window.KmdRuntime.receive 信封），不直接戳 runtime 内部；
//   - 观测面走 __PIXI_APP__ 只读快照与 kmd-runtime-event 事件流；
//   - 断言用稳定契约面（kmdEffectProfile / 变换原语），不断构造函数名与像素基线
//     （premultiply-probe 的像素读回是唯一例外——它验证的正是像素层事实）。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const testsDir = path.join(repoRoot, 'apps/editor/public/tests');

export type RuntimeEvent = {
  type: string;
  payload?: {
    durationMs?: number;
    timeMs?: number;
    progress?: number;
    timelineMarkers?: Array<{
      label?: string;
      content?: string;
      line?: number;
      timeMs?: number;
      startTime?: number;
    }>;
    capabilities?: Record<string, unknown>;
    runtime?: string;
    version?: number;
    isPlaying?: boolean;
    state?: string;
    code?: string;
    message?: string;
  };
};

/** 读 apps/editor/public/tests/ 下的 fixture 源文件。 */
export async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(testsDir, name), 'utf8');
}

/** fixture 语料引用的测试资产（不打进 reader bundle，经 page.route 旁路供给）。 */
export function fixtureAssetPath(relative: string): string {
  return path.join(testsDir, relative);
}

/** 旁路供给测试资产：url 后缀匹配 → 以本地文件 fulfill。 */
export async function stubFixtureAsset(
  page: Page,
  urlSuffix: string,
  relativePath: string,
  contentType: string,
): Promise<void> {
  await page.route(`**/${urlSuffix}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType,
      body: await fs.readFile(fixtureAssetPath(relativePath)),
    });
  });
}

/**
 * 注入事件录制器（addInitScript，须在 page.goto 之前）：
 * __KMD_E2E_EVENTS__ 数组 + autoDemo 关闭 + kmd-runtime-event CustomEvent 订阅。
 */
export async function attachRuntimeEventRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__KMD_E2E_EVENTS__ = [];
    window.KmdRuntimeConfig = { autoDemo: false };
    window.addEventListener('kmd-runtime-event', (event) => {
      (window as any).__KMD_E2E_EVENTS__.push((event as CustomEvent).detail);
    });
  });
}

/** 协议命令信封发送（version 1，e2e-<type>-<ts> id）。 */
export async function sendRuntimeCommand(page: Page, type: string, payload: unknown): Promise<void> {
  await page.evaluate(async ({ commandType, commandPayload }) => {
    await window.KmdRuntime?.receive({
      version: 1,
      id: `e2e-${commandType}-${Date.now()}`,
      type: commandType as any,
      payload: commandPayload as any,
    });
  }, { commandType: type, commandPayload: payload });
}

/** 等待首个指定类型事件（轮询 __KMD_E2E_EVENTS__）。 */
export async function waitForEvent(page: Page, type: string): Promise<RuntimeEvent> {
  const handle = await page.waitForFunction((eventType) => {
    const events = (window as any).__KMD_E2E_EVENTS__ as RuntimeEvent[];
    return events.find((event) => event.type === eventType);
  }, type);
  return handle.jsonValue();
}

/** 等待最近一条 progressChanged 的 timeMs 到达阈值（自然播放观察点）。 */
export async function waitForProgressTimeMs(page: Page, timeMs: number, timeout = 15_000): Promise<void> {
  await page.waitForFunction((targetTime) => {
    const events = (window as any).__KMD_E2E_EVENTS__ as RuntimeEvent[];
    const progress = [...events].reverse().find((event) => event.type === 'progressChanged');
    return (progress?.payload as any)?.timeMs >= targetTime;
  }, timeMs, { timeout });
}

/** 读回全部已录制事件。 */
export async function collectRuntimeEvents(page: Page): Promise<RuntimeEvent[]> {
  return (await page.evaluate(() => (window as any).__KMD_E2E_EVENTS__)) as RuntimeEvent[];
}

/** 挂载 pageerror / console error 观察器，返回累积数组（收尾 toEqual([]) 用）。 */
export function attachErrorObservers(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

/** Pixi stage 只读快照（world = stage.children[0]，backgroundLayer/contentLayer 为其 children[0]/[1]）。 */
export async function inspectRenderedStage(page: Page) {
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
