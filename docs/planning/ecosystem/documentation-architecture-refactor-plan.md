# Documentation Architecture Refactor Plan

> 文档状态：Done record
> 最近更新：2026-06-16
> 权威范围：KMD 文档库的所有权规则、文档状态规范与重构执行记录（D0–D4 与协作指引同步于 2026-06-16 完成）

## 1. 背景

2026-06-15 的文档状态校准暴露出一个结构问题：当 Phase R 完成后，需要同步修改 README、roadmap、package plan、integration knowledge、Android roadmap 和 TODO 等多处文档。

这不是单纯的“文档太多”，而是同一事实被多份文档共同拥有：

- “当前阶段是什么”散落在多个 README 和 roadmap index 中。
- `reader-runtime-web` 的构建产物路径同时出现在 package plan、protocol、bundle knowledge、Android runtime plan 和 Phase R 文档里。
- Android Reader 的 Review / Issues companion 状态同时出现在 roadmap、runtime UI plan、architecture knowledge 和 README 中。
- 计划文档完成后没有明确切换为执行记录、长期机制或归档，导致旧的“下一步”继续被引用。

目标是把文档从“多处复述”调整为“单一权威 + 简短引用”。

## 2. 目标

- 一个任务只对应一个权威规划文档。
- 一个长期机制只对应一个 knowledge 权威文档。
- 索引页只提供导航和一行摘要，不承担当前状态事实。
- README 只描述仓库入口、常用命令和最高层状态，不复述阶段细节。
- Android 子仓库只描述 Android 如何消费主仓库能力；主仓库只描述能力如何构建和发布。
- 完成的计划要明确归宿：保留为执行记录、沉淀到 knowledge、或移动到 archive。

## 3. 文档所有权规则

### 3.1 当前阶段唯一来源

`docs/planning/roadmap/implementation-roadmap.md`

只允许这个文档拥有“当前主线是什么、下一阶段是什么、什么被 gate 住”的最高层判断。

其他文档只能写：

```md
当前阶段以 `docs/planning/roadmap/implementation-roadmap.md` 为准。
```

### 3.2 单个任务权威来源

阶段任务放：

```text
docs/planning/roadmap/<phase-or-task>.md
```

应用任务放：

```text
docs/planning/apps/<app>/<task>.md
```

包任务放：

```text
docs/planning/packages/<package>.md
```

任务文档可以包含背景、目标、切片、验收、执行记录和后续 gate。其他地方只链接它，不复制任务清单。

### 3.3 长期机制权威来源

已经成立的机制放：

```text
docs/knowledge/runtime/
docs/knowledge/integration/
docs/knowledge/architecture/
docs/knowledge/language/
```

例如：

- reader bundle 产物布局、debug probe、asset path：`docs/knowledge/integration/reader-runtime-web-bundle.md`
- Android bridge envelope / commands / events：`docs/knowledge/integration/android-webview-runtime-protocol.md`
- Work 与 `.kmd` 内容模型：`docs/knowledge/architecture/work-kmd-content-model.md`

planning 文档不应长期持有这些机制细节，只能说明“本任务依赖该机制”。

### 3.4 索引页职责

索引页包括：

- `docs/README.md`
- `docs/planning/README.md`
- `docs/planning/*/README.md`
- `docs/knowledge/*/README.md`

索引页只能做三件事：

- 说明目录用途。
- 列出入口文档。
- 给出一行状态摘要，并链接权威来源。

索引页不保存任务清单、验收清单、路径细节或“下一步具体顺序”。

### 3.5 README 职责

根 README 只保存：

- 项目定位。
- 目录概览。
- 常用命令。
- 文档入口。
- 一段最高层状态摘要，链接 `implementation-roadmap.md`。

README 不保存阶段细项、Android UI 切片、bundle 路径细节或 Phase B 恢复条件。

## 4. 文档状态规范

所有 planning 文档统一使用：

```md
> 文档状态：Active planning / Active implementation / Done record / Gated roadmap / Draft / Archive candidate
> 最近更新：YYYY-MM-DD
> 权威范围：一句话说明本文件拥有什么事实
```

推荐含义：

| 状态 | 含义 |
|---|---|
| Active planning | 已决定要规划，但未进入执行 |
| Active implementation | 当前正在执行 |
| Done record | 任务完成，保留执行记录和后续 gate |
| Gated roadmap | 设计有效，但有明确 gate，暂不实施 |
| Draft | 草案，不能覆盖 active 文档 |
| Archive candidate | 不再指导开发，等待归档 |

## 5. 重构阶段

### D0. Ownership Audit

目标：列出重复事实和权威文档。

