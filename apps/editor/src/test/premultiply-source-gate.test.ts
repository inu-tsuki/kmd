// 预乘 alpha 库边界源码门禁（主题一：织网 S6 伴生 / §B-bis 引用源钉死）。
//
// Pixi v8 的 filter 链输出面显式声明 premultiplied-alpha：
//   filters/FilterSystem.js —— `outputTexture.source.alphaMode = "premultiplied-alpha"`
// 这是约 15 个点运算滤镜「c.rgb / c.a → 运算 → result * c.a」包络的库边界依据
//（GrayFilter.ts:22 模板注释引 §B-bis；经验像素裁决见 tests/e2e/premultiply-invariant.spec.ts）。
//
// 本门禁在 CI 钉死该源码行：pixi 升级若移除/改变 filter 面 alpha 语义，此测试红 →
// 强制复核滤镜家族的预乘包络（INV-8「断言运行时行为的注释必须经验证」的升级防线）。
// 与 shader-gate 同构：无逃生口——路径缺失直接失败，不假绿。
//
// 路径约定：相对 apps/editor/node_modules 直取（pixi.js 的 exports 映射不暴露 ./package.json，
// createRequire 解析不可用；workspace 内 pixi 一律提升到此符号链接，路径稳定）。

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PIXI_LIB = join(import.meta.dirname, '..', '..', 'node_modules', 'pixi.js', 'lib');

describe('pixi filter surface premultiplied-alpha source gate (§B-bis)', () => {
  it('FilterSystem.js exists at the installed pixi path (no SKIP escape hatch)', () => {
    const file = join(PIXI_LIB, 'filters', 'FilterSystem.js');
    expect(existsSync(file), `pixi FilterSystem.js 未找到：${file}——pixi 结构变化需更新本门禁`).toBe(true);
  });

  it('filter chain output surface is declared premultiplied-alpha (filter 输入/输出面格式承重假设)', () => {
    const source = readFileSync(join(PIXI_LIB, 'filters', 'FilterSystem.js'), 'utf8');
    expect(
      source.includes('alphaMode = "premultiplied-alpha"'),
      'pixi FilterSystem 不再声明 filter 输出面为 premultiplied-alpha——' +
      'core/filters/* 的预乘包络（c.rgb/c.a 对偶）前提可能已变化，须重新裁决 §B-bis 并复核约 15 个滤镜',
    ).toBe(true);
  });

  // 注：TextureSource 默认 alphaMode（premultiply-alpha-on-upload）在 pixi 内部多处散落、
  // 无稳定单文件可钉——资产纹理上传语义不在本门禁范围；滤镜家族的承重面是 FilterSystem 声明。
});
