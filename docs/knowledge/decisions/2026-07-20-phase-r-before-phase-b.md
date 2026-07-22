# Phase R 先于 Phase B（Reader Runtime Extraction Before Language Work）

- 日期：2026-07-20
- 状态：已采纳（追溯归档，处方 9）

## 回应的力

Android Reader 需要一个可复用、无 Pinia / 无 editor shell 耦合的 WebView runtime。与此同时 Phase B 将大改语言与 runtime。顺序问题：先做 Phase B 语言，还是先抽 reader-runtime 包边界（Phase R）？

若先做 Phase B，它会在尚未隔离的 core 上持续写入 editor-only import，reader 边界越拖越难抽，Android 也一直拿不到稳定产物。

## 决策

**Phase R（reader-runtime-web 抽包 + host contract）先于 Phase B。** 先建立 `@kmd/reader-runtime-web` 包边界与 `createReaderRuntime` / `ReaderRuntimeSession` host 契约，把 source / asset / font loading 移进 host policy，禁止 Vue / Pinia / Monaco / TextMate / editor-panels import；之后 Phase B 在这条已隔离的边界内推进，不回流 editor-only import。

## 方案对比

### 方案 A：Phase B 先
做法：先做语言，reader 边界后抽。
代价 / 局限：Phase B 的每次改动都可能把 editor-only import 写进 reader 热路径，抽包成本随 Phase B 进展指数上升；Android 长期无稳定产物。

### 方案 B：Phase R 先（采纳）
做法：先隔离 reader 边界 + 定 host contract + asset policy，再进 Phase B。
代价 / 局限：需要先把 core 的 reader 热路径与 editor shell 解耦（R0–R7 的工作量），短期推迟了语言进展。
为什么最简方案不够用：边界隔离越晚越贵；等 Phase B 改完再抽，面对的是被新语法深度耦合过的 core，隔离代价远高于现在。

## 触碰的不变量

- **reader-runtime-web 边界**（无 editor-only import）——守护：`pnpm reader:typecheck` + import grep + 浏览器 e2e。
- **host contract / RuntimeAssetPolicy**（source/asset/font 走 host policy）。
- 参照 `docs/planning/packages/reader-runtime-web.md`。

## 与 house style 的关系

沿用 host / runtime 分层（ReaderHost / StageRuntime 接缝）与“能力门控”思路——reader 只加载它需要的，editor-only 能力被门控在外。

## 可逆性

中。包边界一旦建立，退回单体需要重新耦合——但这正是目的：边界是资产。不锁死语言格式；Phase B 仍可在边界内自由演进。

## 结果

R0–R7 完成；Android R3-K1 设备测试 8/8，runtime 消费链路闭合；`@kmd/reader-runtime-web` 成 workspace package，`pnpm reader:build` 输出 `dist/reader-runtime/`。为 Phase B 提供了稳定、隔离的 reader 边界——Phase B 的进入条件之一（边界稳定，不回流 editor-only import）由此满足。