任务：

- 扫描 `当前状态`、`当前优先级`、`下一步`、`Phase R`、`reader-runtime`、`ReviewOverlay`、`Work.presentation` 等关键词。
- 建立一张 ownership 表：事实 -> 权威文档 -> 引用方。
- 标记需要删除复述、改为链接、或迁入 knowledge 的段落。

验收：

- 有一份去重清单。
- 每个高频事实只有一个计划中的 owner。

### D1. Index Slimming

目标：让索引页回到导航职责。

任务：

- 清理 `docs/README.md`、`docs/planning/README.md`、`docs/planning/roadmap/README.md` 中的阶段细节。
- 将当前状态压缩为一行摘要，链接 `implementation-roadmap.md`。
- 更新 `docs/planning/apps/README.md`，纳入 editor DIP-FX 入口，但不复述计划内容。

验收：

- 索引页不包含任务验收清单。
- 索引页没有独立的“下一步顺序”。

### D2. Runtime Documentation Split

目标：把 reader runtime 的任务记录、包边界、长期机制分清。

任务：

- `phase-r-reader-runtime-web.md` 只保留 Phase R 执行记录、R0-R7 状态和后续 gate。
- `planning/packages/reader-runtime-web.md` 只保留包职责、禁止导入、build 命令、core extraction gate。
- `knowledge/integration/reader-runtime-web-bundle.md` 拥有 bundle 路径、debug probe、asset policy、Android generated asset 机制。
- `knowledge/integration/android-webview-runtime-protocol.md` 拥有 protocol envelope、commands、events 和 bridge lifecycle。
- 其他文档删除路径细节，改为链接上述 knowledge 文档。

验收：

- `dist/reader-runtime/`、`assets/reader-runtime/`、`assets/kmd-runtime/` 的真实/fallback 关系只在 knowledge 文档详细展开。
- planning 文档中不再复制 bundle 路径解释。

### D3. Android Documentation Boundary

目标：主仓库与 Android 子仓库不要互相复制事实。

任务：

- Android roadmap 只描述 Android 当前产品/工程优先级。
- Android runtime implementation plan 只描述 Android 如何消费 runtime artifact、如何处理 WebView lifecycle。
- Android architecture docs 不保存过时 UI 组件名称；旧组件名进入历史段或归档。
- 主仓库 docs 只链接 Android 子仓库当前 roadmap，不复制 Android 切片状态。

验收：

- `ReviewOverlay`、`ReaderCompanionContainer` 等 UI 状态只有 Android runtime UI plan 或 Android roadmap 持有。
- 主仓库不复述 Android UI 具体切片。

### D4. Archive And Done Records

目标：完成态文档不再伪装成当前任务。

任务：

- Phase A refactor 目录保持历史记录，但 README 明确“只作架构背景，不表示当前优先级”。
- `docs/planning/TODO.md` 降级为 historical backlog，不再作为阶段入口。
- 对被取代的旧 Android plans 增加 Archive candidate 状态或移动到 `apps/android-reader/docs/archive/`。

验收：

- 搜索 `Current` / `下一步` 时，不会在旧阶段文档中得到误导性结果。
- 每个 Done record 都有“当前权威来源”链接。

## 6. 第一批建议处理对象

优先处理这些已经暴露重复的主题：

| 主题 | 权威文档 | 需要降噪的引用方 |
|---|---|---|
| 当前主线 | `implementation-roadmap.md` | root README、docs README、roadmap README、TODO |
| reader bundle 路径 | `knowledge/integration/reader-runtime-web-bundle.md` | Phase R、package plan、Android runtime plan |
| bridge protocol | `knowledge/integration/android-webview-runtime-protocol.md` | Phase R、Android ViewModel/runtime plans |
| Android runtime UI 状态 | `apps/android-reader/docs/planning/runtime/runtime-ui-implementation-plan.md` | Android roadmap、README、architecture docs |
| Work / `.kmd` 模型 | `knowledge/architecture/work-kmd-content-model.md` | community-api plans、Android product docs |
| Work.presentation 生成链 | `planning/ecosystem/work-presentation-generation-draft.md` | Android roadmap、community-api docs、editor future publish docs |

## 7. 非目标

- 不删除有历史价值的执行记录。
- 不把所有文档合并成一个大文档。
- 不在本轮重新设计 KMD 语言或 runtime API。
- 不让主仓库直接维护 Android 子仓库全部计划细节。
- 不为了“一个任务一个文档”牺牲 knowledge 文档：任务结束后，长期机制仍要沉淀为独立 knowledge。

## 8. 完成定义

文档重构完成时应满足：

