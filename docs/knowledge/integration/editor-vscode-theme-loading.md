# Editor VS Code 主题加载

KMD Editor 的主题入口是 `apps/editor/src/editor/ThemeService.ts`。默认主题是标准 VS Code
颜色主题 JSON：`apps/editor/src/themes/kmd-dark.theme.json`。主题同时作用于两层：

- `tokenColors` 转换为 Monaco `IStandaloneThemeData.rules`，用于 KMD TextMate 语法着色。
- `colors` 中的工作台颜色经固定映射写入根元素 CSS variables，用于 IDE Shell。

`kmd-lang.ts` 只负责把 Monaco API 交给 `ThemeService`，不再维护第二份内联主题。
TextMate tokenizer 返回最具体的原始 scope（例如 `keyword.operator.at.kmd`）；因此外部主题的
通用规则 `keyword.operator` 和 KMD 专用规则都能按 Monaco 点分层级命中。

## 项目加载

这里的“项目”是 File System Access API 打开的 editor workspace 俗称，并非已标准化的 KMD
Project；三层模型与后续迁移边界见 [`editor-project-model.md`](../../planning/apps/editor-project-model.md)。

打开或恢复一个 File System Access API 项目目录时，Editor 按以下顺序选主题：

1. 若根目录 `project.yaml` 含根级标量 `editorTheme:`，读取它指向的项目内相对路径。
2. 否则尝试根目录 `theme.json`。
3. 文件不存在或 JSON/结构无效时，恢复内置 `kmd-dark.theme.json`；配置路径缺失或无效会写
   `[Theme]` 警告，不阻止项目打开。

示例：

```yaml
editorTheme: ./themes/dracula.json
```

主题路径只能位于项目根目录之下。绝对路径、盘符路径和 `..` 父目录跳转会被拒绝；子目录由
`FileSystemDirectoryHandle` 逐段解析，不接触浏览器沙箱之外的文件。

## 映射与兼容边界

Shell 映射覆盖 editor、side bar、title bar、status bar、input、list、panel、activity bar、
focus 和 error/description 等颜色。外部主题缺少某个键时，该键回退到内置主题值，不会保留
上一个主题的残值。

当前入口接受可由 `JSON.parse` 读取的 VS Code `tokenColors` / `colors` 主题对象。边界如下：

- 不解析 JSONC 注释、尾逗号、`include` 或 VS Code 扩展清单；应提供已展开的标准 JSON 文件。
- TextMate selector 会按逗号拆分，并投影为每项最后一个正向 scope；完整的父作用域组合、排除
  selector 优先级仍由 VS Code 自身实现，Editor 不声称等价。
- `project.yaml` 只读取根级 `editorTheme` 的普通或单/双引号标量，不实现完整 YAML 语义。
- 当前是项目打开/恢复时加载，不监听主题文件变化；重新打开项目即可重载。

这些限制使加载边界可预测：不支持的输入会回到内置主题，而不会部分应用一个结构损坏的主题。

## 回归验证

`apps/editor/src/test/theme-service.test.ts` 覆盖：

- `tokenColors` selector、颜色与字体样式到 Monaco rules 的转换。
- 工作台颜色到 CSS variables 的覆盖与逐键 fallback。
- 非法 JSON/非法 `tokenColors` 的内置主题回退。
- `project.yaml` 路径、配置文件缺失和项目根目录逃逸防护。
