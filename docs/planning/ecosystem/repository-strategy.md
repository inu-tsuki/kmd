# KMD 仓库与本地开发编排策略

> 文档状态：草案
> 最近更新：2026-08-10

## 1. 当前判断

当前仓库已经不只是 `kmd-editor`。它同时承载了 KMD 核心 runtime、Web 编辑器、VS Code 扩展、Android Reader 产品规划和长期架构文档。因此更合理的定位是：

> KMD 主仓库，用于孵化 KMD 语言、核心 runtime 和第一批官方宿主应用。

此阶段可以将 GitHub 仓库命名为 `kmd`。当前已经完成低风险 app-shell 迁移：Web 编辑器整体位于 `apps/editor/`，并新增 `packages/language/` 承接共享语言资产。

2026-05-19 调整：Phase B 语言设计暂缓直接实施，先插入 reader-runtime-web 抽离阶段。目标不是立刻抽纯 `packages/core`，而是先形成 Android WebView 可宿主、无 Pinia/editor shell 耦合的 reader runtime。

2026-06-15 状态校准：Phase R 的 R0-R7 已完成，`packages/reader-runtime-web/` 已作为 workspace package 接管 reader-only bundle 构建。

2026-08-10 状态校准：共享 runtime 已物理迁入 private `packages/core/`。这次拆分只确立 monorepo 内部所有权和依赖方向，不把 Phase B 前的深层 API 冻结为稳定发布契约；npm 发布、独立版本与稳定 API 仍后置。

## 2. 整理原则

- KMD 核心只有一个事实来源。
- Android Reader、Web Reader、VS Code 扩展和未来社区 Web 都应复用核心 runtime，而不是复制 parser、layout 或 effect 语义。
- 仓库可以逐步拆分，但核心 API 稳定之前，优先保持主仓库孵化。
- 文档和产品计划应跟随主仓库维护，避免课程仓库成为唯一事实来源。
- `packages/core` 已晚于 reader-runtime-web 完成物理拆分；在语言/IR/API 稳定前保持 private，避免把内部 exports 误当成公共承诺。
- `reader-runtime-web` 可以先于 Phase B 抽离，因为 Android Reader 需要 WebView 可宿主的运行时产物。
- grammar、language configuration 等低耦合语言资产可以先包化，作为未来多宿主共享的最小边界。

## 3. 推荐本地目录

命名规则：

- **GitHub 仓库名**：使用 `kmd` 或 `kmd-*`，方便在仓库列表中识别 KMD 生态项目。
- **主仓库内部目录**：不重复 `kmd-` 前缀，避免 `kmd/packages/kmd-core` 这类冗余路径。
- **发布包名**：使用 npm scope，例如 `@kmd/core`，由 scope 表达生态归属。
- **产品名**：对外文案使用 `KMD Editor`、`KMD Reader Android`、`KMD Community Web` 等自然名称。

短期推荐：

```text
~/projects/kmd/
  kmd/                  # 当前主仓库，原 kmd-editor
  kmd-reader-android/   # Android 课程项目公开仓库
```

如果暂时不移动当前目录，也可以先维持：

```text
~/projects/playground/
  kmd/                  # 当前主仓库，远端可命名为 kmd
  kmd-reader-android/   # Android 课程项目公开仓库
```

长期推荐：

```text
~/projects/kmd/
  kmd/                       # 当前主仓库 / monorepo
  kmd-core/                  # 未来独立核心仓库，可选
  kmd-editor/                # 未来独立 Web 编辑器仓库，可选
  kmd-reader-runtime-web/    # 未来独立 Web 阅读 runtime 仓库，可选
  kmd-reader-android/        # Android 宿主
  kmd-vscode/                # VS Code 扩展，可选
  kmd-community-web/         # 官网/社区 Web，可选
```

`kmd-reader-runtime-web` 比 `kmd-reader-web` 更明确：它表示“Reader 的 Web Runtime”，而不是“Web 站点里的 Reader”。未来社区官网不使用 `kmd-web-reader` 或 `kmd-reader-web`，而使用 `kmd-community-web` 或 `kmd-site`。

## 4. 当前主仓库职责

当前 `kmd` 主仓库负责：

- KMD parser、IR、layout、effect、stage 和 rendering 相关源码。
- Web 编辑器应用。
- VS Code 扩展源码。
- 核心架构文档。
- Android Reader PRD、阶段计划和技术策略。
- 未来拆分前的 reader runtime 实验。

当前主仓库暂不负责：

- Android Studio 项目本体。
- 真实社区后端。
- 已发布 npm 包的多版本维护。
- 多仓库 release 编排。

## 5. Android Reader 仓库职责

`kmd-reader-android` 建议作为课程要求的公开仓库单独存在。

