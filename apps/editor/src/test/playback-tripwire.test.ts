// playback 覆盖蒸发保险丝（主题一：织网 / 审查整改 2 号问题）。
//
// 前身：playback-regression.test.ts 的 EXPECTED_PLAYBACK_CASES（commit 5773eb7）——子进程包装退役时
// 该锚点随之删除，审查指出新套件无计数锚点：某个套件被静默删除时门禁照样绿。本文件是替代锚点：
// 钉死 7 个迁移套件的 it() 块总数。
//
// 账目（只测不数原则的静态版——增删 it 块必须**有意识地**更新 EXPECTED_IT_BLOCKS）：
//   49 = controller(10) + boundary(6) + styling(10) + pipeline(9) + r22(3) + background(10) + typography(1)
// 与 331 断言的对应关系：it 块内含循环展开的断言（assert shim），331 是迁移时的断言执行数
//（历史值），it 块数现为 49（主题二 S3 styling +2）；
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
] as const;

// 覆盖蒸发保险丝：7 个迁移套件的 it 块总数。增删 it 块时必须同步更新此值（并在 commit message
// 记录账目），防止套件被静默删除或裁剪而门禁仍绿。
const EXPECTED_IT_BLOCKS = 49;

describe('playback 覆盖蒸发保险丝', () => {
  it('7 个迁移套件全部存在（防整文件静默删除）', () => {
    for (const name of SUITES) {
      const file = join(import.meta.dirname, name);
      expect(existsSync(file), `${name} 缺失——playback 迁移套件被删除？`).toBe(true);
    }
  });

  it(`it 块总数 === ${EXPECTED_IT_BLOCKS}（增删须有意更新账目）`, () => {
    let total = 0;
    const perFile: Record<string, number> = {};
    for (const name of SUITES) {
      const source = readFileSync(join(import.meta.dirname, name), 'utf8');
      // 只数行首的 it(（语句位置）——避免注释/字符串里的 "it()" 字样（本锚点自己的头注就含）。
      const count = (source.match(/^\s*it\(/gm) ?? []).length;
      perFile[name] = count;
      total += count;
    }
    expect(
      total,
      `playback it 块总数 ${total} ≠ 锚点 ${EXPECTED_IT_BLOCKS}——明细 ${JSON.stringify(perFile)}。` +
      `有意增删请更新 EXPECTED_IT_BLOCKS 并在 commit message 记账；无意变化说明覆盖被裁剪。`,
    ).toBe(EXPECTED_IT_BLOCKS);
  });
});
