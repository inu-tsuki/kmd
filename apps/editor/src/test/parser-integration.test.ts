// Parser 集成测试套件（支柱 3 / 收编 final-parser-test.ts）。
//
// 收编自 src/final-parser-test.ts，行为保持——把 Report 5.x 规范断言搬进 vitest runner。
// 与 parser-golden.test.ts 互补：golden 抓全语料序列化稳定性，本套件抓 final-test.kmd 的
// 具体语义断言（blockOptions align、糖衣并存、layout 指令、空行镜头、braceGroupId 广播、
// 注释行、scene clear 糖衣）。迁移期旧脚本与 vitest 包装并存，绿了切 CI、退役旧脚本。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parser } from '../core/parser/Parser';

const FINAL_TEST = join(import.meta.dirname, '..', '..', 'public', 'final-test.kmd');
const source = readFileSync(FINAL_TEST, 'utf-8');
const result = parser.parse(source);

describe('parser integration (final-test.kmd / Report 5.x)', () => {
  it('BlockOptions carries align=center and cam.zoom globalEffect', () => {
    const p1 = result.paragraphs[0];
    expect(p1.blockOptions.align).toBe('center');
    expect(p1.globalEffects.some((e) => e.name === 'cam.zoom')).toBe(true);
  });

  it('timing chain and sugar coexist on 准备 token (red + hold)', () => {
    const p2 = result.paragraphs.find((p) => p.tokens.some((t) => t.content.includes('准备')));
    const tokenReady = p2?.tokens.find((t) => t.content.includes('准备'));
    expect(tokenReady?.effects.some((e) => e.name === 'red')).toBe(true);
    expect(tokenReady?.effects.some((e) => e.name === 'hold')).toBe(true);
  });

  it('layout instruction: first text token of 屏幕中间 carries up instruction', () => {
    const pLayout = result.paragraphs.find((p) => p.tokens.some((t) => t.content.includes('屏幕中间')));
    expect(pLayout).toBeDefined();
    const firstTextToken = pLayout!.tokens.find((t) => t.content.trim());
    expect(firstTextToken?.layoutInstructions.some((i) => i.type === 'up')).toBe(true);
  });

  it('empty-line camera directive produces cam.move globalEffect', () => {
    const pCam = result.paragraphs.find((p) => p.globalEffects.some((e) => e.name === 'cam.move'));
    expect(pCam).toBeDefined();
  });

  it('speed sugar (~) standalone with name=slow on 语速 token', () => {
    const pSugar = result.paragraphs.find((p) => p.tokens.some((t) => t.content.includes('语速')));
    expect(pSugar?.tokens.some((t) => t.sugar && t.sugar.length > 0 && t.sugar[0]!.name === 'slow')).toBe(true);
  });

  it('braced token 语速 is isBraced with braceGroupId', () => {
    const pSugar = result.paragraphs.find((p) => p.tokens.some((t) => t.content.includes('语速')));
    const waveToken = pSugar?.tokens.find((t) => t.content.includes('语速'));
    expect(waveToken?.isBraced).toBe(true);
    expect(waveToken?.braceGroupId).not.toBeUndefined();
  });

  it('group mapping: 变 inherits wave effect', () => {
    const pSugar = result.paragraphs.find((p) => p.tokens.some((t) => t.content.includes('语速')));
    const slowToken = pSugar?.tokens.find((t) => t.content.includes('变'));
    expect(slowToken?.effects.some((e) => e.name === 'wave')).toBe(true);
  });

  it('multi-token mapping: 多个 is red', () => {
    const pMulti = result.paragraphs.find((p) => p.tokens.some((t) => t.content.includes('多个')));
    expect(pMulti).toBeDefined();
    expect(pMulti!.tokens.find((t) => t.content.includes('多个'))?.effects.some((e) => e.name === 'red')).toBe(true);
  });

  it('[.wave] broadcasts wave to all text tokens, not globalEffects', () => {
    const broadcast = parser.parse('[.wave]\n{AB}\nCD').paragraphs[0];
    expect(broadcast.globalEffects.every((e) => e.name !== 'wave')).toBe(true);
    const visualTokens = broadcast.tokens.filter((t) => t.content.trim());
    expect(visualTokens.length).toBe(2);
    expect(visualTokens.every((t) => t.effects.some((e) => e.name === 'wave'))).toBe(true);
  });

  it('paragraph exposes ast and ir', () => {
    const broadcast = parser.parse('[.wave]\n{AB}\nCD').paragraphs[0];
    expect(broadcast.ast).toBeDefined();
    expect(broadcast.ir).toBeDefined();
  });

  it('pure comment line does not emit leading newline token or shift visible tokens onto synthetic line', () => {
    const quoted = parser.parse('// quote\ntext1 >>> text1\n\ntext2').paragraphs[0];
    expect(quoted.tokens[0]?.content).not.toBe('\n');
    expect(quoted.tokens.every((t) => t.line !== 0)).toBe(true);
  });

  it('standalone @ line is ignored as empty command-only input', () => {
    const singleAt = parser.parse('@');
    expect(singleAt.paragraphs.length).toBe(0);
  });

  it('scene clear sugar projects as legacy scene-clear token with scene.clear stage cue', () => {
    const sceneClear = parser.parse('---').paragraphs[0];
    const token = sceneClear?.tokens[0];
    expect(token?.isSceneClear).toBe(true);
    expect(token?.layoutInstructions.some((i) => i.type === 'scene.clear')).toBe(true);
  });
});