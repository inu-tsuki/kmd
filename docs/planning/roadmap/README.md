# Roadmap Index

> 最近更新：2026-06-15

这里只放阶段级路线图。包级计划放 `../packages/`，应用级计划放 `../apps/`，跨生态策略放 `../ecosystem/`。

## 当前决策

Phase B 的语言与 Segment Graph 设计已经膨胀为一个完整新语法阶段，不适合作为 Android Reader runtime 交付的附带项。Phase R 已完成 R0-R7：`@kmd/reader-runtime-web` 已建立为 reader-only bundle 包，但纯 `packages/core` 仍后置。

当前优先级为：

```text
Integration stabilization:
  Android WebView smoke + reader-runtime-web artifact boundary
  -> Phase B readiness review:
       language design convergence + package boundary check
  -> Phase B: Language / State / Control Flow / Segment Graph
  -> Phase C: Interactive Runtime / Game-like Segments
  -> v1.7+: Plugin and Tooling Ecosystem
```

## 阶段文档

- `implementation-roadmap.md`：当前主路线摘要与阶段顺序。
- `phase-r-reader-runtime-web.md`：Phase R reader-runtime-web 抽离执行记录与后续 gate。
- `phase-r-scope-inventory.md`：Phase R R0 范围锁定、依赖盘点和禁止导入清单。
- `phase-b/1.6-phase-b-plan.md`：Phase B 功能设计，当前作为 gated roadmap 保留。
- `phase-a-refactor/`：Phase A 与 Phase B Prep 的重构路线、实施方案和审查记录。

## 参考

- `../../knowledge/language/design.md`：语言设计探索草稿。
- `apps/android-reader/docs/knowledge/integration/core-portability-webview-feasibility.md`：Android WebView 宿主可行性审计。
