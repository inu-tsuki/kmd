import { expect, test } from '@playwright/test';
import {
  attachErrorObservers,
  attachRuntimeEventRecorder,
  collectRuntimeEvents,
  loadFixture,
  sendRuntimeCommand,
  waitForEvent,
} from './helpers';

// cam 面（主题一：织网 S18）。fixture: 09-stage-commands.kmd。
//
// 观测方式：遍历整棵 stage 树快照每个节点的 position/scale/rotation/pivot，断言 seek 前后
// 树内**存在节点**发生预期量级的变化——与 camera 变换的具体挂载方式解耦。
// 实测映射（StageHostSession.updateWorldTransform，host ticker 驱动）：camera 平移进
// world.**pivot**（designW/2 + camX），position 是常量视口居中；zoom → world.scale；
// rotation → world.rotation。故快照必须含 pivot（首版只测 position/scale/rotation → 平移零信号）。
// camera 变换经 host ticker 应用，seek 后 waitForTimeout 等帧 settle。
// 断言「偏离基线 / 回正基线」不变量，不钉符号与确切值（camera 语义方向属内部约定）。
// shake 双采样非常驻是 node 单元层测不到的 e2e 独有覆盖（resolveComposedCameraState 按
// performance.now() 每帧求值 modifier）。
// cam.focus/cam.drift 由语料 golden（S7: cam-focus.kmd / cam-drift.kmd）在 parser 层覆盖。

type NodeSnapshot = { x: number; y: number; sx: number; rot: number; px: number; py: number };

async function snapshotTree(page: import('@playwright/test').Page): Promise<NodeSnapshot[]> {
  return page.evaluate(() => {
    const app = (globalThis as any).__PIXI_APP__;
    const out: NodeSnapshot[] = [];
    const visit = (node: any) => {
      if (!node) return;
      out.push({
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0,
        sx: node.scale?.x ?? 1,
        rot: node.rotation ?? 0,
        px: node.pivot?.x ?? 0,
        py: node.pivot?.y ?? 0,
      });
      for (const child of node.children ?? []) visit(child);
    };
    visit(app.stage);
    return out;
  });
}

function maxDelta(a: NodeSnapshot[], b: NodeSnapshot[], key: keyof NodeSnapshot): number {
  return Math.max(...a.map((node, i) => Math.abs(node[key] - b[i]![key])));
}

test('camera commands transform the scene; reset restores baseline', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);
  await attachRuntimeEventRecorder(page);

  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');
  const source = await loadFixture('09-stage-commands.kmd');
  await sendRuntimeCommand(page, 'loadScript', {
    source,
    work: { id: 'cam-e2e', title: 'cam e2e' },
  });
  const ready = await waitForEvent(page, 'ready');
  const markers = ready.payload?.timelineMarkers ?? [];
  const at = (prefix: string) => {
    const marker = markers.find((candidate) => candidate.label?.startsWith(prefix));
    expect(marker?.timeMs, `marker ${prefix} in ${JSON.stringify(markers)}`).toBeDefined();
    return marker!.timeMs!;
  };
  const tMove = at('// 镜头平移');
  const tZoom = at('// 镜头缩放');
  const tRotate = at('// 镜头旋转');
  const tShake = at('// 镜头震动');
  const tReset = at('// 重置');

  const seekAndSettle = async (timeMs: number, settleMs = 250) => {
    await sendRuntimeCommand(page, 'seek', { timeMs });
    await page.waitForTimeout(settleMs); // camera 变换经帧循环应用，等 rAF settle
    return snapshotTree(page);
  };

  // 基线树（含 presentation 居中映射——非恒等，后续全部断言相对基线）。
  const baseline = await seekAndSettle(0);
  expect(baseline.length).toBeGreaterThan(2);

  // cam.move(200, 0, 1s)：marker + 1.1s settle 后，树内存在节点 pivot 显著偏移。
  const afterMove = await seekAndSettle(tMove + 1100);
  expect(afterMove.length).toBe(baseline.length);
  expect(maxDelta(baseline, afterMove, 'px')).toBeGreaterThan(50);

  // cam.zoom(0.8, 1s)：树内存在节点 scale 显著偏离基线。
  const afterZoom = await seekAndSettle(tZoom + 1100);
  expect(maxDelta(baseline, afterZoom, 'sx')).toBeGreaterThan(0.05);

  // cam.rotate(15, 1s)：树内存在节点 rotation 显著偏离（15° ≈ 0.26 rad）。
  const afterRotate = await seekAndSettle(tRotate + 1100);
  expect(maxDelta(baseline, afterRotate, 'rot')).toBeGreaterThan(0.1);

  // cam.shake(10)：modifier 经 replay 注册、浏览器 rAF 驱动 → 120ms 间隔双采样树非常驻。
  await sendRuntimeCommand(page, 'seek', { timeMs: tShake + 300 });
  await expect.poll(async () => {
    const sampleA = await snapshotTree(page);
    await page.waitForTimeout(120);
    const sampleB = await snapshotTree(page);
    return (
      maxDelta(sampleA, sampleB, 'px') > 1e-3 ||
      maxDelta(sampleA, sampleB, 'py') > 1e-3 ||
      maxDelta(sampleA, sampleB, 'rot') > 1e-6
    );
  }, { timeout: 5_000 }).toBe(true);

  // cam.reset(1.5s)（INV-7 清场边界）：marker + 1.6s settle → 全树回基线（shake modifier 亦被清）。
  const afterReset = await seekAndSettle(tReset + 1600, 350);
  expect(afterReset.length).toBe(baseline.length);
  expect(maxDelta(baseline, afterReset, 'x')).toBeLessThan(0.01);
  expect(maxDelta(baseline, afterReset, 'y')).toBeLessThan(0.01);
  expect(maxDelta(baseline, afterReset, 'sx')).toBeLessThan(0.01);
  expect(maxDelta(baseline, afterReset, 'rot')).toBeLessThan(0.01);
  expect(maxDelta(baseline, afterReset, 'px')).toBeLessThan(0.01);
  expect(maxDelta(baseline, afterReset, 'py')).toBeLessThan(0.01);

  const runtimeErrors = (await collectRuntimeEvents(page)).filter((event) => event.type === 'error');
  expect(runtimeErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
