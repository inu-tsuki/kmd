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
3. 入口主题按 VS Code JSONC 规则解析；若声明 `include`，则相对当前主题文件递归解析项目内基底主题。
4. 文件不存在或 JSONC/结构/继承无效时，恢复内置 `kmd-dark.theme.json`。若 `editorTheme` 字段本身
   格式错误，则保留当前主题并写 `[Theme]` 警告；两类错误都不阻止项目打开。

示例：

```yaml
editorTheme: ./themes/dracula.json
```

主题路径只能位于项目根目录之下。绝对路径、盘符路径、UNC 路径、URL 和规范化后越过项目根
目录的父级跳转会被拒绝。嵌套主题的 `include` 可以用 `../` 返回项目内上级目录；路径先相对
包含它的文件解析，再由 `FileSystemDirectoryHandle` 逐段读取，不接触浏览器沙箱之外的文件。

## 映射与兼容边界

Shell 映射覆盖 editor、side bar、title bar、status bar、input、list、panel、activity bar、
focus 和 error/description 等颜色。外部主题缺少某个键时，该键回退到与主题 `type` 对应的
内置色板值；空字符串或纯空白颜色也视为缺失，不会覆盖回退色，更不会保留上一个主题的残值。
`activityBar.background` / `activityBar.foreground` 作为一对强调背景与其前景应用于按钮等实色控件；
普通 editor / side bar / title bar 表面上的强调文字使用同主题类型的独立可读色，不会把按钮背景色
直接当文字色。

当前入口接受 VS Code JSONC 颜色主题，包括行/块注释、尾逗号与单字符串 `include`。继承规则为：

- `colors` 浅合并，子主题同名键覆盖；子值为 `null` 时删除 include 链中的继承颜色。合并完成后，
  被删除或缺失的 Shell 映射色会按最终 `type` 回退到 KMD 的 `dark` / `light` / `hc` / `hcLight`
  对应色板；Monaco 与 IDE Shell 使用同一份物化色板，不会把浅色或高对比主题混入暗色默认值。
- `tokenColors` 按基底在前、子主题在后追加，使子规则拥有更高覆盖机会。
- `name` / `type` 由子主题有值时覆盖，否则继承。
- include 相对当前文件解析；循环、超过 16 层、文件缺失、越根或任一层解析/结构错误都会使整棵
  主题失败，不会部分应用基底主题。

仍保留的边界如下：

- 不解析 VS Code 扩展清单、`.tmTheme`、外置 `tokenColors` 文件字符串或 semantic token 主题。
- TextMate selector 会按逗号拆分，并投影为每项最后一个正向 scope；完整的父作用域组合、排除
  selector 优先级仍由 VS Code 自身实现，Editor 不声称等价。
- `project.yaml` 只读取根级 `editorTheme` 的普通或单/双引号标量；flow collection（`[]` / `{}`）和
  block scalar（`|` / `>`）会作为不支持的配置拒绝，不实现完整 YAML 语义。
- 当前是项目打开/恢复时加载，不监听主题文件变化；重新打开项目即可重载。

这些限制使加载边界可预测：不支持的输入会回到内置主题，而不会部分应用一个结构损坏的主题。

## 回归验证

`apps/editor/src/test/theme-service.test.ts` 与
`apps/editor/src/test/project-theme-loader.test.ts` 覆盖：

- `tokenColors` selector、颜色与字体样式到 Monaco rules 的转换。
- 工作台颜色到 CSS variables 的覆盖与逐键 fallback。
- 四类主题的强调色前景/背景配对、普通表面文字对比度，以及 Editor/Splitter/drag ghost 变量化。
- 非法 JSON/非法 `tokenColors` 的内置主题回退。
- JSONC、相对 include、合并顺序、循环/深度限制与整棵失败回退。
- `project.yaml` 路径、配置文件缺失和项目根目录逃逸防护。
- Monaco / CSS 应用失败时的事务回滚，避免 active theme 与可见颜色分裂。
