# Phase R Reader Runtime Web Extraction Plan

> 状态：Done / integration follow-up
> 最近更新：2026-06-15
> 代号：Phase R

## 0. 当前状态

Phase R 的 R0-R7 已完成。`@kmd/reader-runtime-web` 已作为 workspace package 存在，`pnpm reader:build` 输出 `dist/reader-runtime/`，Android Reader 可在构建时同步该产物并通过本地 HTTPS 虚拟域名加载。

本文保留为 Phase R 的执行记录和后续 gate。当前不再把“抽离 reader-runtime-web”作为下一步；下一步是稳定 Android smoke、保持 package boundary，并完成 Phase B 语言设计收敛审查。纯 `packages/core` 仍后置。

## 1. 背景

Phase B 的语言设计已经扩展为完整新语法体系，不能再和 Android Reader 的可交付 runtime 需求绑在同一阶段里推进。

Android Reader 当前更急需的是：

- 一个可被 WebView 加载的 KMD reader runtime bundle。
- 一个稳定的 JS bridge / message protocol。
- 一个不依赖 Pinia、Vue、Monaco 和 editor panels 的 runtime API。

因此 Phase B 前先插入 Phase R：抽离 reader-runtime-web，而不是直接抽纯 `@kmd/core`。

## 1.1 Android 宿主现状复核

Android Reader 侧已经完成 D0 WebView 宿主雏形，不再只是远期计划。以下是 Phase R 启动时的基线：

- `ReaderRuntimeBridge` 已成为 ViewModel 与 runtime 的抽象边界。
- `WebViewReaderRuntimeBridge` 已能缓存命令、等待 runtime ready 后 flush，并接收 JS 事件。
- `ReaderRuntimeHost` 已用 `AndroidView(WebView)` 加载 D0 fallback shell。
- `RuntimeMessageCodec` 已使用 `{ version, id, type, payload }` 消息信封。
- 本地 `assets/kmd-runtime/index.html` 是 D0 fallback shell，可回传 `runtimeReady / ready / progressChanged / playbackStateChanged / inspectionReported / error`。

Phase R 完成后，真实 reader runtime bundle 的路径已经更新为：主仓库 `dist/reader-runtime/` -> Android generated assets `reader-runtime/` -> `https://kmd-reader-runtime.local/reader-runtime/index.html`。D0 shell 保留为 fallback。

这意味着 Phase R 的当前重心应放在 KMD 主仓库侧：产出真实 `reader-runtime-web` bundle，并让它适配 Android 已经验证过的宿主协议。

协议设计稿见 `docs/knowledge/integration/android-webview-runtime-protocol.md`。

需要继续注意的 Android 侧边界：

- WebView host 的 `unbind` 不是 runtime session `dispose`。真实 runtime 需要支持 host detach / rebind 后恢复或重载。
- 当前 `loadScript` 只发送 `Work` 元数据和 `contentUri`，真实 runtime 还需要明确脚本文本、受控 asset URL 或 Android 提供的 content resolver。
- 现有 codec 暂不使用 inbound `id` 做 command acknowledgement。真实 runtime 若需要 load/seek 错误回执，应补 ack/error correlation。
- `usesCleartextTraffic=true` 和开发服务器 URL 只应服务调试；release runtime 应优先使用 packaged assets 或受控 HTTPS。

## 1.2 Editor Runtime 现状复核

回到 `apps/editor/src/core` 后，Phase R 的最大风险不是 Android bridge，而是 editor runtime 的 composition 仍然被单例和 store 耦合固定住：

- `ScriptPlayer`、`TextPlayer`、`TextBuildContextResolver` 仍直接调用 `useEditorStore()`。
- `ReaderCanvas.vue` 直接拼装 `readerApp`、`scriptPlayer`、`layout`、`stageManager`，并把单例 player 写回 Pinia。
- `ReaderApp` 是全局单例，写入 `globalThis.__PIXI_APP__`，字体路径固定为 `/fonts/...`，`destroy()` 仍是占位。
- `ReaderLayoutHostView` 反向依赖 `readerApp`，使 layout host 不能自然替换为 reader runtime session 的 host。
- `parser/commandCatalog.ts` 已有 `CommandRegistryView` seam，但默认实现仍直接导入 effect/layout/stage manager；这不是 Phase R 的阻塞项，但会阻碍未来纯 `@kmd/core`。
- `ScriptSourceLoader` 会把看似路径的输入交给 `fetch()`，真实 Android runtime 应改为 host-provided `source` / 受控 `sourceUrl` / `assetManifest`。

因此 Phase R 的第一刀不应是“立刻抽包”，而是先在 editor 内部形成一个 reader runtime composition root：

