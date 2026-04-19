# Parser Adaptation Outline

> 状态：升级版初步方案
> 目标：让 parser 从“过渡态 IR 生产者”适配到未来的多层 IR / middleware 架构
> 范围：`Parser.ts`、`AstParser.ts`、`lowering.ts`、`commandCatalog.ts`

## 背景

parser 已经完成第一轮重构：

- `KMDScanner` 主路径被替换为 `AstParser + lowering`
- 引入了 `ParagraphAst` 与 `ParagraphIR`
- 同时保留 `tokens/globalEffects` compatibility projection

这一步已经很重要，但它仍然面向当前 runtime 过渡期而设计。

现在的关键问题不是 parser 错了，而是：

- parser 输出还不足以直接支撑 layout / effect / stage 三大 middleware
- `lowering.ts` 仍然承担过多“过渡期兼容职责”
- TODO 中的 control flow / state / plugin / interpolation 语法还没有进入 parser 主设计

## 当前 parser 已经做对的事

### `AstParser`

- 语法和语义初步分层
- body / group / sugar / command chain 结构化
- source range 保留
- block option 与 `@` 链拆分

### `lowering`

- scope routing 已从旧 scanner 中抽离
- block option paragraph broadcast 已成为正式语义
- line-scope `lineScope` 机制已经落地

这些都应该被保留，而不是推倒重来。

## 当前 parser 的局限

### 1. `lowering.ts` 职责过厚

它同时承担：

- AST inline lowering
- scope routing
- paragraph broadcast / paragraph effect 决策
- legacy `tokens/globalEffects` 投影

这在过渡期是合理的，但未来应拆开。

### 2. 当前 `ParagraphIR` 仍偏兼容层

它更像“语义整理后、等待 runtime 继续解释”的中间结果，而不是 middleware-ready IR。

### 3. 链条节点仍然过度依赖 `EffectConfig`

这会限制未来表达：

- `hold(1s).goto(p1)`
- `ease(1s).goto(p1)`
- `+` 并发链
- 更丰富的 chain execution mode

### 4. parser 还缺文档级 control/state 结构

TODO 里的这些目标还没有进入 parser 主结构：

- `@ if / @ elif / @ else`
- `@ loop / @ while`
- `@ tag / @ jump / @ wait`
- `@ set`
- `Checkpoint.state`

### 5. anchor 仍然主要是字符串

像：

- `line.start`
- `prev.mid`
- `next.end`

对 parser 而言目前仍主要是普通字符串，而不是结构化 `AnchorRef`。

## 适配目标

parser 下一步不应直接负责 runtime 规划，而应负责把语义描述得足够清楚，让 middleware 接管。

目标是让 parser 输出：

- `DocumentAST`
- `DocumentSemanticIR`
- `SemanticParagraphIR`
- 结构化 `AnchorRef`
- 结构化 `ChainNode`
- 结构化 `ControlNode`
- 更明确的 cue family / scope / source range

建议 parser 面向的是一个注入式注册表视图，而不是 runtime manager singleton：

```ts
interface CommandRegistryView {
  has(name: string): boolean;
  getFamily(name: string): "effect" | "style" | "layout" | "stage" | "unknown";
  getMetadata(name: string): Record<string, unknown> | undefined;
}
```

## 建议的 parser 模块拆分

### 1. `DocumentParser`

新增，负责：

- frontmatter
- paragraph grouping
- line-head control flow 结构
- 文档级 tag / wait / branch / loop 标记

### 2. `AstParser`

继续负责：

- 段落内语法结构化
- inline/group/sugar/command chain AST

### 3. `AstNormalizer`

新增，可负责：

- markdown sugar 统一化
- block option 语法标准化
- chain 语法糖展开
- 续行符拼接

### 4. `ScopeRouter`

从现有 `lowering.ts` 中抽出：

- `f.` / `.` / block option scope routing
- paragraph / line / token / group cue 绑定

### 5. `SemanticLowerer`

负责：

- AST -> `SemanticParagraphIR`
- cue family 标注
- chain node 结构化
- anchor ref 结构化

### 6. `ControlFlowLowerer`

负责：

- `@ if / @ loop / @ jump / @ wait / @ set`
- document graph node / edge 结构化
- state-related cue lower

### 7. `CompatProjector`

仅负责：

- `SemanticParagraphIR` / `ResolvedParagraphIR` -> legacy `tokens/globalEffects`

这样 compatibility 将不再污染主 lowering。

## 需要新增的 parser 输出能力

### 1. 结构化 `AnchorRef`

建议至少支持：

- `named`
- `reserved(line/prev/next + point)`

未来可继续扩展 paragraph / bounds anchor，而不再靠裸字符串协议硬撑。

