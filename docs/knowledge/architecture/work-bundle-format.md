# `.kmdwork` 作品包格式（骨架草案）

> 最近更新：2026-07-07
> 状态：骨架草案 —— 容器形态、分层结构与身份/revision 模型已决议；manifest 字段细节可演进
> 上游：[`work-kmd-content-model.md`](work-kmd-content-model.md)（Work/revision/presentation 概念模型）、
> [`../language/frontmatter-schema.md`](../language/frontmatter-schema.md)（前置：frontmatter 效力分层）
> 背景调研：Android reader 仓库 `docs/planning/r3-d-local-import-research.md`（现状勘察与问题清账）

`.kmdwork` 是 KMD 作品的**宿主导入/导出容器**：作者导出一个文件、读者导入一个文件，
在没有云端的情况下自包含合成出一个可播放的作品。它服务本地导入、"下载为本地"、
editor 导出与离线协作/版本交换。

## 1. 决议基线（已收束，非讨论）

| # | 决议 | 时间 |
| --- | --- | --- |
| B1 | 容器 = **zip 单文件**，扩展名 `.kmdwork` | 2026-06-22 |
| B2 | `.kmdwork` **不是 runtime 格式**。runtime 热路径只消费 `work + source/sourceUrl/assetManifest + settings`；宿主导入后必须展开/索引 | 2026-06-25 |
| B3 | 三层结构：source（脚本+资产）/ metadata（manifest+投影快照）/ history（revision manifest+origin） | 2026-06-25 |
| B4 | `.kmd` 脚本本体不承载 `Work.presentation`；bundle manifest 可保存**派生投影或导出时快照**，不得反向覆盖 source 播放事实 | 2026-06-25 |
| B5 | 社区平台状态（review status / commentSummary / ranking / lifecycle）不进本地权威；bundle 最多保存导出时只读快照并标注可能过期 | 2026-06-25 |
| B6 | revision 走**提交（commit）模型**：manifest 记录多个 committed revision；authoring 过程快照归 editor 工作区，不进 bundle | 2026-06-25 |
| B7 | **export snapshot ≡ 最新提交**：导出时若有未提交更改，editor 自动提交并提醒（editor 规范）。manifest 中 export 引用退化为指向某个 committed revision 的指针 | 2026-07-07 |
| B8 | 本地身份 = **bundleId（UUID）**，创建/首次导出时生成并写入 manifest，跨设备稳定；云端 workId 仅作 origin mapping；contentHash 仅作内容寻址/去重，不作身份 | 2026-07-07 |
| B9 | 宿主不依赖用户选择的外部原件作为长期唯一副本；打包/解包器自实现（未来手机端 editor 复用）；展开目录是可重建的 import/runtime cache，长期归宿是应用私有 bundle store | 2026-06-25 |

## 2. 容器结构

```text
<name>.kmdwork  (zip)
├─ work.json              # bundle manifest（§3）
├─ scripts/
│  └─ main.kmd            # entry script（由 work.json.entry 声明）
│  └─ ...                 # 多脚本扩展槽：语义未定稿，v1 只消费单 entry
└─ assets/
   └─ ...                 # assetManifest 引用的资产字节
```

多脚本方向已倾向"runtime/host 直接消费受控多脚本图，不 flatten"，但完整语义
（per-file frontmatter、module kind、per-file vs whole-bundle commit）未定稿——
结构只留扩展槽，v1 不承诺多脚本播放语义。

## 3. `work.json` 骨架

```jsonc
{
  "formatVersion": 1,
  "bundleId": "550e8400-...",          // B8：本地/跨设备稳定身份（UUID）
  "entry": "scripts/main.kmd",

  // B4：派生投影或导出时快照，服务离线列表/书架/预览/筛选；不覆盖 source
  "presentation": { /* 形状对齐 Work.presentation，字段见 work-kmd-content-model.md */ },

  // 复用 ReaderRuntimeAssetManifest 形状（ReaderRuntimeContract.ts:87-91），不另造类型
  // manifest 内 URL 使用 bundle 内相对路径；播放路径映射由宿主展开层负责（§4）
  "assetManifest": { "fonts": [], "assets": {} },

  // B6/B7：提交模型 revision manifest
  "revisions": [
    {
      "id": "rev-...",
      "parentRevisionId": null,         // 父提交；或 origin 云端 revisionId
      "contentHash": "sha256-...",
      "message": "...",
      "createdAt": 0,
      "remoteRevisionId": null          // 已推送云端时的 origin mapping
    }
  ],
  "exportRevisionId": "rev-...",        // B7：恒等于最新提交

  // 可选：云端下载为本地 / 曾上传过的作品
  "origin": { "workId": "...", "revisionId": "...", "sourceUrl": "...", "exportedAt": 0 },

  // 可选：B5 导出时只读快照，可能过期，不作本地权威
  "communitySnapshot": { /* title/authorName/tags/stats 等展示快照 */ }
}
```

字段命名与嵌套细节均可演进（formatVersion 兜底）；上表钉住的是**每个槽位的语义与归属**。

## 4. 导入/导出语义要点

- **展开层职责**（宿主侧，非 runtime）：zip → entry `.kmd` source + 受控的 assetManifest/baseUrl 映射 + 可构造 `Work` / `LocalLibraryEntry` 的 metadata + revision manifest。
- **presentation 冲突**：manifest 快照与 entry `.kmd` frontmatter 的播放事实冲突时，走警告/重新生成等导入策略，不得让快照覆盖 source（策略细节开放，见 §6）。
- **播放视图**：书架/播放始终展示 `exportRevisionId` 指向的版本（≡ 最新提交，B7）；revision 历史由审阅/diff 功能消费。
- **存储分层**（B9）：外部原件（仅导入来源记录/备份）→ 应用私有 bundle store（长期权威）→ 展开 cache（当前播放，可重建）。Android 侧落地见 reader 仓库 `r3-local-reader-plan.md`。

## 5. 安全清单（实现门槛，缺一不可）

- zip slip（路径穿越）防护；
- 解压大小/条目数上限；
- manifest 校验（formatVersion、entry 存在性、assetManifest 引用闭合）；
- contentHash 校验与重复路径/文件名编码处理。

## 6. 开放项

- manifest 字段命名细节、多 entry 表达、与 community-api detail DTO 的关系（同构 / 投影 / 独立）。
- presentation 冲突策略的具体档位（报错 / 警告 / 重新生成 / 双份标注来源）。
- committed revision 全量 snapshot vs diff（待典型作品规模估算；Android R3 先按全量 snapshot）。
- server-side bundle export endpoint vs 客户端拉 detail + revision source 自行组装。
- 多脚本语义全部（per-file frontmatter、module kind、revision 颗粒度、懒加载与离线完整性）。
- pack/unpack 规则的双实现策略（TypeScript / Kotlin 共享规范先行，还是参考实现先行）。
