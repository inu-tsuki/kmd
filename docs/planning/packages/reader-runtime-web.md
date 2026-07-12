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

验收：reflow 期间 Android 不收到 `progress=0`、空 markers、`idle` 或重复 `ready`；连续 reflow
不残留资源；Stage/Interactive 不进入 typography reflow。长期不变量见
[`lifecycle-invariants.md`](../../knowledge/runtime/core/lifecycle-invariants.md)。
