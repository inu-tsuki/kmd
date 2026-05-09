# 文档索引

> 该索引用于给 `docs/` 一个稳定入口，避免架构文档、路线图、讨论稿和 AI 工作记忆混在一起时变得难找。
> 最近更新：2026-05-10

## 当前结构

### `docs/core/`

长期有效的核心技术文档，描述运行中仍然成立的机制。

- `command-routing.md`：KMD 指令如何从 AST/IR 路由到 runtime
- `effect-pipeline.md`：特效分类、目标作用域和渲染消费路径
- `parser-pipeline.md`：`source -> AST -> IR -> runtime` 主路径

### `docs/android-reader/`

KMD Reader Android 的产品需求、课程阶段计划和移动端宿主策略。

- `kmd-reader-android-prd.md`：KMD Reader Android 课程项目第一阶段 PRD
- `kmd-reader-android-stage-2-plan.md`：KMD Reader Android 第二阶段执行方案

### `docs/research/`

外部项目调研、选型比较、可借鉴方案归档。

- `pretext.md`：`chenglou/pretext` 与本项目的重叠度分析

### `docs/ai/`

AI 协作期的工作记忆、路线草稿、任务池。适合内部推进，不适合作为唯一事实来源。

- `MEMORY.md`：偏全景架构手册
- `TODO.md`：路线图与任务池

### `docs/` 顶层文件

当前顶层仍保留一些历史阶段文档：

- `repository-strategy.md`：KMD 主仓库、本地目录和未来拆分策略
- `v1.6plan_segments.md`：阶段性方案稿
- `jump_discussion.md`：长篇讨论记录

## 目前是否需要整理

需要，但属于“轻整理优先”，还没到必须大搬家的程度。

当前最明显的问题：

- 缺少统一入口，第一次进仓库时不容易判断哪份文档是“正式说明”，哪份只是讨论稿。
- 顶层文件混合了路线图、讨论纪要和正式文档，边界不够清晰。
- `docs/ai/` 和 `docs/core/` 都在描述架构，但用途不同，容易出现双份真相。
- `jump_discussion.md` 体量很大，更像归档材料，不适合继续放在顶层作为常用入口。

## 建议的整理原则

先定规则，再慢慢搬。

- 核心机制文档放进 `docs/core/`
- Android Reader 产品和课程文档放进 `docs/android-reader/`
- 外部项目调研统一放进 `docs/research/`
- 路线图、阶段计划放进未来可新增的 `docs/roadmap/`
- 讨论纪要、长对话归档放进未来可新增的 `docs/archive/`
- `docs/ai/` 保留为工作区，但避免把它当成最终架构权威来源

## 建议的下一步

如果后面要继续整理文档库，我建议按这个顺序做：

1. 先补索引和分类约定
2. 再把顶层历史文件迁移到 `roadmap/` 或 `archive/`
3. 最后处理 `docs/ai/` 与 `docs/core/` 的重复内容，保留单一权威文档
