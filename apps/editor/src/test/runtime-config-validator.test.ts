// RuntimeConfigValidator 防火墙回归（主题二 S4a / 处方 10）。
//
// 失败语义（用户裁决）：strip-unknown + 逐字段类型回退 + 诊断，永不抛；
// 不做语义 coercion（debugOverlay:"true" 丢弃而非强转）。
//
// 覆盖：
//   - settings 垃圾输入矩阵（非 record 根、逐字段回退、未知键剥离、coercion 拒绝、
//     嵌套子树逐字段、禁止键剥离、合法配置字节相等透传）
//   - boot config（options）同语义 + settings 子树不连坐 + 宿主扩展字段剥离
//
// 诚实边界：诊断消息格式不做逐字断言（只断言关键字存在）——消息是运维提示面，
// 措辞演进不应锁死测试；字段保留/剥离行为才是契约。

import { describe, it, expect } from 'vitest';
import {
  sanitizeKmdRuntimeConfig,
  sanitizeReaderRuntimeSettings,
} from '@kmd/core/runtime/RuntimeConfigValidator';

describe('sanitizeReaderRuntimeSettings 垃圾输入矩阵', () => {
  it('合法配置字节相等透传（无诊断）', () => {
    const input = {
      reducedMotion: true,
      fontScale: 1.25,
      timeScale: 2,
      theme: 'dark',
      quality: 'balanced',
      interactionEnabled: false,
      debugOverlay: true,
      typography: { fontFamily: 'Sasara Regular', fontSize: 24, align: 'center' },
      viewport: { width: 1920, height: 1080, devicePixelRatio: 2 },
      presentationMode: 'stage',
      assetBaseUrl: './assets/',
      fontManifest: [{ family: 'Sasara Regular', url: './fonts/sasara.ttf' }],
    };
    const { value, diagnostics } = sanitizeReaderRuntimeSettings(input);
    expect(value).toEqual(input);
    expect(diagnostics).toEqual([]);
  });

  it('非 record 根 → 空配置 + 诊断，永不抛', () => {
    for (const garbage of [null, undefined, 42, 'settings', [1, 2], true]) {
      const { value, diagnostics } = sanitizeReaderRuntimeSettings(garbage);
      expect(value, `输入 ${String(garbage)}`).toEqual({});
      expect(diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('逐字段类型回退：坏字段剥离、好字段保留', () => {
    const { value, diagnostics } = sanitizeReaderRuntimeSettings({
      fontScale: 'not-a-number', // 坏：字符串冒充 number
      timeScale: 1.5, // 好
      debugOverlay: 'true', // 坏：拒绝 coercion（字符串 true 丢弃而非强转）
      quality: 'ultra', // 坏：不在枚举内
      theme: 'dark', // 好
    });
    expect(value).toEqual({ timeScale: 1.5, theme: 'dark' });
    expect(diagnostics.length).toBe(3);
    expect(diagnostics.some((d) => d.includes('fontScale'))).toBe(true);
    expect(diagnostics.some((d) => d.includes('debugOverlay'))).toBe(true);
    expect(diagnostics.some((d) => d.includes('quality'))).toBe(true);
  });

  it('未知键静默剥离 + 诊断（不发错误事件是调用方职责，此处只验诊断）', () => {
    const { value, diagnostics } = sanitizeReaderRuntimeSettings({
      timeScale: 1,
      totallyUnknownField: 'whatever',
    });
    expect(value).toEqual({ timeScale: 1 });
    expect(diagnostics.some((d) => d.includes('totallyUnknownField'))).toBe(true);
  });

  it('嵌套子树逐字段：typography 内坏字段剥离、其余保留', () => {
    const { value } = sanitizeReaderRuntimeSettings({
      typography: {
        fontFamily: 'Sasara Regular',
        fontSize: 'big', // 坏
        align: 'left',
      },
    });
    expect(value.typography).toEqual({ fontFamily: 'Sasara Regular', align: 'left' });
  });

  it('typography 整体非 record → 剥离整个 typography，不连坐兄弟字段', () => {
    const { value } = sanitizeReaderRuntimeSettings({
      fontScale: 1.5,
      typography: 'serif', // 坏：非对象
    });
    expect(value).toEqual({ fontScale: 1.5 });
  });

  it('原型污染键剥离', () => {
    const input = { timeScale: 1 };
    Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
    Object.defineProperty(input, 'constructor', { value: () => {}, enumerable: true });
    const { value, diagnostics } = sanitizeReaderRuntimeSettings(input);
    expect(value).toEqual({ timeScale: 1 });
    expect(diagnostics.some((d) => d.includes('forbidden key'))).toBe(true);
  });
});

describe('sanitizeKmdRuntimeConfig boot 配置防火墙', () => {
  it('合法配置透传 + settings 子树深校验', () => {
    const input = {
      assetBaseUrl: './',
      presentationMode: 'stage',
      settings: { debugOverlay: true, fontScale: 1.5 },
      capabilities: { supportsSeekTime: true },
    };
    const { value, diagnostics } = sanitizeKmdRuntimeConfig(input);
    expect(value).toEqual(input);
    expect(diagnostics).toEqual([]);
  });

  it('非 record 根 → 空配置，永不抛', () => {
    for (const garbage of [null, 'garbage', 7, []]) {
      const { value } = sanitizeKmdRuntimeConfig(garbage);
      expect(value, `输入 ${String(garbage)}`).toEqual({});
    }
  });

  it('settings 子树不连坐：内部坏字段只剥内部字段', () => {
    const { value, diagnostics } = sanitizeKmdRuntimeConfig({
      assetBaseUrl: './',
      settings: { debugOverlay: 'yes', timeScale: 2 },
    });
    expect(value.settings).toEqual({ timeScale: 2 });
    expect(value.assetBaseUrl).toBe('./');
    expect(diagnostics.some((d) => d.includes('debugOverlay'))).toBe(true);
  });

  it('宿主扩展字段剥离（autoDemo 属宿主私有，由调用方先拆出）', () => {
    const { value, diagnostics } = sanitizeKmdRuntimeConfig({
      autoDemo: false,
      someHostThing: 123,
      settings: {},
    });
    expect(value).toEqual({ settings: {} });
    expect(diagnostics.some((d) => d.includes('autoDemo'))).toBe(true);
    expect(diagnostics.some((d) => d.includes('someHostThing'))).toBe(true);
  });
});
