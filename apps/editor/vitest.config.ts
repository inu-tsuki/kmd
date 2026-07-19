// Vitest 配置（架构体检处方 5 / 测试网支柱 1）。
//
// 设计依据 docs/planning/test-net-design-2026-07.md §3 支柱 1：
// - 对齐 apps/community-api 的 vitest ^2.1.8。
// - setup.ts 为单一真相源：把 final-playback-test.ts 的 gsap 互操作 / document stub /
//   DOMAdapter 合成度量 shim 提取出来，所有需要 headless 环境的套件共享同一确定性度量。
// - 测试文件放 src/test/，与散件脚本（final-*-test.ts / test-*.ts）并存，迁移期不互相干扰。
// - 黄金文件放 src/test/__golden__/，随仓库提交，人工审阅更新（禁止无脑 --update）。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 只跑 src/test/ 下的 *.test.ts，避免误收编散件脚本（它们仍是 tsx runner 跑）。
    include: ['src/test/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // 黄金/快照测试要确定性：禁随机顺序、禁并发，单线程跑以隔离全局 DOMAdapter shim。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { shuffle: false },
    // playwright e2e 仍由 playwright.config.ts 负责，vitest 不碰浏览器。
    environment: 'node',
    includeSource: ['src/**/*.ts'],
    snapshotOutputDir: 'src/test/__snapshots__',
    // 默认 10s 太短给 pixi/gsap 互操作预热；layout 全语料跑也偏重。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});