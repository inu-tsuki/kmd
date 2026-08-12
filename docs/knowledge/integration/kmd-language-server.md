# KMD Language Server 集成

> 文档状态：Active
> 最近更新：2026-08-13
> 权威范围：`packages/kmd-language-server` 与 `extensions/vscode-kmd` 的 LSP V1.1/V1.2 基线

## 边界

`packages/kmd-language-server` 是 Node 语言服务器宿主，不另写一套 KMD 语法。诊断语义来自
`@kmd/core/parser/Parser` 的 `parser.validate(text)`；语言服务器只负责把兼容验证结果适配为 LSP
`Diagnostic[]`，并通过 `TextDocuments` 跟踪文档。

`extensions/vscode-kmd/client.ts` 是轻量 VS Code client，只负责扩展生命周期、KMD 文档选择器和
Node IPC transport；它从扩展自身的 `dist/server.js` 启动 server，不解析 monorepo workspace 包。
语法高亮资产以 `packages/language` 为唯一源，扩展内保留 VSIX 所需的静态副本。修改源资产后
显式运行 `pnpm language:sync`，再用只读 `pnpm language:check` 验证字节完全一致。根构建、扩展
构建与 package check 都先执行 check；它们不会自动同步，避免构建过程掩盖未审查的 tracked diff。

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
pnpm language:sync
pnpm language:check
pnpm language:test
pnpm vscode-kmd:typecheck
pnpm vscode-kmd:build
pnpm --filter vscode-kmd package:check
```

`pnpm build` 会先检查语言资产副本，再构建 server、编译 client 并把 server bundle 复制进扩展；
`pnpm test` 会运行语言
服务器测试。Server build 使用 esbuild 把私有、源码态的 `@kmd/core` parser 与 LSP 运行库一起收进
Node bundle；client 也 bundle `vscode-languageclient`，只把 VS Code 宿主模块保留为 external，因此
VSIX 不携带 workspace 依赖或 `node_modules`。`@kmd/core` 的 deep import 仍是 monorepo 内部接口，
不构成独立发布承诺。

语言资产同步使用共享 pair 清单和 `copyFile`，不 parse/stringify JSON，因此 LF、CRLF、空白与
最终换行都保持原字节。同步前会检查全部 canonical source；任一源缺失时硬失败且不写任何副本。
pair 的 source/copy 路径会在任何文件 I/O 前校验为非空相对路径，并分别限制在
`packages/language/` 与 `extensions/vscode-kmd/` 内；绝对路径、错误根目录和规范化后越根的
父级跳转都会硬失败。
`node:test` 临时目录用例覆盖首次复制、byte-equal no-op、drift 替换和缺源零部分写。
扩展 `package:check` 从 manifest 的 grammar/configuration 路径读取静态副本，验证文件存在、JSON
可解析并与 canonical 字节相等。当前没有引入 `vsce`，这些门禁不声称已经实测最终 VSIX ZIP。

当前 LSP Range 适配仍从兼容层消息 `Unknown command: "x"` 中提取命令名。这是过渡实现：Phase B
parser 应直接返回带 source range / diagnostic code 的结构化诊断，届时删除消息文本反解析；本 PR
不扩 parser 诊断合同。

## 当前能力与后续

当前完成 TODO V1.1/V1.2 的可运行基线：server、双 transport、文档同步、diagnostics 和 VS Code
activate/deactivate client。Completion、hover 与 semantic tokens 属于 V1.3–V1.5，不在本基线内。
