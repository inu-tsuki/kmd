# Work And KMD Content Model

> 文档状态：Active
> 最近更新：2026-06-16
> 权威范围：KMD 生态中 `Work`（平台作品实体）与 `.kmd`（可播放源文件）的关系、revision 模型、`Work.presentation` 生成链、API 形状、issue/discussion/reference 实体设计、frontmatter 语义、客户端存储边界

本文固定 KMD 生态中 `Work` 与 `.kmd` 文件的关系。

## Core Semantics

`Work` 是平台作品实体。它描述一个作品如何在社区、审核、书架和推荐系统中存在。

`.kmd` 是可播放脚本文档。它描述 runtime 如何解析、排版、播放和调度文本演出。

二者必须绑定，但不应合并，也不应长期手写两份互相竞争的 presentation metadata。

```text
Work
  -> activeRevisionId
  -> KmdScriptRevision
      -> sourceUrl
      -> .kmd source
      -> optional assetManifest
  -> ScriptIssue[]
  -> DiscussionThread[]
      -> DiscussionReference[]
      -> DiscussionPost[]
  -> ReviewDecision[]
```

## Belongs In Work

- `id`
- `authorName`
- `lifecycleStatus`
- community category, tags, cover and listing description
- review state, moderation issues and reviewer notes
- comments, likes, reads, rankings and platform stats
- `activeRevisionId`
- `latestRevisionId`
- `submittedRevisionId` when a review queue needs a pinned submitted version
- source routing metadata such as `sourceUrl`

## Belongs In `.kmd`

- script text and command syntax
- script-local title or display title
- presentation hints that must travel with the script
- declared assets used by the script
- minimum KMD/runtime capability hints

The runtime should be able to play a `.kmd` source without knowing community review state. The community app should be able to list a `Work` without loading full script source.

## Revisions And Source Persistence

Once a work enters community, review, or discussion flows, script revisions must be preserved. Otherwise issue locations, source comments, review decisions, and version discussions lose their anchor.

`Work` is the stable work identity. It is not a script file and should not inline every source body.

```ts
interface Work {
  id: string;
  title: string;
  authorId: string;
  lifecycleStatus: 'draft' | 'submitted' | 'published' | 'needs_changes' | 'rejected';
  activeRevisionId: string;
  latestRevisionId: string;
  submittedRevisionId?: string;
  presentation: WorkPresentation;
  stats: WorkStats;
  createdAt: string;
  updatedAt: string;
}
```

`KmdScriptRevision` is an immutable community-side source version. It may come from an editor export, a local import, or a publish submission.

```ts
interface KmdScriptRevision {
  id: string;
  workId: string;
  parentRevisionId?: string;
  number: number;
  label: string;
  status: 'draft' | 'submitted' | 'approved' | 'published' | 'archived';
  sourceRef: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  submittedAt?: string;
  publishedAt?: string;
  summary?: string;
}
```

Revision source can be stored directly as text in the mock / early API stage, but it should remain conceptually separate from `Work`:

```ts
interface KmdRevisionSource {
  revisionId: string;
  mimeType: 'text/x-kmd';
  content: string;
  sizeBytes: number;
  contentHash: string;
}
```

Editor-side history and community-side revisions are related but not identical:

- Editor local snapshots are authoring convenience. They may be rewritten, deleted, squashed, or kept only on the author's machine.
- Community revisions are collaboration anchors. Submitted, approved, published, and reviewed revisions should be immutable.
- A future editor publish flow should turn a chosen local snapshot into a `KmdScriptRevision`.

## Metadata Authority

`.kmd` source is the authoring source for script-local playback metadata. `Work.presentation` is an indexed projection used by community lists, filters, cards, moderation queues, and offline shelves.

Long-term, `Work.presentation` should be generated when a `.kmd` revision is imported, submitted, or published:

```text
.kmd revision
  -> parse frontmatter / source metadata
  -> derive Work.presentation
  -> store indexed Work metadata
  -> serve Work list/detail without reading full source
```

This avoids two independent facts. If generated `Work.presentation` disagrees with the active `.kmd` revision, the revision is stale, the Work index is stale, or the importer has a bug. The app should treat that as a data consistency issue, not as an ordinary runtime choice.

Where `Work.presentation` has not been generated yet, mocks may duplicate the fields. Runtime playback then prefers `.kmd` source metadata; list and discovery UI may use `Work.presentation` as an index fallback.

## API Shape

Community services should expose:

```text
GET /works
GET /works/:id
GET /works/:id/revisions
GET /works/:id/source
GET /works/:id/revisions/:revisionId/source
GET /works/:id/issues
GET /works/:id/threads
GET /threads/:threadId/posts
```

Android should load:

