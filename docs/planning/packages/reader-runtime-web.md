# Reader Runtime Web Package

> 文档状态：Active
> 最近更新：2026-07-12
> 权威范围：`@kmd/reader-runtime-web` 包的职责、禁止导入边界、build 命令、Core Extraction Gate（抽 `packages/core` 的触发条件）

`@kmd/reader-runtime-web` 位于 `packages/reader-runtime-web/`，负责构建 Android WebView 与普通浏览器可加载的 KMD reader runtime 静态产物。

## 当前职责

- 提供 reader-only HTML/bootstrap entry。
- 构建 `dist/reader-runtime/` 产物（Android 消费方式见 [`reader-runtime-web-bundle.md`](../../knowledge/integration/reader-runtime-web-bundle.md)）。
- 通过 `window.KmdRuntime.receive` / `window.KmdAndroid.postMessage` 与宿主交换消息（协议见 [`android-webview-runtime-protocol.md`](../../knowledge/integration/android-webview-runtime-protocol.md)）。
- 不依赖站点根路径（`base`、font copy 细节见 bundle 文档）。

## 当前过渡依赖

R7 不移动整条 runtime closure。包入口允许引用 `apps/editor/src/core/runtime`，并由它继续拉起 parser、layout、effects、stage、render 和 player。

禁止依赖：

- `apps/editor/src/components`
- `apps/editor/src/views`
- `apps/editor/src/store`
- `apps/editor/src/core/editor`
- Vue、Pinia、Monaco、TextMate、Oniguruma

## Build

```bash
pnpm reader:build
```

构建机制（`base`、font 复制、构建顺序、产物布局、Android Gradle 同步、generated assets 与 D0 fallback 关系）见 [`reader-runtime-web-bundle.md`](../../knowledge/integration/reader-runtime-web-bundle.md)。`@kmd/reader-runtime-web` 目前复用 editor 已安装的 Vite toolchain；runtime closure 迁出 `apps/editor/src/core/` 后再补独立依赖声明和发布脚本。

## Core Extraction Gate

暂不抽 `packages/core`。后续触发条件：

- runtime 内部 singleton 有更清晰的 session ownership。
- layout/stage/render host boundary 稳定。
- diagnostics 和 asset policy 不再依赖 editor 目录语义。
- Android 真机 WebView smoke 稳定消费 `dist/reader-runtime/`。
- Phase B 语言扩展不会破坏 reader runtime package boundary。

## Deferred Runtime Work

### Typography projection rebuild transaction

R3-I 的 Scroll/Page 字号热更新已可用，但当前实现复用 `ScriptPlayer.stop()` 后重建并 seek。
后续 runtime 生命周期收束应拆出静默 projection rebuild：捕获当前 time/phase/work/session，
清理旧 timeline、文本和 runtime 资源，重建后恢复 checkpoint，只对宿主发布最终状态。

这是一个集中式 runtime 工作包，不属于 Android Reader 的单项 UI 功能。目标是让
`updateSettings` 成为宿主可观察语义稳定的事务，并统一管理会改变 projection、时间线或
效果调度的宿主偏好。Android R3-I 只负责持久化、发送协议和设置入口；runtime 对这些字段
的实际消费、重建和事件所有权由本工作包负责。

**排期决定（2026-07-12）**：本工作包在 Phase B 新语法、execution plan 与 graph runtime
重构完成后实施，在 Phase C 非确定性交互 runtime 之前完成。INV-9 立即约束 Phase B 的接口
设计，但不要求在 legacy `ScriptPlayer` 上先实现完整 transaction；否则会围绕即将被替换的
segment/playback ownership 建一层短命抽象。

#### 1. 静默 projection rebuild

legacy Scroll/Page 字号热更新复用 `ScriptPlayer.stop()` 后重建并 seek；内部清理会向宿主
发送 `progress=0` 和空 markers，可能触发 Android 进度持久化或 UI 瞬态。应拆出静默
projection rebuild transaction：

- 捕获 work/session、time/progress、phase、播放状态与 timeline markers。
- 清理旧 timeline、文本、effect 和 GPU 资源，但抑制宿主事件。
- 用新 settings 重建 projection 并恢复 checkpoint/time/phase。
- 事务成功后只发布必要的最终 snapshot；失败时保留或恢复旧的可用 projection，并报告
  可关联到 command/session 的错误。
- 连续或重叠 settings 更新需具备 latest-wins/串行化所有权，旧 rebuild 不得覆盖新设置。

验收：rebuild 期间宿主不收到内部 `progress=0`、空 markers、`idle` 或重复 `ready`；不会
写坏阅读进度；暂停、播放、ended 三种 phase 均保持；连续 rebuild 不残留 Pixi、GSAP、
ticker、filter 或 listener 资源。

#### 2. Host preference projection policy

集中定义 settings 字段在不同 presentation mode 的语义，避免协议字段存在但无消费点：

- `fontScale`：Scroll/Page 作为阅读排版偏好参与 measurement 与 render；Stage/Interactive
  **按正式作者权威规则**尊重作品设计坐标，不直接缩放。若宿主仍展示统一“字号”控件，能力/不可用状态必须
  可查询，不能静默接受后无效果。
- `reducedMotion`：不是简单修改一个 duration。需覆盖自然播放、seek/replay、重建和
  交互触发四条路径，并明确 entrance、behavior、instant、stage/camera、transition 各类
  动效是缩短、替换为静态终态还是禁用。两条 apply 路径必须消费同一份预解析策略。
- 后续会改变 projection 或调度的 host settings 进入同一 transaction/策略层，不在
  `ReaderRuntimeSession.updateSettings()` 继续堆字段特判。

验收：每个公开 settings 字段要么有生产消费点和 mode matrix 回归，要么从 capability/API
中明确标为 unsupported；不允许“命令成功但行为为空”。`reducedMotion` 需有自然播放与
seek 双向回归、真实浏览器 smoke，以及切换前后播放位置/session 不变的宿主协议验证。

#### 3. 工作顺序与边界

1. 基于 Phase B 最终的 execution/graph ownership 建立 settings transaction 与宿主事件抑制测试夹具。
2. 将 typography rebuild 迁入事务并补浏览器/Android bridge 集成验证。
3. 写 reduced-motion mode/effect matrix，审查 effect pipeline 后再实现统一策略。
4. 暴露或固化 mode capability，让 Android/Web host 能正确呈现控件可用性。
5. 在 reader artifact smoke 中验证设置热更新，而非只跑 editor Node 回归。

本工作包不要求抽取纯 `@kmd/core`，也不改变 Android 的 DataStore、Compose 主题或
自动保存开关。长期资源不变量见
[`lifecycle-invariants.md`](../../knowledge/runtime/core/lifecycle-invariants.md)，其中 INV-9
是所有 host preference projection 的作者权威边界。