```text
createReaderRuntime(container, options)
  -> owns Pixi application / ReaderHost / layout host / ScriptPlayer facade
  -> receives source and asset config from host
  -> emits callbacks instead of writing Pinia directly
  -> exposes bridge-compatible commands and events
```

这个 composition root 稳定后，再决定是否移动到 `packages/reader-runtime-web`。

R0 范围与依赖盘点见 `docs/planning/roadmap/phase-r-scope-inventory.md`。

## 2. 决策

当前抽离目标是：

```text
@kmd/reader-runtime-web
```

不是：

```text
@kmd/core
```

原因：

- 当前 runtime 仍依赖 Pixi、GSAP、DOM font loading、Canvas/WebGL 和 browser timing。
- Android WebView 可以承载这些 Web runtime 依赖。
- 纯 core 的边界仍会被 command registry、layout measurement、stage runtime 和 asset loading 牵扯。

长期顺序应为：

```text
packages/language
  -> packages/reader-runtime-web
      -> packages/core
```

## 3. 目标 API

Reader runtime 应暴露 session factory：

```ts
const runtime = await createReaderRuntime(container, {
  assetBaseUrl,
  typography,
  viewport,
  callbacks: {
    onReady,
    onProgress,
    onPlaybackStateChanged,
    onTimelineChanged,
    onDiagnostic,
    onError,
  },
});

await runtime.loadSource(source);
runtime.play();
runtime.pause();
runtime.seek(seconds);
runtime.setTimeScale(1.25);
runtime.inspect();
runtime.dispose();
```

runtime 内部可以继续复用当前 parser/layout/effect/stage 实现，但对外不暴露 editor store、Vue component 或 global app shell。

## 4. 工作包

### R0. Scope, Inventory, And Android Contract Sync

> 状态：Done。详见 `phase-r-scope-inventory.md`。

任务：

- 固定 Phase R 不引入 Phase B 新语法。
- 列出 reader runtime 禁止导入项：`pinia`、Vue components、Monaco、TextMate、editor views。
- 对齐 Android 文档 `apps/android-reader/docs/knowledge/integration/core-portability-webview-feasibility.md` 的 D0-D3 路线。
- 将 Android 当前 bridge 实现作为兼容目标：`loadScript / play / pause / seek / setInspectionEnabled / updateSettings / dispose`。
- 固定第一轮不是直接移动 `apps/editor/src/core` 到 `packages/reader-runtime-web`，而是在 editor 内部先建立 reader runtime entry。
- 记录当前允许暂时保留的 Web runtime 依赖：Pixi、GSAP、DOM font loading、Canvas/WebGL、browser timing。
- 记录未来纯 core blocker：runtime command registry、stage/layout singleton、browser measurement。

验收：

- 主路线文档明确 Phase R 位于 Phase B 前。
- Phase R 文档记录 Android WebView D0 shell 已存在，后续不是从零实现宿主。
- 有一份 reader runtime 禁止导入清单和暂缓处理清单，避免把纯 core 目标误塞进 Phase R。

### R1. Runtime Host Contract

> 状态：Done。TypeScript 契约见 `apps/editor/src/core/runtime/ReaderRuntimeContract.ts`。

任务：

- 定义 `ReaderRuntimeOptions`、`ReaderRuntimeCallbacks`、`ReaderRuntimeSession`。
- 将 typography、viewport、assetBaseUrl、font manifest、presentation mode 作为 host config 注入。
- 明确 progress、timeline markers、diagnostics、error 的 callback payload。
- 明确 Android bridge 与 Web runtime 的命令/事件映射：
  - Android -> JS：`loadScript`、`play`、`pause`、`seek`、`setInspectionEnabled`、`updateSettings`、`dispose`
  - JS -> Android：`runtimeReady`、`ready`、`progressChanged`、`playbackStateChanged`、`inspectionReported`、`error`
- 明确 `loadScript` 的真实 payload：至少包含 `work` 元数据和 `source` / `sourceUrl` / `assetManifest` 中的一种。
- 定义 editor adapter：editor 侧把 callbacks 写回 Pinia，reader runtime 本体不 import store。

验收：

- runtime API 可以不引用 Pinia 类型表达完整 host 交互。
- Android D0 shell 的消息协议可以被真实 reader runtime 复用或以兼容层承接。
- Editor 可以通过 adapter 继续得到 currentTime、currentLine、timelineMarkers、base style。

### R2. Remove Editor Store From Runtime Hot Path

> 状态：Done。`apps/editor/src/core` reader 热路径已改为 runtime callbacks；Pinia 写入集中到 `apps/editor/src/runtime/readerRuntimeEditorAdapter.ts`。

任务：

