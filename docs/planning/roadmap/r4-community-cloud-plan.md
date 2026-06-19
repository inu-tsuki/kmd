# R4：完善的云端社区阅读器 —— 多仓库协同总规划

> 文档状态：规划草案
> 最近更新：2026-06-19
> 代号：R4
> 权威范围：R4 多仓库协同的总规划——community-api + runtime + reader 三方职责、契约对齐、工作包分配

## 定位

R4 = 完善的云端社区阅读器，与 R3（android-reader 的完善本地阅读器）对应。R4 让联网后的社区能力完整：issue/discussion 结构化、review 提交闭环、云端 revision 同步、位置引用模型。

**R4 是多仓库协同任务**，不再是 reader 单仓库阶段。

## 参与仓库与职责

| 仓库 | R4 职责 |
|---|---|
| **community-api**（`apps/community-api/`） | 契约实质演进：issue 结构化（SourceAnchor）、issue action log、discussion/thread、review 闭环、revision 同步端点 |
| **reader-runtime-web**（`packages/reader-runtime-web/`） | SourceAnchor 解析（scene/tag 锚点定位）、inspection 增强、revision diff 支持 |
| **android-reader**（`apps/android-reader/`，独立仓库） | 消费新契约、云端交互（issue/discussion/review 同步）、SourceAnchor 跳转统一、本地缓冲→云端同步 |

reader 侧子任务详见 android-reader 仓库 `docs/planning/r4-community-review-plan.md`。

## 契约对齐（R3 调研识别的差距）

| 差距 | community-api 负责 | runtime 负责 | reader 负责 |
|---|---|---|---|
| issue location 自由文本 → SourceAnchor[] | 定义 + 存储 anchor 结构 | 解析 scene/tag 锚点 | 消费 anchor 做跳转 |
| IssueSource 枚举不对齐 | 统一枚举值 | — | 同步枚举 |
| issue 无 status/revisionId/createdAt | 补字段 + action log | — | 同步 domain + DTO |
| discussion/thread 未实现 | 新建实体 + 端点 | — | companion 展示 |
| review 提交不回传 | POST 返回完整 + GET | — | 接上 submitReview |
| CommentSummary 结构不同 | 统一结构 | — | 同步 |

## 核心设计：结构化 SourceAnchor

跳转绑在位置标签上，而非 issue/discussion 实体。issue/discussion/review 携带 `SourceAnchor[]`：

```text
SourceAnchor
  ├─ type: "line" | "scene" | "time" | "range" | "tag" | "none"
  ├─ line? / endLine?     （line/range）
  ├─ scene?               （scene，依赖脚本场景标记语法 = Phase B）
  ├─ timeMs?              （time）
  ├─ tag?                 （tag，依赖脚本自定义标签 = Phase B）
  └─ label: String        （人类可读）
```

- scene/tag 类型依赖 Phase B 脚本语法，R4 先定义模型 + line/time 实现，scene/tag 待 Phase B。
- community-api 的 issue `location` 字段演进为 `anchors`（或兼容过渡）。
- runtime 负责把 scene/tag 锚点解析为可定位目标（需读取脚本 AST）。

## 工作包与仓库分配

### 跨仓库契约层
- **R4-A** issue 契约对齐（三方）：SourceAnchor 定义 + issue 字段补全 + 枚举统一
- **R4-F** SourceAnchor 跳转（reader + runtime）：anchor → 可跳转目标

### community-api 层
- **R4-B** issue action log：`POST /issues/:id/actions`
- **R4-C** issue 创建：`POST /works/:id/issues`
- **R4-D** discussion/thread：实体 + `GET/POST /issues/:id/threads`
- **R4-E** review 闭环：POST 返回完整 + `GET /works/:id/reviews`
- **R4-G** CommentSummary 统一

### reader 层（详见 android-reader r4-community-review-plan.md）
- 消费以上 community-api 新端点
- 本地缓冲 → 云端同步（衔接 R3 的 local_issue_overrides.synced / local_revisions.synced）
- SourceAnchor 跳转 UI

### runtime 层
- SourceAnchor 的 scene/tag 解析（依赖 Phase B AST）
- revision diff 支持（衔接 reader 的 local_revisions 编辑 UI）

## 依赖

```text
R4-A 契约对齐（三方地基）
  ├─→ R4-F 跳转（reader + runtime）
  ├─→ R4-B action log（api）→ reader 消费
  ├─→ R4-C issue 创建（api）→ reader 消费
  ├─→ R4-D discussion（api）→ reader 消费
  └─→ R4-E review（api）→ reader 消费
R4-G CommentSummary（独立）
```

## 与 Phase B 的衔接

- SourceAnchor 的 scene/tag 依赖脚本场景标记语法（Phase B 语言层）。
- R4 先做 line/time 类型的完整链路；scene/tag 待 Phase B 语法就绪后激活。
- runtime 的 scene/tag 解析需要 Phase B 的 AST 支持。

## 前置条件

- R3（完善本地阅读器）完成：R4 的云端同步依赖 R3 的本地数据层（local_issue_overrides / local_revisions）。
- community-api 从内存 mock 演进为可持久化（至少文件/SQLite，支撑 action log 和 discussion）。