```text
GET /works/:id        -> Work metadata and script sourceUrl
GET /works/:id/source -> text/x-kmd source
```

Then pass both to the runtime:

```ts
runtime.loadScript({
  work,
  source,
  assetManifest
});
```

Discussion endpoints may remain mock-only early on, but their identifiers must already be revision-aware.

## KMD-To-KMD References

Current API semantics still use one active `.kmd` revision as the entry source. If future language work allows a `.kmd` file to reference another `.kmd`, the referenced file should be treated as a controlled script dependency, not as an implicit second `Work`.

Those dependencies should be resolved through Work revision metadata, `assetManifest`, or a future import map before playback. The runtime should not freely fetch arbitrary relative `.kmd` paths during the hot play path.

## KMD Frontmatter

`.kmd` frontmatter is used for script-local presentation hints. These hints travel with the source because the runtime needs them even when a script is imported locally, outside the community API.

```kmd
---
title: Glass Rail
kmdVersion: 1
mode: stage
designWidth: 1920
designHeight: 1080
---

script...
```

Current Android Reader behavior:

- `mode` is runtime-facing playback metadata.
- `designWidth` / `designHeight` are stage design viewport metadata and should only be meaningful for `stage` / `interactive` scripts.
- `scroll` / `page` scripts are reading documents. They should adapt to the host container and should not depend on fixed design canvas dimensions.
- If these fields are missing, Android falls back to `Work.presentation`, which should later be generated from the same `.kmd` revision.

Platform state still stays outside the source file: review status, comments, ranking, lifecycle, source routing, and moderation notes belong to `Work`, not to `.kmd`.

## Issues, Discussions, And References

`ScriptIssue` and `DiscussionThread` are separate first-class entities.

An issue is structured review or inspection output. It is suitable for blockers, warnings, automated checks, reviewer findings, and resolution status.

```ts
interface ScriptIssue {
  id: string;
  workId: string;
  revisionId: string;
  severity: 'info' | 'warning' | 'error';
  source: 'runtime' | 'parser' | 'reviewer' | 'asset' | 'metadata' | 'accessibility';
  status: 'open' | 'resolved' | 'wont_fix';
  locationText: string;
  sourceRange?: SourceRange;
  message: string;
  suggestion?: string;
  createdBy: string;
  createdAt: string;
}
```

A discussion is human conversation. It should not be owned by an issue. Some discussions are general comments, some are review notes, some are source-line conversations, and some may later produce issues. Flattening discussion threads keeps the model flexible.

```ts
interface DiscussionThread {
  id: string;
  workId: string;
  kind: 'comment' | 'review' | 'question' | 'note';
  visibility: 'public' | 'reviewers' | 'author_reviewers';
  status: 'open' | 'resolved' | 'locked';
  createdBy: string;
  createdAt: string;
}

interface DiscussionPost {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt?: string;
}
```

Thread anchors, mentions, and smart-community metadata should be represented through references instead of sparse fields on `DiscussionThread`.

```ts
interface DiscussionReference {
  id: string;
  threadId: string;
  targetType:
    | 'work'
    | 'revision'
    | 'issue'
    | 'source_range'
    | 'playback_time'
    | 'asset'
    | 'user'
    | 'tag'
    | 'topic';
  targetId?: string;
  role: 'primary' | 'mention' | 'context';
  label?: string;
  payload?: {
    revisionId?: string;
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    timeMs?: number;
    tag?: string;
  };
}
```

Rules:

- Every `DiscussionThread` belongs to one `Work`.
- Specific anchors live in `DiscussionReference[]`, not in thread top-level fields.
- A thread should have at most one `primary` reference for default UI navigation.
- A thread may have many `mention` and `context` references for search, aggregation, AI summaries, and recommendations.
- `source_range` references must include `revisionId`; line numbers without a revision are unstable.
- Issue-related discussion is represented as `DiscussionReference(targetType = 'issue')`, not as an issue-owned child table.
- AI-generated topics, tags, and summaries can use the same reference mechanism with lower trust or different provenance metadata in future revisions.

Example:

```text
Thread: "这段横屏镜头在手机上有点晕"
  primary -> source_range(revisionId=rev-3, L42-L46)
  mention -> issue(issue-7)
  context -> playback_time(12500ms)
  mention -> tag("motion-sickness")
```

## Client Storage Boundaries

`community-api` should own community facts:

- works
- revisions
- revision sources
- issues
- discussion threads
- discussion references
- posts
- review decisions

Android Reader, future community web, and editor should treat those as remote facts and store only:

- local cache for offline display
- local drafts before submission
- pending actions for retry
- UI state such as selected thread, selected issue, or source viewer scroll

The editor may provide local version control for author convenience, but community discussion and review should bind to community `KmdScriptRevision` ids after submission.
