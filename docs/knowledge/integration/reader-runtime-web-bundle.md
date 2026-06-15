# Reader Runtime Web Bundle

> 文档状态：Active
> 最近更新：2026-06-16
> 权威范围：reader-runtime-web 的构建（`pnpm reader:build`）、`dist/reader-runtime/` 产物布局、Android Gradle 同步路径、`kmd-reader-runtime.local` 拦截、debug 探针、renderer crash 处理、bundle boundary、asset policy

`reader-runtime-web` 是 Android WebView 与普通浏览器可加载的最小 KMD 播放器产物。包入口位于 `packages/reader-runtime-web/`。在 `packages/core` 抽离前，它复用 `apps/editor/src/core/` 的 runtime closure，但不复用 Vue editor shell。

## Build

在仓库根目录执行：

```bash
pnpm reader:build
```

如果同一轮验证还要执行 editor 构建，推荐顺序是：

```bash
pnpm build
pnpm reader:build
```

`pnpm build` 会重建根 `dist/`，因此会清掉先前生成的 `dist/reader-runtime/`。Android 打包前必须确保 `pnpm reader:build` 已在最后执行过。

产物输出到：

```text
dist/reader-runtime/
```

该目录包含 `index.html`、runtime JS/CSS、`fonts/` 和 `runtime-manifest.json`。

Android Reader 当前通过 Gradle 在 `preBuild` 阶段同步该目录：

```text
dist/reader-runtime/
  -> apps/android-reader/app/build/generated/assets/readerRuntime/reader-runtime/
```

APK 中的实际路径为：

```text
assets/reader-runtime/index.html
```

`ReaderRuntimeHost` 通过本地 HTTPS 虚拟域名加载：

```text
https://kmd-reader-runtime.local/reader-runtime/index.html
```

并在 `WebViewClient.shouldInterceptRequest()` 中把该域名映射到 APK assets。这样 Vite 的 ES module chunks、CSS、fonts 可以按同源 HTTPS 方式加载，避免 `file://` 下 module/CORS 行为不一致。若 `reader-runtime/index.html` 不存在，Android 会回退到 D0 shell：

```text
assets/kmd-runtime/index.html
```

## Runtime Entry

入口文件位于 `packages/reader-runtime-web/src/main.ts`，HTML 位于 `packages/reader-runtime-web/src/index.html`。它只负责：

- 创建 `ReaderRuntimeWebSession`。
- 注册 `window.KmdRuntime.receive(message)`。
- 暴露只读 `window.KmdRuntime.getSessionId()` 便于调试；不要向 Android 增加其他 JS command 入口。
- 通过 `window.KmdAndroid.postMessage(message)` 上报 bridge event。
- 在无 Android bridge 的普通浏览器中自动加载一段最小 demo 脚本，便于 smoke test。

## Render Debug Probes

Android WebView 黑屏排查期间，runtime 可以安装两个临时可视探针：

- DOM probe：一个位于 WebView 左上角的普通 HTML 覆盖层，用于验证 WebView 页面和 DOM compositing 是否可见。
- Pixi probe：一个位于 Pixi stage 右上角的亮色 `Graphics` 方块，用于验证 Pixi canvas / WebGL 输出是否可见。

默认不启用探针。普通浏览器中可通过 URL 参数手动开启：

```text
?kmdDebugProbe=1
```

Android Reader 宿主侧通过 `BuildConfig.RUNTIME_VISUAL_DEBUG_PROBES` 控制原生调试探针。默认关闭；只有 debug 包并显式传入 Gradle 属性时，Android 才会追加 `kmdDebugProbe=1`，并启用原生 DOM canary、DOM snapshot 和 WebView 尺寸标签：

```bash
./gradlew :app:assembleDebug -Pkmd.runtimeDebugProbes=true
```

提交课程演示或正常验收包前不要传这个属性，release 包始终关闭。

判读方式：

- DOM probe 可见，Pixi probe 不可见：WebView DOM 正常，问题集中在 Pixi canvas/WebGL 输出。
- DOM probe 与 Pixi probe 都可见，KMD 文字不可见：问题集中在 Pixi Text、字体纹理或文字材质路径。
- DOM probe、Pixi probe、KMD 文字都不可见：优先检查 WebView 宿主尺寸、遮挡层、Activity/Compose 层级和页面加载。
- Pixi probe 与文字都可见：黑屏问题不复现，可继续看字体加载、内存压力或特定脚本状态。

探针会输出 `[KmdRuntimeProbe]` 日志；播放诊断仍由 `[KmdRuntimeDiag]` 记录。

Android WebView 中不要让 runtime 根容器只依赖 `html, body, #reader-root { height: 100%; }`。在 2026-05-20 的黑屏排查中，DOM snapshot 显示 `body` 与 `#reader-root` 的 `getBoundingClientRect().height` 都是 `0`，而 canvas 和 probe 节点已经存在，因此它们被 `#reader-root { overflow: hidden }` 裁掉。当前 reader bundle 使用 `#reader-root { position: fixed; inset: 0; height: 100dvh; }` 直接绑定 viewport，Android WebView 下还会由 `ReaderApp` 根据 `window.innerHeight` 写入明确 px 高度，避免父级高度链塌陷。

字体加载策略也要保守：FontFace API 成功注册的字体不再重复走 Pixi `Assets.load`。中文字体文件较大，重复加载会显著增加 Android WebView renderer 的内存压力。

## Android Renderer Crash

Android 模拟器日志中的 `GFXSTREAM ... set vao to self, no-op` 通常只是图形栈噪声，不应单独视为崩溃根因。真正需要关注的是 Chromium/WebView 自身的 renderer 退出日志，例如：