它负责：

- Android Compose 应用源码。
- 课程提交需要的 README、截图、页面流转图和阶段文档副本。
- 本地 mock 数据。
- `reader-runtime/` 占位说明或构建产物。

它不负责：

- 维护第二份 KMD parser。
- 维护第二份 layout 或 effect 实现。
- 复制整个 KMD Web 编辑器源码。

如果开发时暂时把 Android 项目放在当前主仓库目录下，例如：

```text
kmd/
  apps/android-reader/  # 单独 git 仓库，主仓库通过 .gitignore 忽略
```

主仓库应通过根级 `.gitignore` 忽略 `/apps/android-reader/`。这样它在文件系统上可以靠近 KMD 主仓库，但 Git 历史仍然保持分离。

长期更推荐兄弟目录：

```text
~/projects/kmd/
  kmd/
  kmd-reader-android/
```

## 6. 近期仓库结构

主仓库当前结构：

```text
kmd/
  apps/
    editor/                # Web editor shell 与 editor-only 集成
    android-reader/        # 可选本地 checkout，独立 git，主仓库忽略
  packages/
    core/                  # private 共享 runtime 源码包
    language/              # 共享 KMD grammar / language configuration
    reader-runtime-web/    # WebView/browser reader bundle
  extensions/vscode-kmd/   # VS Code 扩展
  docs/
    planning/
    knowledge/
    archive/
  dist/                    # apps/editor 构建产物
  scripts/
```

后续在产品/API 边界稳定后，可继续演进为：

```text
kmd/
  apps/
    editor/
    community-web/
  packages/
    language/
    reader-runtime-web/
    core/
    language-service/
  extensions/
    vscode/
  docs/
```

在 monorepo 内部，目录已经位于 `kmd/` 仓库下，因此不再添加 `kmd-` 前缀。对外发布时再通过仓库名或包名补足归属。

## 7. 拆分路线

### 阶段 A：主仓库改名

- GitHub 仓库命名为 `kmd`。
- README 改为 KMD 主仓库定位。
- Web editor 整体迁入 `apps/editor/`。
- 保留 `extensions/vscode-kmd/`。
- Android Reader 继续作为单独课程仓库。

### 阶段 R：Reader Runtime Web 抽离

在 Phase B 语言和 Segment Graph 前，先从 editor runtime 中抽出可被 Android WebView 宿主的 reader runtime：

```text
packages/reader-runtime-web/   # 目标形态，可先以 reader-only entry 过渡
```

本阶段要求：

- 不依赖 Pinia、Vue component、Monaco、editor panels。
- 提供 `createReaderRuntime(container, options)` session API。
- 通过 callbacks / message protocol 与 Android 或 editor shell 交互。
- 保持当前语言语义，不引入 Phase B 新语法。

详细计划见 `docs/planning/roadmap/phase-r-reader-runtime-web.md`。Android 侧可行性审计见 `apps/android-reader/docs/knowledge/integration/core-portability-webview-feasibility.md`。

### 阶段 B：主仓库内 core 物理拆分与语言演进

`packages/language/` 已作为先行包承接低耦合语言资产，`packages/reader-runtime-web/` 已在 Phase R 建立为 reader-only bundle 包。2026-08-10，共享 runtime 进一步物理迁入 private `packages/core/`，editor 与 reader 均通过 workspace package 消费。

当前 monorepo 形态为：

```text
apps/community-web/
packages/language/
packages/reader-runtime-web/
packages/core/
packages/language-service/
extensions/vscode/
```

此阶段继续使用 pnpm workspace 统一开发。`@kmd/core` 的深层 exports 是内部开发表面，不是稳定 npm API；Phase B 可继续重构 parser / execution / segment graph。

> 候选拆分对象不止 core：镜头/电影感能力（`StageRuntime` 等）作为“形态专属能力”，仍是未来插件化的候选。其能力分层依据与三段演进路径见 `presentation-modes-and-capability-layering-draft.md`（草案）。进一步拆包和公开发布仍受稳定 API 门槛约束。

### 阶段 C：独立发布

当 API 和语义稳定后，再考虑拆为独立仓库或发布包：

```text
@kmd/core
@kmd/reader-runtime-web
@kmd/language-service
```

Android Reader 之后应依赖稳定构建产物或 release artifact，而不是手动复制源码。

2026-05-20 决策：`@kmd/reader-runtime-web` 先作为 monorepo workspace package 存在，接管 `pnpm reader:build` 和 `dist/reader-runtime/` 产物，当时暂不抽 `packages/core`。

2026-08-10 后续决策：Android artifact 与 WebView smoke 已稳定，runtime closure 迁入 private `@kmd/core`；不随物理拆分发布 npm，也不冻结 Phase B 前 API。见 `docs/knowledge/decisions/2026-08-10-extract-private-core-package.md`。

