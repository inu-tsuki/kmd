# Phase B Prep Refactor Plan

> 状态：Implemented
> 定位：Phase A 与 Phase B 之间的短准备期
> 目标：根据原始 IR / layout / execution 大纲，收紧仍未真正处理的大文件与元信息缺口，让 Phase B 的 state / control-flow / segment graph 可以直接接入主链路

## 背景

Phase 1 至 Phase 6 已经完成了主链路收口：parser 边界、paragraph build、layout preflight、execution payload、stage runtime、diagnostics/audit 都有了稳定入口。

但回看最初大纲，还有几类文件更多是“适配了新版本”，没有真正按目标形态重构：

- `EffectProcessor.ts`
- `layoutPresets.ts`
- `layoutExpanders.ts`
- `LayoutEngine.ts`
- `stagePresets.ts`
- `AstParser.ts`

这些文件不会阻止当前功能运行，但会影响 Phase B 的第一批能力：`+` 并发链、续行符、文本插值、`StateStore`、`@ set`、`@ if`、`SegmentGraphPlan`。

## 阶段边界

这不是 Phase B 功能开发，也不是 Phase 7。

本阶段只做 Phase B 前置准备：

- 补 metadata / plan 输入 / host 边界
- 减少 runtime 现场推断
- 给 state/control-flow 留稳定入口
- 不引入完整 `DocumentSemanticIR`
- 不实现 `@ if / @ loop / @ jump`
- 不删除 legacy `play()`

## 原大纲对照

### `EffectProcessor`

原计划：

- 保留 track 分类、runtime apply、style recursive apply、effect result 汇总
- 移出 chain 默认模式推断、broadcast 语义、初始样式协议判断

当前缺口：

- 仍同时承担 layout / visual / stage 分流、timing 解释、style preview、group apply
- 仍需要 `EffectMiddleware` 前置元信息，帮助 Phase B 的并发链和 graph gate

### `layoutPresets` / `layoutExpanders`

原计划：

- `LayoutManager` 保持轻量 registry kernel
- 为 presets / expanders 补 `LayoutMetadata`
- 结构化 `AnchorRef / AnchorState`
- 区分 `LayoutCue` 与 `LayoutPolicy`

当前缺口：

- marker、design-space 原点、flow/goto、display offset 仍写在 operator/expander 内部
- IDE / Inspector / plugin 无法直接消费布局命令元信息

### `LayoutEngine`

原计划：

- 退回 layout host shell / state holder / compat facade
- 收紧 `readerApp` 直连
- 旧 report/export 只保留兼容入口

当前缺口：

- scroll-mode reflow、resize、viewport 仍直接依赖 `readerApp`
- Phase B 若需要 headless build / graph bake，会被 host 依赖牵住

### `stagePresets`

原计划：

- 保留 runtime preset 注册路径
- 增加 planner 可消费的 stage metadata
- 将 stage property key、blocking、modifier、scene clear、conflict policy 显式化

当前缺口：

- preset 已适配 `StageRuntime`，但元信息仍分散在 `SegmentBuilder` / `TextStageCueScheduler` / `stagePresets`
- 冲突诊断仍难以前置到 StageMiddleware

### `AstParser`

原计划：

- 成为未来 `DocumentAST` 的 syntax frontend
- 支持 line-head control flow、续行符、并发链、文本插值
- 不承担 runtime track routing

当前缺口：

- paragraph AST 已有，但 document-level AST / control-flow AST 尚未落地
- B0 语法增强需要先固定 syntax-only 输出，不要直接落到 runtime token

## 工作包

### BP0. Scope and Guard Rails

目标：固定本阶段验收方式，避免准备期膨胀。

任务：

- 明确本阶段不实现 Phase B 用户可见语法
- 为每个工作包列出主路径不变的验证样例
- 继续使用 `pnpm build`、`pnpm test:parser` 和关键样例回归作为 gate

验收：

- 文档、TODO、README 都将本阶段标记为 Phase B prep，而不是新的 Phase A 重构期

### BP1. Effect Metadata and Processor Slimming Prep

目标：让 `EffectProcessor` 更接近 runtime helper，为 `EffectMiddleware` 留出口。

任务：

- 为 effect/style/stage/layout 分类结果补一层稳定的 typed classification
- 将 style preview 判定从 `applyInitialStylesToStyle()` 中抽成可复用 policy helper
- 将 broadcast / default level / chain mode 判定记录为 plan metadata，而不是散在 runtime apply 中
- 保持 `EffectProcessor.apply*()` 行为兼容

验收：

- `TextPlayer` 与 `LayoutPlanner` 仍可复用分类结果
- 后续 B0 `+` 并发链可以生成多条独立 chain plan，而不是再次塞进 `EffectProcessor`

### BP2. Layout Command Metadata