- 从 `ScriptPlayer`、`TextPlayer`、`TextBuildContextResolver` 中移除直接 `useEditorStore()`。
- 改为通过 runtime callbacks / build context / host adapter 更新 currentTime、currentLine、timelineMarkers、base style。
- editor 侧增加 adapter，把 callbacks 写回 Pinia。
- 保留 Vue component 对 Pinia 的使用，但禁止 `apps/editor/src/core` reader hot path import `store/editorStore`。

验收：

- `apps/editor/src/core` 的 reader hot path 不再 import `store/editorStore`。
- editor 行为保持兼容。

### R3. Runtime Session And Lifecycle

> 状态：Done。`createReaderRuntime(container, options)` 已成为 editor 的 reader 挂载入口；session 区分 `detach()` 与 `dispose()`，并注入 layout host view。

任务：

- 引入 `createReaderRuntime(container, options)`。
- 将 `readerApp` / `scriptPlayer` / `stageManager` / layout state 的使用收口到 session lifecycle 或 session facade。
- 增加 `dispose()`，清理 ticker、GSAP tween、Pixi containers、active behaviors。
- 区分 host attach/detach 与 runtime dispose：WebView 重建时可以重连、重载或恢复 session，而不是把页面切换等同于销毁作品。
- 让 `ReaderLayoutHostView` 不再直接 import `readerApp`；layout host view 应由 runtime session 注入。
- 第一轮可以保留内部 manager singleton，但它们必须被 runtime facade 包起来，不继续作为 editor shell 的拼装接口。

验收：

- 同一页面可销毁并重建 runtime session。
- WebView 返回、旋转、重载有明确 lifecycle 入口。
- Android `ReaderRuntimeHost` 的 bind/unbind 模型有对应的 Web runtime 生命周期策略。
- `ReaderCanvas.vue` 可以逐步退化为 editor adapter，而不是直接拼装 core 单例。

### R4. Source And Asset Host Policy

> 状态：Done。`ScriptSourceLoader` 默认禁止 path-like 自由 fetch；`ReaderRuntimeSession` 负责受控 `sourceUrl` / `assetManifest` 解析；字体由 `assetBaseUrl` / font manifest 注入。

任务：

- 替换或包裹 `ScriptSourceLoader` 的自由 `fetch()` 路径策略。
- `loadScript` 支持 host-provided `source`，并对 `sourceUrl` 做 allowlist / assetBaseUrl 限制。
- 将 `ReaderApp.loadFonts()` 的 `/fonts/...` 改为 font manifest 或 `assetBaseUrl` 派生路径。
- 明确 Android packaged assets 与浏览器 dev assets 的路径差异。

验收：

- Android reader runtime 不依赖站点根路径。
- 真实 runtime 在缺少 `source/sourceUrl/assetManifest` 时返回结构化 `error`。
- Editor 样例脚本仍可通过 adapter 使用现有 public 资源。

### R5. Reader-Only Web Bundle

> 状态：Done。reader-only 入口已迁入 `packages/reader-runtime-web/`，`pnpm reader:build` 输出 `dist/reader-runtime/`，产物不包含 Vue / Pinia / Monaco / TextMate。

任务：

- 建立 reader runtime entry，不复用 editor app shell。
- 明确排除 Vue、Pinia、Monaco、TextMate、editor panels。
- 注入 fonts/assets 路径，不依赖站点根 `/fonts/...`。
- 输出 Android 可复制的静态 bundle。
- 产物能作为 Android generated assets 中的 `reader-runtime/` 目录被优先加载；`app/src/main/assets/kmd-runtime/index.html` 仅作为 D0 fallback shell 保留。

验收：

- bundle 可在普通浏览器独立加载最小 KMD 脚本。
- `pnpm build` 仍构建 editor；新增 reader build 命令或 workspace script。
- Android WebView 能加载真实 reader bundle 并收到 `runtimeReady`。

实现说明：

- Reader-only HTML：`packages/reader-runtime-web/src/index.html`。
- Browser/WebView bootstrap：`packages/reader-runtime-web/src/main.ts`。
- Build config：`packages/reader-runtime-web/vite.config.ts`。
- 输出目录：`dist/reader-runtime/`，Android Gradle 会同步到 APK assets 的 `reader-runtime/` 目录。
- 普通浏览器没有 `window.KmdAndroid` 时会自动加载最小 demo；Android WebView 中等待宿主通过 `window.KmdRuntime.receive(...)` 下发命令。

### R6. Android Bridge Contract Hardening

> 状态：Done。Android `RuntimeMessageCodec` 与 Web reader runtime 统一使用 v1 envelope；`loadScript` 真实 payload 已补 `source/settings`；v1 明确不引入 ack，失败通过 `error.commandId` 回传。

任务：

