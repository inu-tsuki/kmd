# KMD 仓库与本地开发编排策略

> 文档状态：草案
> 最近更新：2026-05-10

## 1. 当前判断

当前仓库已经不只是 `kmd-editor`。它同时承载了 KMD 核心 runtime、Web 编辑器、VS Code 扩展、Android Reader 产品规划和长期架构文档。因此更合理的定位是：

> KMD 主仓库，用于孵化 KMD 语言、核心 runtime 和第一批官方宿主应用。

此阶段可以将 GitHub 仓库命名为 `kmd`。当前已经完成低风险 app-shell 迁移：Web 编辑器整体位于 `apps/editor/`，并新增 `packages/language/` 承接共享语言资产；核心 runtime 仍暂时保留在 `apps/editor/src/core/`，不提前抽包。

## 2. 整理原则

- KMD 核心只有一个事实来源。
- Android Reader、Web Reader、VS Code 扩展和未来社区 Web 都应复用核心 runtime，而不是复制 parser、layout 或 effect 语义。
- 仓库可以逐步拆分，但核心 API 稳定之前，优先保持主仓库孵化。
- 文档和产品计划应跟随主仓库维护，避免课程仓库成为唯一事实来源。
- runtime 抽包应晚于第二阶段课程交付，避免把 package 边界和正在进行的核心重构混在一起。
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

主仓库近期保持低风险结构：

```text
kmd/
  apps/
    editor/                # 当前 Web editor；runtime 暂留在 src/core/
    android-reader/        # 可选本地 checkout，独立 git，主仓库忽略
  packages/
    language/              # 共享 KMD grammar / language configuration
  extensions/vscode-kmd/   # VS Code 扩展
  docs/
    core/
    android-reader/
    research/
    refactor/
  dist/                    # apps/editor 构建产物
  scripts/
```

后续在 runtime 边界稳定后，再演进为：

```text
kmd/
  apps/
    editor/
    community-web/
  packages/
    language/
    core/
    reader-runtime-web/
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

### 阶段 B：主仓库内抽包

`packages/language/` 已作为先行包承接低耦合语言资产。当核心 runtime 边界更稳定后，再从 `apps/editor/src/core/` 抽出：

```text
apps/community-web/
packages/language/
packages/core/
packages/reader-runtime-web/
packages/language-service/
extensions/vscode/
```

此阶段仍然可以使用 pnpm workspace 统一开发。

### 阶段 C：独立发布

当 API 和语义稳定后，再考虑拆为独立仓库或发布包：

```text
@kmd/core
@kmd/reader-runtime-web
@kmd/language-service
```

Android Reader 之后应依赖稳定构建产物或 release artifact，而不是手动复制源码。

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

当前已经完成低风险 app-shell 迁移：

- Web editor 位于 `apps/editor/`。
- 根目录保留 pnpm workspace 与转发脚本。
- `packages/language/` 提供共享 grammar/config 的包引用边界。
- Android Reader 可以临时位于 `apps/android-reader/`，但保持独立 git 并被主仓库忽略。
- `apps/editor/src/core/` 暂时仍是共享 runtime 的事实来源。

第二阶段课程仓库初始化完成后，再考虑是否把本地主目录从 `playground/kmd` 移到 `projects/kmd/kmd`。

## 11. 目录迁移触发条件

在以下条件同时满足前，不建议把 `apps/editor/src/core/` 抽进 `packages/core/`：

- Android Reader 课程仓库已经初始化并能独立提交。
- Phase B 的 `DocumentSemanticIR`、state/control-flow 和 segment graph 边界已经进入主线。
- Web editor 与 runtime 的 import 边界足够清楚，能用 pnpm workspace 或 package export 表达。
- VS Code 扩展、Web editor 和未来 language service 对 grammar/runtime 的共享策略已经明确；当前 grammar 已先通过 `packages/language/` 提供包引用，扩展打包复制流程仍待后续收敛。
- `pnpm build`、`pnpm test:parser` 和 Android Reader 的基础构建 gate 都可在迁移后恢复。

在触发条件满足前，推荐只做“外壳级整理”和“文档归档”：

- 主仓库继续叫 `kmd`。
- Android 课程项目使用独立仓库 `kmd-reader-android`。
- 当前主仓库内部继续保留 `apps/editor/src/core/`、`packages/language/`、`extensions/vscode-kmd/`、`docs/android-reader/`。
- 如需把 Android 项目临时放在主仓库目录内，应使用被 `.gitignore` 忽略的 `/apps/android-reader/`。
