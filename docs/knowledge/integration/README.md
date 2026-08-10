# Integration Knowledge

> 最近更新：2026-08-10

这里收纳 KMD runtime 与宿主环境的集成知识，例如 Android WebView、Web editor shell、VS Code extension 和未来社区 Web。

## 放置规则

- 宿主协议、bridge contract、asset loading、WebView 限制、extension 集成经验放这里。
- 应用交付计划放 `../../planning/apps/`。
- runtime 内部机制放 `../runtime/`。

## 入口文档

- `android-webview-runtime-protocol.md`：Android Reader 与 `reader-runtime-web` 的 WebView bridge 协议。
- `editor-vscode-theme-loading.md`：Web Editor 加载 VS Code 颜色主题、映射 Shell 变量及项目路径边界。
- `reader-runtime-web-bundle.md`：reader-only Web bundle 的构建入口、产物布局和边界检查。
- `kmd-language-server.md`：KMD LSP server、diagnostics 适配与 VS Code client 的边界和验证方式。
