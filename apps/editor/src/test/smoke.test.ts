// 琐碎绿测试（支柱 1 落地确认）：vitest runner + setup.ts headless 环境 + parser 真实模块加载。
//
// 不断言业务语义——只确认 (1) vitest 能跑、(2) setup.ts 的 shim 不崩、(3) parser 单例可 import。
// 业务断言进各自的 parser/layout/effects/playback 套件。
import { describe, it, expect } from 'vitest';
import { parser } from '../core/parser/Parser';
import { G } from './setup';

describe('vitest smoke', () => {
  it('setup.ts gsap interop resolves a real timeline factory', () => {
    expect(typeof G.timeline).toBe('function');
  });

  it('parser singleton parses a trivial source without throwing', () => {
    const result = parser.parse('hello @ f.red');
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(1);
    const first = result.paragraphs[0];
    expect(first.tokens.some((t) => t.content.includes('hello'))).toBe(true);
  });

  it('parser handles empty input gracefully', () => {
    const result = parser.parse('');
    expect(result.paragraphs).toHaveLength(0);
  });
});