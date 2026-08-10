// pixiInternalsAdapter 守卫逻辑回归（主题二 S4b / 处方 10 后半）。
//
// 诚实局限（harness 不掩盖生产行为）：本套件用 fake renderer 证守卫逻辑
//（内部面缺失 → skipped、存在 → applied、永不抛）；真实 pixi 8.15 行为由
// e2e 既有 spec 背书（它们跑真渲染器）。非 playback 套件，不触 tripwire 计数。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindEmptyTextureUnits,
  capBatchableTextures,
  preflightRenderer,
  primeBatchShader,
  renderApp,
  resetPreflightWarnings,
  resizeApp,
  syncBatcherTextureLimits,
} from '../core/render/pixiInternalsAdapter';

interface FakeLimits {
  maxTextures?: number;
  maxBatchableTextures?: number;
}

/** 完整内部面 fake renderer；boundUnits/resizedTo/syncedLimits 收集副作用供断言。 */
function makeFullFakeRenderer(overrides: Record<string, unknown> = {}) {
  const boundUnits: number[] = [];
  const resizedTo: Array<[number, number]> = [];
  const syncedLimits: number[] = [];
  const batcher = {
    maxTextures: 16,
    _updateMaxTextures: (n: number) => {
      syncedLimits.push(n);
    },
  };
  const renderer = {
    name: 'fake-webgl',
    limits: { maxTextures: 16, maxBatchableTextures: 16 },
    renderPipes: {
      batch: {
        _activeBatches: { a: batcher },
        _batchersByInstructionSet: {},
      },
    },
    texture: {
      bind: (_tex: unknown, unit: number) => {
        boundUnits.push(unit);
      },
    },
    context: { webGLVersion: 1 },
    resize: (w: number, h: number) => {
      resizedTo.push([w, h]);
    },
    ...overrides,
  };
  return { renderer, boundUnits, resizedTo, syncedLimits, batcher };
}

const limitsOf = (renderer: unknown): FakeLimits | undefined => {
  if (renderer && typeof renderer === 'object' && 'limits' in renderer) {
    const limits = (renderer as { limits: unknown }).limits;
    if (limits && typeof limits === 'object') return limits as FakeLimits;
  }
  return undefined;
};

describe('preflightRenderer', () => {
  beforeEach(() => resetPreflightWarnings());

  it('完整内部面 → 三项全真', () => {
    const { renderer } = makeFullFakeRenderer();
    expect(preflightRenderer(renderer)).toEqual({ limits: true, batchPipe: true, textureSystem: true });
  });

  it('缺失内部面 → 对应项 false，永不抛', () => {
    expect(preflightRenderer({})).toEqual({ limits: false, batchPipe: false, textureSystem: false });
    expect(preflightRenderer(null)).toEqual({ limits: false, batchPipe: false, textureSystem: false });
    expect(preflightRenderer(undefined)).toEqual({ limits: false, batchPipe: false, textureSystem: false });
    expect(preflightRenderer({ limits: {} })).toEqual({ limits: true, batchPipe: false, textureSystem: false });
  });
});

describe('capBatchableTextures', () => {
  it('超限 → capped true 且写入稳定值', () => {
    const { renderer } = makeFullFakeRenderer();
    const result = capBatchableTextures(renderer, 8);
    expect(result).toMatchObject({ capped: true, originalMaxBatchableTextures: 16, stableMaxBatchableTextures: 8 });
    expect(limitsOf(renderer)?.maxBatchableTextures).toBe(8);
  });

  it('未超限 → capped false 且不写入', () => {
    const { renderer } = makeFullFakeRenderer({ limits: { maxTextures: 16, maxBatchableTextures: 4 } });
    const result = capBatchableTextures(renderer, 8);
    expect(result).toMatchObject({ capped: false, stableMaxBatchableTextures: 4 });
    expect(limitsOf(renderer)?.maxBatchableTextures).toBe(4);
  });

  it('limits 缺失 → null（skipped），永不抛', () => {
    expect(capBatchableTextures({}, 8)).toBeNull();
    expect(capBatchableTextures(null, 8)).toBeNull();
  });
});

describe('primeBatchShader', () => {
  it('真实 DefaultBatcher 构造 + destroy 不抛（与 App.ts 原 try/catch 同行为）', () => {
    expect(() => primeBatchShader(8)).not.toThrow();
  });
});

describe('syncBatcherTextureLimits', () => {
  it('batchPipe 存在 → 返回同步数且 batcher 收到新上限；缺失 → 0，永不抛', () => {
    const { renderer, syncedLimits } = makeFullFakeRenderer();
    expect(syncBatcherTextureLimits(renderer, 8)).toBe(1);
    expect(syncedLimits).toEqual([8]);
    expect(syncBatcherTextureLimits({}, 8)).toBe(0);
    expect(syncBatcherTextureLimits(null, 8)).toBe(0);
  });
});

describe('bindEmptyTextureUnits', () => {
  it('texture system 存在 → 绑定全部单元（上限 32）', () => {
    const { renderer, boundUnits } = makeFullFakeRenderer();
    expect(bindEmptyTextureUnits(renderer)).toBe(16);
    expect(boundUnits.length).toBe(16);
  });

  it('texture system 缺失 / maxTextures 非法 → 0，永不抛', () => {
    expect(bindEmptyTextureUnits({})).toBe(0);
    expect(bindEmptyTextureUnits({ limits: {} })).toBe(0);
    expect(bindEmptyTextureUnits(null)).toBe(0);
  });
});

describe('resizeApp / renderApp', () => {
  it('renderer 缺失 → skipped（守卫顺序：先 renderer 后 app.resize，与原实现一致）', () => {
    const fakeApp = {
      renderer: null,
      resize: () => {
        throw new Error('should not reach');
      },
    };
    // renderer 守卫先行：app.resize 存在也不调（pre-init 时 Application.resize 会崩）。
    expect(resizeApp(fakeApp as never, () => ({ width: 100, height: 100 }))).toBe(false);
  });

  it('app.resize 存在 → 调它，不触碰 fallback 测量', () => {
    let resized = false;
    let measured = false;
    const fakeApp = {
      renderer: {},
      resize: () => {
        resized = true;
      },
    };
    resizeApp(fakeApp as never, () => {
      measured = true;
      return { width: 1, height: 1 };
    });
    expect(resized).toBe(true);
    expect(measured, 'app.resize 路径不触碰 DOM 测量').toBe(false);
  });

  it('renderer.resize 路径 → 用 fallback 尺寸', () => {
    const { renderer, resizedTo } = makeFullFakeRenderer();
    const fakeApp = { renderer };
    resizeApp(fakeApp as never, () => ({ width: 320, height: 240 }));
    expect(resizedTo).toEqual([[320, 240]]);
  });

  it('renderApp：app.render 优先；否则 renderer.render(stage)；都无 → false', () => {
    let appRendered = false;
    expect(renderApp({ renderer: {}, render: () => { appRendered = true; } } as never)).toBe(true);
    expect(appRendered).toBe(true);

    let stageRendered = false;
    expect(
      renderApp({ renderer: { render: () => { stageRendered = true; } }, stage: {} } as never),
    ).toBe(true);
    expect(stageRendered).toBe(true);

    expect(renderApp({ renderer: {}, stage: {} } as never)).toBe(false);
  });
});
