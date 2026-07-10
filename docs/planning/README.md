# Development Planning

> 最近更新：2026-06-16

这里放仍会影响开发顺序、任务拆分和生态编排的文档。它回答“下一步做什么、由哪个包或应用承接、做到什么程度算结束”。

## 入口文档

> 当前阶段权威见 [`roadmap/implementation-roadmap.md`](roadmap/implementation-roadmap.md)。

- `roadmap/implementation-roadmap.md`：当前主路线摘要与阶段顺序。
- `roadmap/phase-r-reader-runtime-web.md`：Phase R reader-runtime-web 抽离执行记录与后续 gate。
- `roadmap/phase-b/1.6-phase-b-plan.md`：Phase B 语言与 Segment Graph 功能路线（gated roadmap）。
- `ecosystem/repository-strategy.md`：仓库、包边界与 Android Reader 协作策略。
- `ecosystem/work-presentation-generation-draft.md`：`Work.presentation` 生态生成链草案（远期对齐点）。
- `ecosystem/effect-preset-and-plugin-contract.md`：effect/preset contribution 与插件边界草案（未实现）。
- `TODO.md`：历史任务池与执行记录（不作为阶段入口）。

## 子目录

- `roadmap/`：阶段路线。这里只放 Phase 级文档，不按包或应用拆。
- `packages/`：KMD 生态包计划，例如 `@kmd/language`、`@kmd/reader-runtime-web`、未来 `@kmd/core`。
- `apps/`：KMD 生态应用计划，例如 editor、Android Reader、VS Code extension、community API。
- `ecosystem/`：跨包、跨应用的仓库策略、发布策略和协作边界。

## 维护规则

- 当前阶段的权威顺序放在 `roadmap/`。
- 某个包的边界、API、发布条件放在 `packages/`。
- 某个应用的产品目标、集成计划、宿主职责放在 `apps/`。
- 跨多个包和应用的策略放在 `ecosystem/`。
- 过期到不再指导开发的内容移入 `../archive/`。