- 每个 active task 有且只有一个 planning owner。
- 每个长期机制有且只有一个 knowledge owner。
- README / index 页只引用，不复制细节。
- 搜索常见状态词不会出现过期“当前任务”。
- 新任务完成后，维护者能按固定流程判断：更新任务文档、更新机制文档、还是归档旧文档。

## 9. 执行结果（2026-06-16）

D0–D4 已在 2026-06-16 执行完成，并在审查阶段同步收敛 `AGENTS.md` / `CLAUDE.md` 的长期指引边界。下列为实际落地的所有权映射与改动记录。

### 所有权映射（D0 审计产出）

| 事实 | 唯一权威 | 已降级为链接的复述方 |
|---|---|---|
| 当前主线/阶段顺序 | `planning/roadmap/implementation-roadmap.md` | `docs/README.md`、`planning/README.md`、`roadmap/README.md`、`TODO.md` |
| reader bundle 路径链 | `knowledge/integration/reader-runtime-web-bundle.md` | `android-webview-runtime-protocol.md`、`phase-r-reader-runtime-web.md`、`packages/reader-runtime-web.md` |
| bridge envelope/命令/事件 | `knowledge/integration/android-webview-runtime-protocol.md` | `phase-r-reader-runtime-web.md`、`packages/reader-runtime-web.md`、`phase-r-scope-inventory.md` |
| Phase R 执行记录 | `planning/roadmap/phase-r-reader-runtime-web.md` | `TODO.md`（R0–R7 checklist 已删） |
| reader build 命令/base/font | `knowledge/integration/reader-runtime-web-bundle.md` | `packages/reader-runtime-web.md` |
| core 抽离 gate | `planning/packages/reader-runtime-web.md`（包边界） | `repository-strategy.md`（迁移维度保留） |
| Work / .kmd 模型 | `knowledge/architecture/work-kmd-content-model.md` | community-api plans、Android product docs |
| Android 当前路线 | `apps/android-reader/docs/planning/roadmap.md` | Android `planning/README.md`（`## 当前优先级` 已删） |
| 协作指引与阶段状态边界 | `AGENTS.md` / `CLAUDE.md` 只保存长期协作规则与仓库地图；阶段状态仍由 `implementation-roadmap.md` 承接 | `AGENTS.md` / `CLAUDE.md` 中的 Phase current/done 文案已删除 |

### 各阶段执行记录

- **D0（已完成）**：完成 file:line 级 ownership 审计，建立上述映射表。
- **D1（已完成）**：`docs/README.md`、`planning/README.md`、`roadmap/README.md` 删除“当前状态/当前入口/当前决策”块，改一行权威指针；二级索引中的“当前入口”统一改为“入口文档”；`packages/README.md` `@kmd/core` 条目改为链 gate；`apps/README.md` 补 editor DIP-FX 入口。Android `planning/README.md` 删“当前优先级”。
- **D2（已完成）**：4 个 authority knowledge 文档补 `> 权威范围` 头并剥离任务态；`phase-r-reader-runtime-web.md` 改 Done record 并删路径/命令事件/build/gate 复述为链接；`packages/reader-runtime-web.md` 删 base/font/build 块；`TODO.md` R0–R7 checklist 折叠为指针；`implementation-roadmap.md` 补权威头。
- **D3（已完成）**：Android `viewmodel-runtime-plan.md` §10 修 D0 自相矛盾、阶段 E 标已完成；`prd.md` 修“reader-runtime-web as future”；3 索引合并为 `roadmap.md` 权威；`core-portability-webview-feasibility.md` 加阶段命名消歧；`runtime-ui-extraction-plan.md` 标注 `ReaderPlaybackPosition` 未抽独立文件；`page-architecture.md` 修 ReviewOverlay 措辞。
- **D4（已完成）**：`phase-a-refactor/README.md` 加“架构背景，非当前优先级”状态头；`archive/CLAUDE.md` 加 superseded 标注；根目录 `AGENTS.md` / `CLAUDE.md` 删除阶段性记录，保留长期事实、仓库地图和权威文档指针。

### 未在本轮处理（刻意延后）

- `knowledge/language/design.md` 的内容收敛（空标题段、与 `brainstorm.md` 重叠）按决定跳过；仅确保索引不把它当当前权威。它是后续语言设计收敛工作。
- Android bundle 路径的零散提及（`runtime-implementation-plan`、`stage-5` 报告等）多为 Android 本地框架性引用，与主仓库一致，本轮未逐一降级，留待自然 drift 时处理。

本文档自身现转为 Done record；后续若再发现 ownership 违规，按 §3 规则与本表执行。