建议至少固定到这个粒度：

```ts
type AnchorRef =
  | { type: "named"; name: string }
  | { type: "reserved"; scope: "line" | "prev" | "next"; point: "start" | "mid" | "end" };
```

### 2. 结构化 `ChainNode`

不要继续把所有链元素都压成 effect config。

建议允许：

- `visual`
- `style`
- `stage`
- `layout`
- `delay`
- `advance`
- `ease`
- `parallel_group`

### 3. `ControlNode` / `ExprNode`

为 TODO Phase B 必须增加：

- `IfNode`
- `LoopNode`
- `WhileNode`
- `JumpNode`
- `WaitNode`
- `SetNode`
- `ExprNode`

### 4. `InterpolationNode`

为了支持正文中的 `{var.xxx}`，建议在 inline AST 中单独表示插值，而不是继续将其伪装为普通 text token。

### 5. richer cue metadata

parser 应输出足够支持 middleware 的 cue 元数据，例如：

- source scope
- command family
- explicit level
- anchor ref
- source location

但不必在 parser 内部决定最终 timeline 行为。

同时建议 parser 侧尽早区分：

- `authored cue`
- `lowered cue`
- `generated lifecycle cue`

即使 parser 不直接生成全部 lifecycle cue，也应为后续 middleware 保留统一命名空间和类型入口。

## 面向插件化的 parser 约束

TODO v1.7 明确要求：

- SugarRegistry
- Markdown sugar 可配置化
- Hook API
- 语法贡献 / GrammarService

因此 parser 适配方案必须提前预留：

- `SugarRegistry`
- `Scanner/Parser Contribution API`
- `afterParse` hook surface
- 可扩展的 AST node kind

这样未来插件才不需要再次穿透 parser 内核。

## parser 与 manager 的依赖方向

这一轮对 manager 的阅读说明：

- `EffectManager` / `StyleManager` / `LayoutManager` 的 kernel 基本健康
- parser 真正需要的是“命令注册表视图”，而不是直接依赖具体 runtime singleton

因此未来更健康的方向应当是：

- parser 注入 `CommandRegistryView`
- `commandCatalog` 基于 registry view 识别 family / metadata
- parser/LSP 不直接 import runtime manager singleton

这尤其重要，因为：

- `LayoutManager` 未来还需要 metadata 才更适合 planner / IDE 使用
- `StageManager` 当前已经带有 reader/runtime 依赖，不适合长期直接暴露给 parser

## parser 不应继续承担的职责

下一轮不建议继续把这些逻辑压进 parser：

- GSAP timeline 时序规划
- stage tween 冲突判断
- token-end / paragraph-start 等最终 lifecycle 决策
- seek / replay 记录生成

这些应该交给后续 middleware / execution planning 层。

## 兼容策略

在未来一段时间内，parser 仍应保持：

- `ast`
- `ir`
- `tokens`
- `globalEffects`

并行输出。

推荐方式：

1. parser 先输出新的 document/paragraph semantic IR
2. middleware 在实验期与 legacy runtime 并行接入
3. compat projector 保证旧链路继续工作
4. 等 `ScriptPlayer` / `TextPlayer` 不再依赖 `tokens/globalEffects` 后，再考虑精简 compat 输出

## 迁移顺序建议

1. 先定义 `AnchorRef`、`ChainNode`、`ControlNode`、`ExprNode` 类型
2. 增加 `DocumentParser` 与 `ControlFlowLowerer`
3. 拆分 `lowering.ts` 为 `ScopeRouter + SemanticLowerer + CompatProjector`
4. 保持现有 `ParagraphIR` 兼容输出，同时新增更清晰的 semantic IR
5. 对接三大 middleware：
   - layout
   - effect
   - stage
6. 为未来的 control/state middleware 输出文档级 semantic IR
7. 待 runtime 改造完成后，再逐步减少 legacy projection 的中心地位

## 与其他重构文档的关系

- layout 侧执行链见：`layout-refactor-outline.md`
- execution 侧装配链见：`execution-refactor-outline.md`
- IR 总体设计见：`ir-refactor-outline.md`

## 延后目标

以下内容本轮只先写进边界，不急于一次做完：

- parser 直接生成全部 lifecycle cue
  - 先保证 authored / lowered / generated 的命名空间一致，再逐步决定哪些生命周期 cue 由 parser 生成
- plugin hook 的完整执行时序
  - 这轮先预留 `SugarRegistry` / contribution / `afterParse` 等入口
- `DocumentParser` 与 `Parser.ts` 的最终合并策略
  - 先允许 façade 与新模块并存，等 control/state 真正进入主路径后再收口
