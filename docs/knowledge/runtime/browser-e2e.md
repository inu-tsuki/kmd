# Browser E2E

KMD 的浏览器 e2e 使用 Playwright Chromium 驱动 production reader bundle，覆盖 Node/headless 回归无法验证的 Pixi renderer、WebGL filter、ticker 与 Assets 缓存生命周期。

## Commands

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` 先构建 `@kmd/reader-runtime-web`，再启动本地 preview 并运行测试。CI 已有 reader build 时使用 `pnpm test:e2e:run`，避免重复构建。

## Test Boundary

- 通过正式 `window.KmdRuntime.receive` 协议加载、seek 和控制作品，不依赖 editor UI、Pinia store 或 Vite HMR module singleton。
- 针对发布 bundle 运行，测试入口与 Android WebView/browser reader 使用同一构建产物。
- fixture 继续放在 `apps/editor/public/tests/`；测试可通过 Playwright route 提供资源，不把测试资源复制进 reader 发布包。
- 断言稳定的运行时契约，例如 page/console 无错误、display tree 层级、texture/source 生命周期和 filter 归属。不要依赖 production 构造器名称；minification 会改写名称。
- screenshot 和 trace 只作为失败证据。只有视觉输出本身是契约且环境已证明稳定时，才添加像素快照基线。

## Required Scope

修改浏览器渲染、Pixi 资源生命周期、真实 ticker/rAF、WebGL filter 集成或 reader host 挂载行为时，除对应的 build/parser/playback/invariant/shader 门禁外，必须运行 `pnpm test:e2e`。

首个用例 `tests/e2e/fx-bg.spec.ts` 固化 `fx-bg.kmd` 的连续背景 seek：同 URL texture 不得被卸载，背景必须留在 content layer 之下，L32 的 `:bg` filter 必须挂到背景 sprite，且 runtime/page/console 不得报错。