## 8. 命名对照表

| 类型 | 推荐命名 | 不推荐命名 | 说明 |
|------|----------|------------|------|
| 主仓库 | `kmd` | `kmd-editor` | 当前仓库已超出编辑器范围 |
| Web 编辑器仓库 | `kmd-editor` | `editor` | 独立仓库需要 `kmd-` 前缀 |
| 核心仓库 | `kmd-core` | `core` | 独立仓库需要生态标识 |
| Android Reader 仓库 | `kmd-reader-android` | `android-reader` | 保留产品名和平台名 |
| Web Reader Runtime 仓库 | `kmd-reader-runtime-web` | `kmd-reader-web` / `kmd-web-reader` | 避免和官网或 Web 产品混淆 |
| 社区 Web 仓库 | `kmd-community-web` 或 `kmd-site` | `kmd-web-reader` | 明确这是社区/官网，不是 reader runtime |
| VS Code 扩展仓库 | `kmd-vscode` | `vscode-kmd` | 统一 `kmd-*` 仓库名前缀 |
| monorepo core 包目录 | `packages/core` | `packages/kmd-core` | 仓库内部不重复前缀 |
| monorepo reader runtime 包目录 | `packages/reader-runtime-web` | `packages/kmd-reader-web` | 表达 runtime 属性 |
| npm core 包 | `@kmd/core` | `kmd-core` | 使用 scope 表达归属 |
| npm reader runtime 包 | `@kmd/reader-runtime-web` | `@kmd/reader-web` | 避免含义过宽 |

## 9. 开源前检查

公开仓库前建议检查：

- `.gitignore` 是否排除 `node_modules/`、`dist/`、日志和本地调试输出。
- README 是否准确说明项目处于快速迭代期。
- 是否存在私密信息、课程账号、绝对路径或临时输出文件。
- 是否需要加入正式 `LICENSE`。
- 当前未提交变更是否能分成清晰的提交。

## 10. 当前建议

当前已经完成 app-shell 与共享 runtime 的物理分层：

- Web editor 位于 `apps/editor/`。
- 根目录保留 pnpm workspace 与转发脚本。
- `packages/language/` 提供共享 grammar/config 的包引用边界。
- Phase R 已完成 reader-runtime-web 包边界；`packages/core` 也已作为 private workspace package 落地。
- Android Reader 可以临时位于 `apps/android-reader/`，但保持独立 git 并被主仓库忽略。
- `packages/core/src/` 是共享 runtime 的唯一事实来源；`apps/editor/src/editor/` 只承载 Monaco/TextMate 等 editor-only 适配器。

第二阶段课程仓库初始化完成后，再考虑是否把本地主目录从 `playground/kmd` 移到 `projects/kmd/kmd`。

## 11. 稳定 API 与发布触发条件

`packages/core` 的物理迁移已于 2026-08-10 完成，但保持 private。以下条件改为稳定公共 API、独立版本或 npm 发布的 gate：

- Android Reader 课程仓库已经初始化并能独立提交。
- reader-runtime-web 已有可被 Android WebView 加载的 runtime bundle。
- runtime hot path 已移除 Pinia/editor shell 直接依赖。
- Phase B 的 `DocumentSemanticIR`、state/control-flow 和 segment graph 边界已经进入主线或完成设计审查。
- Web editor 与 runtime 的 import 边界足够清楚，能用 pnpm workspace 或 package export 表达。
- VS Code 扩展、Web editor 和未来 language service 对 grammar/runtime 的共享策略已经明确；当前 grammar 通过 `packages/language/` 提供包引用，扩展静态副本由共享清单和显式 `pnpm language:sync` 字节复制，`language:check`、根构建与扩展 package check 负责阻止漂移。
- `pnpm core:check`、`pnpm build`、`pnpm test`、`pnpm test:parser`、`pnpm reader:build` 与 Android Reader 的基础构建 gate 均可持续通过。

在 gate 满足前，允许继续调整 `@kmd/core` 深层 exports，但必须保持包私有、同步修改所有 workspace 消费者，并通过边界和行为门禁；不得把物理目录存在误写成稳定发布承诺。

当前边界要求：

- 主仓库继续叫 `kmd`。
- Android 课程项目使用独立仓库 `kmd-reader-android`。
- 当前主仓库内部保留 `packages/core/`、`packages/language/`、`packages/reader-runtime-web/`、`extensions/vscode-kmd/`、`docs/planning/roadmap/`、`docs/knowledge/language/`。
- 如需把 Android 项目临时放在主仓库目录内，应使用被 `.gitignore` 忽略的 `/apps/android-reader/`。