目标：给 `layoutPresets` / `layoutExpanders` 补 metadata 层，不改变脚本语法。

任务：

- 定义 `LayoutCommandMetadata`
- 标记 command family：`anchor`、`flow`、`visual-offset`、`teleport`、`policy`
- 标记作用时机：`pre`、`post`、`runtime`
- 标记是否写 marker、是否破坏 flow、是否依赖 character measurement
- 让 `LayoutManager` 能读取 metadata

验收：

- IDE / diagnostics / future plugin 可以查询布局命令能力
- `layoutPresets` / `layoutExpanders` 不再是唯一语义说明来源

### BP3. Anchor and Layout Item Type Tightening

目标：收掉 Phase 6 审查中留下的 layout stream 类型松散问题。

任务：

- 让 layout stream text item 显式包含 `charData` 或更中性的 glyph payload 类型
- 减少 `LayoutPassRunner` 内的 `(item as any).charData`
- 为 reserved anchor 写入补最小结构化类型，先不改变脚本层 `prev.start / line.mid / next.end`

验收：

- `LayoutPassRunner` 不再依赖私有强转读取 glyph geometry
- 未来 `LayoutMiddleware` 可以继续保留 `LayoutStream` 为内部执行表示

### BP4. LayoutEngine Host Boundary Prep

目标：让 `LayoutEngine` 不再成为 Phase B headless build 的隐性阻碍。

任务：

- 抽出 scroll/reflow 所需的 host view 接口
- 将 `readerApp.pixiApp.screen`、ticker、renderer resize 读取收口到 host adapter
- 保留当前 singleton `layout` 对外 API
- 不改变 stage/scroll/page 的用户行为

验收：

- `LayoutEngine` 可以在没有直接 import `readerApp` 的情况下表达核心 layout state
- `dumpState/loadState`、global markers、scroll reflow 语义保持兼容

### BP5. Stage Preset Metadata

目标：为 StageMiddleware / graph runtime 准备 stage command 元信息。

任务：

- 定义 `StageCommandMetadata`
- 标记 camera property key：`camera.xy`、`camera.zoom`、`camera.rotation`、`offset.xy`
- 标记 command 是否 blocking、是否 modifier-based、是否 scene lifecycle cue
- 将 `MODIFIER_BASED_COMMANDS` 与 metadata 对齐
- 保持 `stagePresets` 的 runtime 函数不变

验收：

- `SegmentBuilder` 的 stage conflict / trim 逻辑能逐步改为读 metadata
- `TextStageCueScheduler` 不再需要独立维护 stage command 分类知识

### BP6. Parser Frontend B0 Readiness

目标：为 B0 语法增强准备 syntax-only AST，不直接推进 control-flow runtime。

任务：

- 明确 `AstParser` 对 `+` 并发链的 AST 形状
- 明确续行符预处理归属
- 明确 `{var.xxx}` 文本插值的 AST 节点
- 预留 line-head control-flow node 类型，但不执行 lowering

验收：

- parser 可以描述 B0/B1/B2 输入形状
- runtime compat projection 仍保持现有行为

## 推荐顺序

1. BP2 + BP5：先补 layout/stage metadata，风险低，收益立刻服务 diagnostics 与 planner。
2. BP1：再收 `EffectProcessor` 的分类与 preview policy，为并发链做准备。
3. BP3：收 layout item 类型，为 `{var.xxx}` reflow 和 IDE geometry 稳住输入。
4. BP4：收 `LayoutEngine` host 依赖，避免 Phase B graph bake 受 UI host 牵制。
5. BP6：最后进 parser syntax frontend，直接衔接 B0/B1。

## 完成定义

- 现有脚本行为不变
- `pnpm build` 通过
- `pnpm test:parser` 通过
- 关键样例回归通过
- `EffectProcessor`、layout command、stage command 都有可被 middleware 消费的元信息入口
- Phase B 可以从 B0/B1 开始，而不需要先解释旧 preset / processor 的隐式语义

## 实施记录

- 已加入 `LayoutCommandMetadata` / `StageCommandMetadata`，并让 manager/runtime 暴露 metadata 查询入口。
- 已补 `EffectCommandClassification` 与 style preview policy helper，保持既有 `partition` / `classifyByTrack` 行为兼容。
- 已收紧 layout glyph payload，移除 layout pass 中的 `any.charData` 读取，并为 reserved anchor 名称补最小类型。
- 已抽出 `LayoutHostView` / `ReaderLayoutHostView`，让 `LayoutEngine` 不再直接 import `readerApp`。
- 已预留 `DocumentAst`、parallel chain、interpolation、control-flow line 的 syntax-only AST 类型，不接入 runtime lowering。
- 自动验证：`pnpm build`、`pnpm test:parser` 通过；关键样例仍作为人工回归 gate。
