# 解析器管线：从源码到运行时

> 本文档描述当前解析器主路径：`source -> AST -> IR -> legacy projection -> runtime`。
> 阅读 `LayoutStreamBuilder`、`TextBuilder` 或 `ScriptPlayer` 前，建议先建立这套心智模型。

## 总览

当前解析器不再由 `KMDScanner` 直接产出最终 `tokens/globalEffects`。
主路径已经改为：

```text
source text
  -> KMDParser.parse()
  -> KmdAstParser.parseParagraph()
  -> ParagraphAst
  -> lowering.ts
  -> ParagraphIR
  -> legacy projection (tokens/globalEffects)
  -> runtime
```

这里最重要的分层是：

- `AstParser` 负责“作者写了什么”
- `lowering` 负责“系统准备怎么执行”
- runtime 负责“实际怎么布局、播放、渲染”

## AST 层 (`AstParser.ts`)

`KmdAstParser` 只做语法结构化，不做最终执行路由。
它负责：

- 段落逐行解析
- block option 拆分
- inline body 递归解析（文本、花括号组、`|`、`>`, `~`, `^`）
- `@` 后命令链拆分
- 保留 `line/range/groupId/marks`

AST 节点描述的是源码结构，例如：

- `text`
- `group`
- `pause`
- `sugar`
- `command-chain`

这一层不决定 `.wave` 是广播到一行、整个段落，还是容器执行。

## IR 层 (`lowering.ts`)

`lowering.ts` 是当前真正的语义路由层。
它负责：

- 把 AST inline 节点降成 `ParagraphIR.inline`
- 处理 `f.` / `.` / block option 的作用域分发
- 把 block option 视觉命令改写为 paragraph broadcast 或 paragraph effect
- 生成兼容旧运行时所需的 `tokens/globalEffects`

注意：当前 `ParagraphIR` 仍是过渡态 IR。
它已经把“语法解释权”从旧 scanner 中拿出来，但 layout / playback / stage 还没有彻底分 lane。
例如 `pause`、`go/slow/fast` 仍然混在 inline 流里，方便兼容现有 runtime。

## 兼容层

`buildParagraphData()` 最终返回的仍然是 `KMDParagraphData`：

- `ast`
- `ir`
- `tokens`
- `globalEffects`
- `blockOptions`

之所以保留 `tokens/globalEffects`，是为了让旧调用方继续工作：

- `ScriptPlayer`
- Monaco 语义 token
- 旧测试与调试工具

这也是本次重构能相对平滑迁移的原因：解析器内部已经换成 AST/IR，但外部接口暂时仍兼容旧形状。

## 读码建议

如果你要继续阅读解析器和后续模块，建议按这个顺序：

1. `apps/editor/src/core/parser/Parser.ts`
2. `apps/editor/src/core/parser/AstParser.ts`
3. `apps/editor/src/core/parser/lowering.ts`
4. `apps/editor/src/core/render/text/TextBuilder.ts`
5. `apps/editor/src/core/layout/LayoutStreamBuilder.ts`

一句话记忆：

- `Parser.ts`：编排入口
- `AstParser.ts`：读语法
- `lowering.ts`：定语义
- `TextBuilder/LayoutStreamBuilder`：接执行
