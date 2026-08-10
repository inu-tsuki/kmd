# KMD Language Server 集成

> 文档状态：Active
> 最近更新：2026-08-10
> 权威范围：`packages/kmd-language-server` 与 `extensions/vscode-kmd` 的 LSP V1.1/V1.2 基线

## 边界

`packages/kmd-language-server` 是 Node 语言服务器宿主，不另写一套 KMD 语法。诊断语义来自
`@kmd/core/parser/Parser` 的 `parser.validate(text)`；语言服务器只负责把兼容验证结果适配为 LSP
`Diagnostic[]`，并通过 `TextDocuments` 跟踪文档。

`extensions/vscode-kmd/client.ts` 是轻量 VS Code client，只负责扩展生命周期、KMD 文档选择器和
Node IPC transport。语法高亮资产仍由 `packages/language` 与扩展内静态副本提供，二者同步门禁仍是
`pnpm language:check`。

```text
VS Code / 其他 LSP client
  -> Node IPC 或 stdio
  -> packages/kmd-language-server/src/server.ts
  -> validateKmdText(text)
  -> @kmd/core parser.validate(text)
  -> toLspDiagnostics(text, issues)
  -> publishDiagnostics
```

## Diagnostics 约定

- 文档同步使用 `TextDocumentSyncKind.Incremental`；每次内容变化重新验证当前完整文本。
- 文档关闭时发布空数组，清掉 client 侧残留 diagnostics。
- `toLspDiagnostics()` 是无状态纯函数，方便脱离 transport 单测。
- `parser.validate()` 返回 1-based 行号，LSP 使用 0-based 行号和 UTF-16 character offset。
- unknown-command 的范围在源码 command zone（block option 或顶层 `@` 后）重新定位到命令名，
  避免把同名正文标红，也修正 block option 经 legacy projection 后落到正文行的问题。
- 兼容验证层若重复返回相同 `line + message`，适配层只发布一次；其他错误保留原有顺序。
- 非 unknown-command 且没有列信息时，范围退化为目标行的非空白区域。

## 入口与构建

Server bundle 支持两种标准启动方式：

```bash
node packages/kmd-language-server/dist/server.js --stdio
node packages/kmd-language-server/dist/server.js --node-ipc
```

VS Code client 使用 `TransportKind.ipc`。其他编辑器可以直接启动同一 bundle 的 `--stdio` 模式。

仓库根命令：

```bash
pnpm language-server:typecheck
pnpm language-server:test
pnpm language-server:build
pnpm language-server:check
pnpm vscode-kmd:typecheck
pnpm vscode-kmd:build
```

`pnpm build` 会构建 server 与 client，`pnpm test` 会运行语言服务器测试。Server build 使用 esbuild
把私有、源码态的 `@kmd/core` parser 依赖收进 Node bundle；`vscode-languageserver` 协议运行库保留为
包依赖。`@kmd/core` 的 deep import 仍是 monorepo 内部接口，不构成独立发布承诺。

## 当前能力与后续

当前完成 TODO V1.1/V1.2 的可运行基线：server、双 transport、文档同步、diagnostics 和 VS Code
activate/deactivate client。Completion、hover 与 semantic tokens 属于 V1.3–V1.5，不在本基线内。
