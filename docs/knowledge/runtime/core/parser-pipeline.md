# 解析器管线：从源码到运行时

> 文档状态：Active
> 最近更新：2026-06-16
> 权威范围：KMD 解析器主路径 `source -> KMDParser -> AstParser -> lowering -> ParagraphIR -> legacy projection -> runtime`，以及解析器源码阅读顺序

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

注意：`ParagraphIR` 当前仍是过渡态 IR。
它已经把“语法解释权”从旧 scanner 中拿出来，但 layout / playback / stage 还没有彻底分 lane。
例如 `pause`、`go/slow/fast` 仍然混在 inline 流里，与现有 runtime 兼容。

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

这也是迁移相对平滑的原因：解析器内部已换成 AST/IR，外部接口仍兼容旧形状。

## 已知风险

### R-P1 · `AstParser.braceIdCounter` 单例累加，破坏连续 `parse()` 的确定性

> 发现：2026-07-20，处方 5 测试网织网过程中（`docs/planning/test-net-pr-summary-2026-07.md`）
> 性质：生产侧潜在确定性 bug，非测试侧问题
> 状态：未修复（测试侧用 fresh `KMDParser` 实例规避，**未改被测代码**）

`KMDParser` 是单例（`apps/editor/src/core/parser/Parser.ts:168` `export const parser = new KMDParser()`），其 `AstParser` 实例持 `private braceIdCounter = 0`（`AstParser.ts:26`），每次遇到 `{...}` 括号组时 `++this.braceIdCounter`（`AstParser.ts:304`）赋给 `groupId`，lowering 时映射到 `KMDToken.braceGroupId`。**该计数器跨 `parse()` 调用累加、从不重置**——同一输入第 N 次 parse 的 `braceGroupId` 会比第 N-1 次大一个递增量，`JSON.stringify` 输出非字节确定。

测试网黄金序列化因此无法用单例，改 `new KMDParser()` 每用例 fresh 实例（`apps/editor/src/test/parser-golden.test.ts`）。这是测试侧规避，**未触碰被测代码语义**。

生产侧风险：任何路径若连续调用 `parser.parse()` 多次并依赖 `braceGroupId` 的稳定值（例如缓存命中、diff 比对、跨会话序列化），会踩此坑。当前 `braceGroupId` 只在 `ScopeRouter.ts:55-57` 的组内映射消费（按 id 分组 effect 广播），不依赖具体数值，故生产未暴露——但这是"恰好没踩"而非"安全"。

修复方向（独立于本测试网任务）：在 `KMDParser.parse()` 入口或 `KmdAstParser.parseParagraph()` 入口重置 `braceIdCounter = 0`。需确认无路径依赖"跨 parse 的 braceGroupId 单调连续"（grep 未发现，但 Phase B 递归下降重写 parser 时应一并处理）。

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
