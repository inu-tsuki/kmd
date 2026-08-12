// playback 覆盖蒸发保险丝（主题一：织网 / 审查整改 2 号问题）。
//
// 前身：playback-regression.test.ts 的 EXPECTED_PLAYBACK_CASES（commit 5773eb7）——子进程包装退役时
// 该锚点随之删除，审查指出新套件无计数锚点：某个套件被静默删除时门禁照样绿。本文件是替代锚点：
// 钉死 9 个 playback 套件的静态用例声明数，并单独守住 editor 调用侧。
//
// 账目（增删 it / it.each 声明必须**有意识地**更新 EXPECTED_TEST_DECLARATIONS）：
//   63 = controller(10) + boundary(6) + styling(10) + pipeline(9) + r22(3)
//      + background(10) + typography(1) + cyberpunk(9) + source-line(5)
// editor-play-from-line 另有 2 个 it，验证 store 的 load → seek → play 编排。
// `it.each` 展开后实际门禁为 playback 68 + editor 2 = 70 cases；静态锚点数 65 是源码声明口径。
// 本锚点防「整个套件蒸发」，断言级增减由各套件自身门禁负责。

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SUITES = [
  'playback-controller.test.ts',
  'playback-boundary.test.ts',
  'playback-styling.test.ts',
  'playback-pipeline.test.ts',
  'playback-r22.test.ts',
  'playback-background.test.ts',
  'playback-typography.test.ts',
  'playback-cyberpunk.test.ts',
  'playback-source-line.test.ts',
] as const;

// 覆盖蒸发保险丝：9 个 playback 套件的静态声明数。增删时必须同步更新此值（并在 commit message
// 记录账目），防止套件被静默删除或裁剪而门禁仍绿。
const EXPECTED_TEST_DECLARATIONS = 63;
const EDITOR_SOURCE_LINE_SUITE = 'editor-play-from-line.test.ts';
const EXPECTED_EDITOR_SOURCE_LINE_TESTS = 2;

describe('playback 覆盖蒸发保险丝', () => {
  it('9 个 playback 套件与 editor 调用侧套件全部存在', () => {
    for (const name of SUITES) {
      const file = join(import.meta.dirname, name);
      expect(existsSync(file), `${name} 缺失——playback 迁移套件被删除？`).toBe(true);
    }
    expect(existsSync(join(import.meta.dirname, EDITOR_SOURCE_LINE_SUITE))).toBe(true);
  });

  it(`静态测试声明总数 === ${EXPECTED_TEST_DECLARATIONS}（增删须有意更新账目）`, () => {
    let total = 0;
    const perFile: Record<string, number> = {};
    for (const name of SUITES) {
      const source = readFileSync(join(import.meta.dirname, name), 'utf8');
      // 数行首的 it( 与 it.each( 声明，避免注释/字符串里的 "it()" 字样。
      const count = (source.match(/^\s*it(?:\.each)?\(/gm) ?? []).length;
      perFile[name] = count;
      total += count;
    }
    expect(
      total,
      `playback 静态声明总数 ${total} ≠ 锚点 ${EXPECTED_TEST_DECLARATIONS}——明细 ${JSON.stringify(perFile)}。` +
      `有意增删请更新 EXPECTED_TEST_DECLARATIONS 并在 commit message 记账；无意变化说明覆盖被裁剪。`,
    ).toBe(EXPECTED_TEST_DECLARATIONS);

    const editorSource = readFileSync(join(import.meta.dirname, EDITOR_SOURCE_LINE_SUITE), 'utf8');
    expect(editorSource.match(/^\s*it\(/gm) ?? []).toHaveLength(EXPECTED_EDITOR_SOURCE_LINE_TESTS);
  });
});
