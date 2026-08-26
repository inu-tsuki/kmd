# Community API Collaboration Model

> 文档状态：草案 / 只读 revision-aware 基线已启动
> 最近更新：2026-08-12

## 1. 目标

本文规划 `community-api` 未来如何承载社区讨论、审阅、源码版本和问题追踪。它不是 Android 课程阶段的强制任务；当前课程阶段仍以 `GET /works`、`GET /works/:id/issues`、`POST /reviews` 为主。

长期事实模型见：

- `docs/knowledge/architecture/work-kmd-content-model.md`

## 2. 核心原则

- `community-api` 是社区事实来源。
- Android Reader、community-web、editor 都只是 client。
- `Work` 是作品身份，不直接等同于源码文件。
- `KmdScriptRevision` 是社区协作锚点，提交、审核、发布后的 revision 应保持不可变。
- 源码必须按 revision 保存，否则 issue、源码行讨论和审阅结论无法稳定回放。
- discussion thread 一律拍平为一等实体，不作为 issue 的子对象。
- thread 的锚点、提及、标签和 AI 上下文都通过 `DiscussionReference` 表达。

## 3. 领域实体

```text
Work
  -> KmdScriptRevision[]
      -> KmdRevisionSource
  -> ScriptIssue[]
  -> DiscussionThread[]
      -> DiscussionReference[]
      -> DiscussionPost[]
  -> ReviewDecision[]
```

### Work

保存作品身份和社区展示字段：

```ts
Work {
  id
  title
  authorId
  lifecycleStatus
  activeRevisionId
  latestRevisionId
  submittedRevisionId?
  presentation
  stats
  commentSummary
  createdAt
  updatedAt
}
```

### KmdScriptRevision

保存不可变源码版本的索引：

```ts
KmdScriptRevision {
  id
  workId
  parentRevisionId?
  number
  label
  status: draft | submitted | approved | published | archived
  sourceRef
  contentHash
  createdBy
  createdAt
  submittedAt?
  publishedAt?
  summary?
}
```

### KmdRevisionSource

早期可以直接存文本；后期可替换为文件、SQLite/Postgres blob 或对象存储。

```ts
KmdRevisionSource {
  revisionId
  mimeType: text/x-kmd
  content
  sizeBytes
  contentHash
}
```

### ScriptIssue

结构化问题，必须绑定 revision。

```ts
ScriptIssue {
  id
  workId
  revisionId
  severity
  source
  status
  locationText
  sourceRange?
  message
  suggestion?
  createdBy
  createdAt
}
```

### DiscussionThread

讨论线程本体只表达讨论自身；具体锚点不放在 thread 大字段里。

```ts
DiscussionThread {
  id
  workId
  kind: comment | review | question | note
  visibility: public | reviewers | author_reviewers
  status: open | resolved | locked
  createdBy
  createdAt
}
```

### DiscussionReference

统一表达锚定、提及、标签、源码范围、播放时间和智能社区上下文。

```ts
DiscussionReference {
  id
  threadId
  targetType:
    work | revision | issue | source_range | playback_time | asset | user | tag | topic
  targetId?
  role: primary | mention | context
  label?
  payload?
}
```

规则：

- 每个 thread 最多一个 `primary` reference。
- `source_range` 必须包含 `revisionId`。
- issue 讨论通过 `targetType = issue` 引用 issue，不由 issue 拥有 thread。
- AI 生成的话题和标签也走 reference，但后续需要补 provenance / confidence。

## 4. Editor 与社区 revision

Editor 可以实现简易版本控制，但分两层：

```text
Editor local snapshots
  -> 作者本地草稿历史，可改、可删、可 squash

Community revisions
  -> 提交、审核、发布的协作版本，应长期保存
```

推荐编辑器流程：

```text
Working Draft
  -> Save Snapshot
  -> Commit Revision
  -> Submit Revision
  -> Publish Revision
```

只有进入 `Submit Revision` 之后，discussion、issue 和 review 才绑定到 community revision id。

## 5. API 演进草案

当前已存在：

```text
GET  /works
GET  /works/:id
GET  /works/:id/source
GET  /works/:id/revisions/:revisionId/source
GET  /works/:id/revisions
GET  /works/:id/issues
POST /reviews
```

其中 `GET /works/:id/issues` 已支持可选 `revisionId` 精确筛选，seed issue 也已绑定 revision；
revision 列表只投影客户端元数据，并为每个 revision 返回不可变 source URL；不暴露服务器本地
`sourcePath`。`/works/:id/source` 只保留为 active revision 别名。当前仍是内存/seed 的只读协作基线，
尚未实现 revision 创建、提交、权限、持久化或 discussion。

下一步可以扩展：

```text
POST /works/:id/revisions
POST /works/:id/revisions/:revisionId/submit

GET  /works/:id/issues?revisionId=...
POST /works/:id/issues
PATCH /issues/:issueId

GET  /works/:id/threads?revisionId=...
POST /works/:id/threads
GET  /threads/:threadId/posts
POST /threads/:threadId/posts
```

可选便利接口：

```text
GET /issues/:issueId/threads
```

这个接口只是筛选 `DiscussionReference(targetType = issue)`，不表示 issue 拥有 thread。

## 6. 存储阶段

### Mock / 课程阶段

- seed works
- seed revisions
- seed revision sources
- seed issues
- in-memory reviews
- optional in-memory threads/posts

### 本地开发阶段

- SQLite 或 JSON 文件均可。
- 保持实体边界和 id 关系，不急着做权限。

### 社区阶段

- Postgres/SQLite 结构化保存 Work、Revision、Issue、Thread、Reference、Post。
- revision source 可继续存在数据库，也可迁到对象存储。
- comment summary、issue count、latest discussion 等聚合字段由后端生成。

## 7. Client 存储边界

Android Reader：

- Room 缓存 Work、Issue、Thread、Post。
- 保存 ReviewDraft 和 pending action。
- 不把社区事实当成本地权威。

community-web：

- 浏览器只保存草稿和 UI 状态。
- 通过 community-api 拉取社区事实。

editor：

- 本地保存 working draft 和 snapshot。
- 提交时创建 community revision。
- 提交后从 community-api 拉取该 revision 的 issue/discussion。
