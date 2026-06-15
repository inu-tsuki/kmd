# Reader Runtime Web Package

> 最近更新：2026-06-15

`@kmd/reader-runtime-web` 位于 `packages/reader-runtime-web/`，负责构建 Android WebView 与普通浏览器可加载的 KMD reader runtime 静态产物。

## 当前职责

- 提供 reader-only HTML/bootstrap entry。
- 构建 `dist/reader-runtime/`，供 Android Gradle 同步到 APK assets 的 `reader-runtime/` 目录。
- 通过 `window.KmdRuntime.receive(message)` 接收宿主命令。
- 通过 `window.KmdAndroid.postMessage(message)` 上报 runtime events。
- 维持 `base: './'` 和 font asset copy，避免依赖站点根路径。

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

`@kmd/reader-runtime-web` 目前复用 editor 已安装的 Vite toolchain。Android 侧真实 bundle 路径是 generated assets 中的 `reader-runtime/`；源码树里的 `app/src/main/assets/kmd-runtime/index.html` 只是 D0 fallback shell。等 runtime closure 真正迁出 `apps/editor/src/core/` 后，再给该包补独立依赖声明和发布脚本。

## Core Extraction Gate

暂不抽 `packages/core`。后续触发条件：

- runtime 内部 singleton 有更清晰的 session ownership。
- layout/stage/render host boundary 稳定。
- diagnostics 和 asset policy 不再依赖 editor 目录语义。
- Android 真机 WebView smoke 稳定消费 `dist/reader-runtime/`。
- Phase B 语言扩展不会破坏 reader runtime package boundary。
