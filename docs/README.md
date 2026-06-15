# 文档索引

> 最近更新：2026-06-16

`docs/` 按用途分成三类：开发规划、知识库、归档。新增文档时先判断它是“接下来要做什么”“长期事实是什么”，还是“历史记录是什么”。

## 开发规划：`docs/planning/`

放仍会影响后续开发顺序、任务拆分或仓库策略的文档。

- `roadmap/`：阶段路线，只放 Phase R、Phase B、Phase A refactor 等阶段级计划和审查。
- `packages/`：KMD 生态包计划，例如 `language`、`reader-runtime-web`、未来 `core`。
- `apps/`：KMD 生态应用计划，例如 editor、Android Reader、VS Code extension、community API；当前含 `apps/editor-dip-effect-library.md`（DIP 风格化滤镜库子项目）。
- `ecosystem/`：跨包、跨应用的仓库编排和生态策略。
- `TODO.md`：AI 协作期任务池和历史任务追踪；阶段权威以 `roadmap/` 为准。

> 当前阶段与下一步以 `planning/roadmap/implementation-roadmap.md` 为准。

远期生态草案：

- `planning/ecosystem/work-presentation-generation-draft.md`

## 知识库：`docs/knowledge/`

放长期有效、可被代码维护者反复查阅的事实、机制和研究材料。

- `language/`：KMD 语言语法、命名空间、指令语义和设计草稿。
- `runtime/`：parser、layout、effect、stage、playback 等运行链路。
- `architecture/`：系统分层、host/runtime 边界和架构记忆。
- `integration/`：Android WebView、VS Code、editor shell 等宿主接入知识。
- `research/`：外部项目调研和可借鉴方案。
- `decisions/`：后续新增 ADR，记录“为什么这样决定”。

修改 parser、layout、effect、stage 或 language 语义时，优先检查 `knowledge/runtime/` 与 `knowledge/language/`。

## 归档：`docs/archive/`

放不再作为当前事实来源、但仍值得保留的历史讨论、旧方案和迁移前材料。

- `CLAUDE.md`：旧协作说明。
- `jump_discussion.md`：长篇历史讨论。
- `v1.6plan_segments.md`：旧阶段方案稿。

归档文档可以提供背景，但不应覆盖 `planning/` 和 `knowledge/` 中的当前结论。

## Android Reader 文档

Android Reader 是可选本地 checkout，主仓库通过 `.gitignore` 忽略其源码。若本地存在 `apps/android-reader/`，相关文档位于：

- `apps/android-reader/docs/README.md`
- `apps/android-reader/docs/planning/roadmap.md`
- `apps/android-reader/docs/knowledge/integration/core-portability-webview-feasibility.md`

## 放置规则

- 要安排阶段顺序、阶段边界、roadmap：放 `planning/roadmap/`。
- 要规划某个 npm/workspace 包：放 `planning/packages/`。
- 要规划某个宿主应用或服务：放 `planning/apps/`。
- 要解释现有系统如何工作、语言语义是什么、研究依据是什么：放 `knowledge/`。
- 要保存过期方案、长对话、旧评审、历史上下文：放 `archive/`。
- 如果一份文档从规划变成长期机制，应移动到 `knowledge/` 并更新引用。
- 如果一份文档不再指导当前开发，应移动到 `archive/` 并在当前文档中保留必要结论。
