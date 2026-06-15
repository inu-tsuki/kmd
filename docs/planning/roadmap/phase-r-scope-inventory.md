# Phase R R0 Scope And Inventory

> 文档状态：Done record
> 最近更新：2026-06-16
> 对应工作包：`phase-r-reader-runtime-web.md` / R0
> 权威范围：Phase R / R0 的范围锁定——目标边界、reader runtime 禁止导入清单、暂留 Web 依赖、editor 耦合点盘点、纯 core blocker

## 1. R0 决策

Phase R 的目标是先形成 Android WebView 可宿主的 `reader-runtime-web`，不是一次性抽纯 `@kmd/core`。

本阶段固定以下边界：

- 不引入 Phase B 新语法、state、control-flow 或 Segment Graph。
- 不在 Android/Kotlin 侧重写 KMD parser、layout、effect 或 renderer。
- 不直接移动整个 `apps/editor/src/core/` 到 `packages/reader-runtime-web`。
- 第一刀先在 editor 内部建立 reader runtime entry / composition root。
- `packages/reader-runtime-web` 只在 entry、host contract、source/asset policy 稳定后再落包。

## 2. Reader Runtime 禁止导入

真实 reader runtime entry 不得导入：

- `pinia`
- `vue`
- `monaco-editor`
- `vscode-oniguruma`
- `vscode-textmate`
- `apps/editor/src/store/**`
- `apps/editor/src/components/**`
- `apps/editor/src/views/**`
- `apps/editor/src/core/editor/**`

真实 reader runtime hot path 不得出现：

- `useEditorStore()`
- 直接写 Pinia state
- 直接依赖 Vue component lifecycle
- 从 editor panel 或 Monaco 模块读取 runtime 配置
- 把 Android WebView bridge 当作任意 JS 执行通道

允许 editor adapter 使用 Vue/Pinia，但 adapter 必须位于 runtime entry 外侧。

## 3. 暂时允许保留的 Web Runtime 依赖

Phase R 不是纯算法 core，因此以下依赖可以暂时保留在 reader runtime web 中：

- PixiJS
- GSAP
- DOM `FontFace` / `document.fonts`
- Canvas / WebGL
- `window.devicePixelRatio`
- browser timing APIs
- browser-hosted asset loading

这些依赖必须被 host config 包起来，不能写死到 editor shell。

## 4. Android Bridge 兼容目标

Android D0 shell 已验证 WebView transport。Phase R 真实 runtime 必须与既有 v1 命令、v1 事件和 `{ version, id, type, payload }` 信封兼容——命令、事件、信封、ack 策略与生命周期的完整定义见 [`android-webview-runtime-protocol.md`](../../knowledge/integration/android-webview-runtime-protocol.md)。

## 5. Editor Runtime 当前耦合点

R0 盘点确认以下位置是 Phase R 的主要拆分对象：

| 耦合点 | 当前位置 | R 阶段处理 |
|---|---|---|
| Pinia 写入 | `ScriptPlayer.ts`, `TextPlayer.ts`, `TextBuildContextResolver.ts` | R2 改为 callbacks / build context / editor adapter |
| runtime 拼装在 Vue 组件里 | `components/ReaderCanvas.vue` | R3 退化为 editor adapter |
| Pixi app 单例 | `core/App.ts` | R3 收口到 runtime session 或 session facade |
| 固定字体路径 | `core/App.ts` 的 `/fonts/...` | R4 改为 font manifest / `assetBaseUrl` |
| layout host 反向依赖 app | `layout/ReaderLayoutHostView.ts` | R3 改为 session 注入 |
| 自由 `fetch()` 脚本路径 | `player/ScriptSourceLoader.ts` | R4 改为 host-controlled source policy |
| parser 默认 registry 抓 runtime manager | `parser/commandCatalog.ts` | Phase R 记录为未来纯 core blocker |

## 6. 暂缓到纯 Core 的问题

以下问题不进入 Phase R 主目标，避免把 reader-runtime-web 误做成纯 `@kmd/core`：

- parser 完全脱离 effect/layout/stage registry。
- layout measurement 脱离 browser/Pixi host。
- stage/layout/effect manager 全部实例化、多 session 并行。
- command registry plugin API 正式化。
- Kotlin/Native 或 Android Canvas 版本 runtime。
- Phase B 的 state/control-flow/Segment Graph 语义。

这些问题会影响未来 `packages/core`，但不应阻塞 Phase R。

## 7. R0 完成判定

R0 完成条件：

- Phase R 明确位于 Phase B 前。
- Android D0 WebView host 已记录为既有事实。
- reader runtime 禁止导入清单已确定。
- Web runtime 暂留依赖已确定。
- editor runtime 当前耦合点已盘点。
- 纯 core blocker 已明确暂缓。

结论：R0 已完成，可以进入 R1 Runtime Host Contract。
