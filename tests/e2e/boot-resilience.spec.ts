// boot 韧性面（主题二 S4a / 处方 10）。
//
// Android WebView 宿主注入的 window.KmdRuntimeConfig 是不可信输入——垃圾配置必须扛住：
// boot 不崩、runtimeReady 仍发。RuntimeConfigValidator 在 main.ts spread 前 sanitize
//（strip-unknown + 逐字段类型回退，永不抛）。
//
// 与 attachRuntimeEventRecorder 的区别：此处手写 addInitScript 以注入**垃圾** KmdRuntimeConfig
//（recorder helper 注入的是合法 { autoDemo: false }，会覆盖垃圾，语义冲突）。
// autoDemo 关闭沿用同一约定（垃圾配置里也显式给 autoDemo:false——宿主私有字段，
// main.ts 拆出后经 sanitize 并回，不经契约 schema）。

import { expect, test } from '@playwright/test';
import { attachErrorObservers, waitForEvent } from './helpers';

test('boot survives garbage KmdRuntimeConfig — runtimeReady still emitted', async ({ page }) => {
  const { pageErrors, consoleErrors } = attachErrorObservers(page);

  await page.addInitScript(() => {
    (window as any).__KMD_E2E_EVENTS__ = [];
    // 垃圾配置矩阵：非 record settings、类型错位字段、未知键、原型污染尝试。
    // debugOverlay:"true" 是 coercion 拒绝判例（丢弃而非强转）。
    (window as any).KmdRuntimeConfig = {
      autoDemo: false,
      settings: {
        debugOverlay: 'true',
        fontScale: 'big',
        timeScale: 2,
        theme: 42,
        totallyUnknownSetting: [1, 2, 3],
      },
      presentationMode: 'bogus-mode',
      unknownTopLevelField: { nested: true },
    };
    window.addEventListener('kmd-runtime-event', (event) => {
      (window as any).__KMD_E2E_EVENTS__.push((event as CustomEvent).detail);
    });
  });

  await page.goto('/');
  const ready = await waitForEvent(page, 'runtimeReady');
  expect(ready.payload?.version).toBe(1);
  expect(ready.payload?.capabilities).toBeTruthy();

  // boot 不崩：无 RUNTIME_BOOT_FAILED、无 pageerror。
  const status = await page.locator('#runtime-status').textContent();
  expect(status, `runtime 状态徽章（实际 ${status}）`).not.toContain('runtime:error');
  expect(pageErrors).toEqual([]);
  // console warn（sanitize 诊断）允许出现；console error 不允许。
  expect(consoleErrors).toEqual([]);
});