```text
cr_ChildProcessConn onServiceDisconnected (crash or killed by oom)
aw_browser_terminator Renderer process crash detected
```

宿主必须实现 `onRenderProcessGone`，并把这个事件当作可恢复失败处理：上报 runtime 错误、取消延迟 DOM probe、解绑 bridge、停止使用旧 WebView，并让用户返回后重新进入阅读。不要在 renderer 退出后继续 `evaluateJavascript`，否则会出现 `Application attempted to call on a destroyed WebView` 之类的二次噪声。

Android Reader 还会在 renderer 退出时输出 `Renderer crash report part N` 日志。报告包含：

- WebView URL、尺寸、是否 attached、硬件加速状态。
- Java heap 和系统可用内存摘要。
- 最近的 runtime bridge 命令、队列状态和 runtime event。
- 最近的 WebView page lifecycle、console message 和 host error breadcrumb。

复现 crash 时优先保存包含 `Renderer crash report`、`aw_browser_terminator`、`cr_ChildProcessConn` 和 `chromium` 的完整 logcat。若报告显示 `didCrash=false`，优先按 OOM/系统回收排查；若 `didCrash=true` 且内存不紧张，优先按 WebGL、字体纹理或 WebView provider native crash 排查。

Android Studio Profiler 的 `Track Java/Kotlin Allocations` 会给 App 主进程增加明显插桩压力，但 WebView renderer 的 WebGL、字体和 native 资源并不完整反映在 App Java heap 中。课程验收的性能检查优先使用 Memory 时间线、Heap Dump、Force GC 后回落情况和 logcat renderer crash report；长时间 allocation tracking 更适合作为压力测试。播放控制也应避免把 slider 的每一帧拖动都转成 runtime `seek`，当前 Android Reader 只在滑块松手时提交一次 seek。

当前 Android WebView 稳定性策略：

- 探针默认关闭，只在显式 debug 构建参数下启用。
- Layout、effect、player 等高频诊断日志也必须默认关闭。2026-05-20 的 Android WebView 崩溃排查中，renderer 退出前出现了大量 `[Layout-Diag]` 测量日志；这类日志会穿过 WebView console 回到宿主进程，放大布局、字体测量和 Chromium IPC 压力。当前 `LayoutPlanner` 只在 `KmdRuntimeConfig.debugOverlay`、`settings.debugOverlay`、`kmdDebugProbe=1` 或 `kmdLayoutDiag=1` 时输出测量诊断。
- WebGL 在 Android-like host 中优先使用 WebGL 1，并限制 Pixi batchable texture 数量。
- Android WebView / GFXSTREAM 对 WebGL sampler array 的未绑定 texture unit 很敏感。如果看到 `RENDER WARNING: there is no texture bound to the unit 31`，优先检查 Pixi batch shader 是否生成了过大的 `uTextures[]`，以及宿主是否已给全部 texture units 预绑定空纹理。当前 reader runtime 会在 Android-like host 中把 batch 上限压到保守值，并在每帧渲染前预绑定 `Texture.EMPTY`，避免未使用 sampler 为空。
- 不直接调用 `Application.resize()`。2026-05-26 的 Android WebView 崩溃中，UI-3 的 `updateSettings` 触发 runtime resize 分支，但当前 Pixi v8 bundle 中 `this.pixiApp.resize` 不是函数，导致 console error 后 renderer 退出。Reader runtime 统一通过 `ReaderApp.resizeToHost()` 适配：若宿主 Pixi Application 暴露 `resize()` 则调用，否则回退到 `renderer.resize(width, height)`。
- 字体优先通过 FontFace 注册；注册成功后不再重复交给 Pixi Assets 加载。Android WebView 中，如果宿主或作品没有显式提供 `fontManifest` / `assetManifest.fonts`，runtime 不自动加载默认随包字体。默认字体包中的 `LXGWWenKai-Regular.ttf` 和 `SarasaGothicSC-Regular.ttf` 都超过 20 MB，WebView renderer native 侧内存压力不会直接反映在 App Java heap Profiler 中。调试时可通过 `kmdLoadDefaultFonts=1` 强制加载默认字体。
- 若仍在模拟器中复现 renderer crash，优先验证真机；其次考虑缩减默认随包中文字体、按作品懒加载字体，或调整模拟器图形后端。

## Boundary

reader bundle 不应 import editor-only 模块：

- Vue components 或 views。
- Pinia store。
- Monaco、TextMate、Oniguruma。
- editor panels 和 dock UI。

`packages/core` 抽离前的过渡依赖（抽离条件见 [`planning/packages/reader-runtime-web.md`](../../planning/packages/reader-runtime-web.md) 的 Core Extraction Gate）：

- `packages/reader-runtime-web/src/*` 可以引用 `apps/editor/src/core/runtime`。
- 被 runtime closure 拉入的 parser/layout/effects/stage/render/player 仍暂存在 `apps/editor/src/core/`。
- 不得引用 `apps/editor/src/components`、`apps/editor/src/views`、`apps/editor/src/store` 或 `apps/editor/src/core/editor`。

产物级检查可以用：

```bash
rg -n "vue|pinia|monaco|textmate|oniguruma" dist/reader-runtime
```

## Asset Policy

Vite reader config 使用 `base: './'`，因此 Android packaged assets 和普通静态服务器都能用相对路径加载 runtime chunk。字体由 `packages/reader-runtime-web/vite.config.ts` 从 `apps/editor/public/fonts/` 复制到 `dist/reader-runtime/fonts/`。

宿主可以通过 `window.KmdRuntimeConfig` 或后续 `loadScript/updateSettings` payload 注入 `assetBaseUrl` / `assetManifest`。默认值是 `import.meta.env.BASE_URL`，在 reader build 中为 `./`。
