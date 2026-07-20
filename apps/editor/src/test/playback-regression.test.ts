// Playback 状态机回归套件（支柱 3 / 收编 final-playback-test.ts）。
//
// 设计文档 §3 支柱 3 + §6 风险：playback 3895 行 + 娇贵 shim 是最大迁移成本 →
// **先整体包成一个 test 断言 fail===0，再渐拆，勿大爆炸重写**。
//
// 收编策略：不复制 3895 行、不重写 testXxx，把 final-playback-test.ts 作为子进程跑
//（它已是自含 runner，main() 末尾 process.exit(1) on fail），vitest 断言其退出码 === 0
// 且输出含"0 failed"。这把 331 用例整体纳入 vitest 报告，迁移期旧脚本与 vitest 包装并存。
//
// 后续渐拆（不在本任务）：把 testXxx 拆成独立 it() 块，逐个搬进本文件，最后退役子进程包装。
// 子进程隔离也避免 final-playback-test.ts 的全局 shim（gsap 互操作 / DOMAdapter.set）污染
// vitest 主进程的 setup.ts shim——两套 shim 目前同源但各自独立，互不干扰。

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, '..', 'final-playback-test.ts');
const TSX = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'tsx');

describe('playback state-machine regression (331 cases via final-playback-test.ts)', () => {
  it('runs the full suite with fail === 0', () => {
    // 子进程跑 tsx，继承环境；超时 120s（331 用例 + gsap/pixi 互操作预热）。
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(TSX, [SCRIPT], {
        cwd: join(import.meta.dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stdout = err.stdout?.toString() ?? '';
      stderr = err.stderr?.toString() ?? '';
    }

    // 退出码 0 = main() 末尾未 process.exit(1)（fail === 0 路径）。
    if (exitCode !== 0) {
      expect.fail(
        `playback 子进程退出码 ${exitCode}（fail > 0 或运行时错误）。\n` +
          `stdout 末尾:\n${stdout.split('\n').slice(-20).join('\n')}\n` +
          `stderr:\n${stderr.split('\n').slice(-20).join('\n')}`,
      );
    }

    // 双保险：退出码 0 时输出应含 "0 failed"。
    const summaryLine = stdout.split('\n').find((l) => l.includes('passed') && l.includes('failed'));
    expect(summaryLine, '应含 "N passed, M failed" 汇总行').toBeDefined();
    expect(summaryLine).toContain('0 failed');
  }, 150_000);
});