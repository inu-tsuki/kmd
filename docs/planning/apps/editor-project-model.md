# Editor workspace / project model

> 文档状态：草案 / 未实施
> 最近更新：2026-08-12
> 触发来源：PR #29 对 `projectThemeLoader.ts` 的审查

## 结论

当前代码中的 `projectRoot` 只是用户通过 File System Access API 打开的**创作工作区根目录**，
不是已经标准化的 KMD Project。`project.yaml.editorTheme` 是 editor 的局部实验入口，不能据此
宣称仓库已经定义了 project 格式，也不应继续把作品语义随意塞进该文件。

KMD 应保持三个层级：

| 层 | 权威内容 | 不应承载 |
| --- | --- | --- |
| `.kmd` document | 单脚本可独立解析、排版和播放的作者语义 | editor 面板状态、最近文件、发布状态 |
| editor workspace | entry、资产根、预览主题、打开文件、创作期缓存 | 可交换作品的稳定身份与 committed revision |
| `.kmdwork` / `Work` | 可交换/发布作品、bundle identity、entry、assets、revision | 本机窗口布局与临时预览偏好 |

已有权威分别是：

- `.kmd` 文档选项：`docs/knowledge/language/frontmatter-schema.md`；
- `Work` 概念：`docs/knowledge/architecture/work-kmd-content-model.md`；
- `.kmdwork` 容器：`docs/knowledge/architecture/work-bundle-format.md`。

## 建议的数据形状

editor workspace 若进入正式实现，应先命名为 `workspace.json`（名称仍待定），带独立
`formatVersion`，并只保存创作环境：

```ts
interface EditorWorkspaceManifest {
  formatVersion: 1;
  entry?: string;
  assetRoots?: string[];
  preview?: { theme?: string };
  session?: { openDocuments?: string[]; activeDocument?: string };
}
```

其中 `preview.theme` 只影响 editor/Monaco shell，不改写 `.kmd` frontmatter，也不进入 reader
作品语义。路径必须相对 workspace root，继续沿用当前目录逃逸防护。

## 实施顺序与本 PR 边界

1. 先用真实多脚本/资产作品验证 entry、asset root 和 session 字段是否必要；
2. 再定义 schema、迁移与错误诊断；
3. 将当前 `project.yaml.editorTheme` 迁到正式 manifest，并把代码中的 `project` 命名收敛为
   `workspace`；
4. 导出 `.kmdwork` 时只投影作品所需字段，不复制 editor session。

本 PR 只修复主题加载的运行时正确性并记录这个边界；不在缺少作品验证时仓促发布 project schema。