- 对齐 Android `ReaderRuntimeBridge` 与 JS runtime message envelope。
- 消息携带 `version`、`id`、`type`、`payload`。
- 保留 fake bridge 做 Android 单元测试。
- 决定是否引入 command acknowledgement：
  - 若需要，使用 inbound `id` 对齐 load/seek/dispose 成功或失败。
  - 若暂不需要，明确事件流是 fire-and-forget，错误统一走 `error`。
- 收紧 JS bridge 暴露面：只保留固定 `postMessage(message: String)`，不开放任意 JS 执行入口。

验收：

- Android D0 shell 与真实 reader runtime bundle 都能交换 `ready / progressChanged / playbackStateChanged / inspectionReported / error`。
- `RuntimeMessageCodecTest` 覆盖真实 runtime 需要的新增 payload 或 ack 约定。

实现说明：

- Web 侧新增 `ReaderRuntimeProtocol.ts`，统一校验 command envelope 并创建 event envelope。
- `window.KmdRuntime` 只公开 `receive(message)` 与只读 `getSessionId()`；Android 原生 JS interface 仍只暴露 `KmdAndroid.postMessage(message: String)`。
- Android `ReaderLoadRequest` 支持 `source/sourceUrl/assetManifest/settings`；当前 mock work 若未提供真实脚本文本，会生成最小 preview source，避免真实 runtime 收到不可加载 payload。
- `RuntimeMessageCodec.decodeInbound()` 校验 `version`，并解析真实 runtime 的 `state/timeMs/durationMs/code/commandId/recoverable` 等可选字段。
- R6 不引入 `commandAccepted/commandCompleted` ack。未来若需要，新增事件类型，不改变现有 `ready/progress/error` 语义。

### R7. Packaging Decision Point

> 状态：Done。建立 `@kmd/reader-runtime-web` workspace package 并接管 reader bundle 构建；Phase B 可以恢复规划，但纯 `packages/core` 仍后置。

任务：

- 评估 reader runtime 是否已经适合落入 `packages/reader-runtime-web`。
- 若 package boundary 清晰，则移动；否则先保留 reader entry，但禁止 editor-only imports 回流。
- 记录是否、何时再抽 `packages/core`。

验收：

- Android 可消费 runtime artifact。
- repository strategy 更新完成。
- Phase B 是否恢复实施有明确判断。

决策：

- `packages/reader-runtime-web/` 现在是 Android/WebView 消费的 runtime artifact 包，根命令 `pnpm reader:build` 已切到该包。
- 包边界已经排除 Vue、Pinia、Monaco、TextMate、editor panels。
- Android Reader 已通过 Gradle `syncReaderRuntimeDist` 消费 `dist/reader-runtime/`，并将产物打入 APK 的 `assets/reader-runtime/`。
- Android WebView 不再依赖 `file://` 加载真实 bundle，而是用 `https://kmd-reader-runtime.local/reader-runtime/index.html` 加本地 assets 拦截；D0 shell 保留为 fallback。
- 源码实现仍以 `apps/editor/src/core/` 为 runtime closure 的事实来源。这是过渡设计，不把 parser/layout/effects/stage/render/player 在 R7 同时搬出。
- 暂不抽 `packages/core`。抽 core 的前置条件是 runtime 内部 singleton、layout/stage/render host、diagnostics 与 asset policy 进一步稳定。
- Phase B 可以恢复到语言设计与特性规划，但实施时必须继续守住 reader runtime package 边界。

## 5. Gate

每个阶段至少保持：

- `pnpm build`
- `pnpm test:parser`
- `pnpm language:check`
- editor 样例脚本人工回归

R5 起新增：

- reader runtime browser smoke test
- Android WebView shell smoke test
- Android bridge codec/unit tests

当前验证顺序：

```bash
pnpm build
pnpm test:parser
pnpm language:check
pnpm reader:build
cd apps/android-reader
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

注意：`pnpm build` 会重建根 `dist/`，因此 Android 打包前需要重新运行 `pnpm reader:build`，确保 `dist/reader-runtime/` 存在。

## 6. Phase B 恢复条件

Phase R 已经满足的恢复前置条件：

- reader-runtime-web 已有可用入口或 package。
- runtime hot path 无 Pinia/editor shell direct import。
- Android WebView 已能加载最小 runtime bundle。
- source / asset / font loading 已经由 host policy 控制。

Phase B 仍需满足：

- Android 真机/模拟器 WebView smoke 与 artifact 消费链路稳定。
- Phase B 语言设计经过一次文档审查，确认不会重新污染 runtime boundary。
- `@kmd/reader-runtime-web` 的禁止导入边界继续成立。

在这些条件满足前，`docs/planning/roadmap/phase-b/1.6-phase-b-plan.md` 保持为 gated roadmap 与设计材料，不作为当前实施计划。
