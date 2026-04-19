# IR Refactor Outline

> 状态：升级版初步方案
> 目标：把当前“过渡态 ParagraphIR + runtime 现场编译”演进成正式的多层 IR 体系
> 重点：布局、特效、舞台三大中间件，并为 document graph / state / plugin 扩展预留结构

## 背景

当前 parser 已经能产出 `ParagraphIR`，但它仍然是过渡态：

- `inline` 里混有文本、pause、timing sugar、newline
- `paragraphEffects` 仍需要 runtime 再 partition
- 真正的 execution 规划实际在 `LayoutStreamBuilder`、`TextPlayer`、`ScriptPlayer` 中继续形成

因此当前的问题不是“有没有 IR”，而是：

- **语义 IR 已经存在**
- **功能上的 execution IR 还没有被正式命名和收束**
- **文档级 graph / state / plugin 扩展层还没有进入 IR 主设计**

## 总体目标

建立一套更稳定的 IR 栈，使：

- parser 负责语义整理
- middleware 负责 lane-specific 规划
- runtime 负责执行与 seek
- graph / state / plugin 不再作为后续补丁层，而成为一等结构

## 建议的 IR 分层

```text
Source
  -> DocumentAST
  -> DocumentSemanticIR
  -> SemanticParagraphIR
  -> ResolvedParagraphIR
  -> LayoutMiddleware / EffectMiddleware / StageMiddleware
  -> ControlFlowMiddleware / StateMiddleware
  -> ParagraphExecutionPlan
  -> SegmentExecutionPlan
  -> SegmentGraphPlan
  -> Runtime
```

## 各层职责

### 1. `DocumentAST`

负责容纳未来文档级结构：

- paragraph blocks
- line-head control flow markers (`@ if`, `@ loop`, `@ wait`, `@ tag`, `@ jump`)
- frontmatter
- future inline interpolation / continuation / parallel-chain syntax

### 2. `DocumentSemanticIR`

负责文档级语义整理：

- control flow nodes
- state expressions
- document-level anchors / tags
- segment boundaries
- default path hints

建议至少先固定到这个粒度：

```ts
interface DocumentSemanticIR {
  frontMatter: KMDMetadata;
  paragraphs: SemanticParagraphIR[];
  controlFlow: ControlNode[];
  documentTags: string[];
  defaultPath?: string;
  sourceMap: SourceOrigin[];
}
```

### 3. `SemanticParagraphIR`

这是 parser 输出的“段落级语义整理后 IR”。
它应保留：

- 段落内容 runs
- scope routing 结果
- command family
- anchor 引用
- chain 结构
- source range

但不直接绑定：

- GSAP timeline
- token-end / group-end 触发细节
- stage tween 冲突策略

### 4. `ResolvedParagraphIR`

这是 middleware 的统一输入。
相比 `SemanticParagraphIR`，它应进一步明确：

- cue scope
- lane
- default target granularity
- blocking policy
- anchor / lifecycle
- paragraph / line / token / group 级绑定关系

这里建议把 `ResolvedCue` 正式作为第一等结构，而不是只把 cue 当作 plan 里的匿名字段。

## Middleware 拓扑与依赖

建议先明确推荐顺序，而不是让各 middleware 彼此隐式耦合：

```text
SemanticParagraphIR
  -> EffectMiddleware
  -> LayoutMiddleware
  -> StageMiddleware
  -> ParagraphExecutionPlan
```

其中：

- `EffectMiddleware`
  - 先负责 style preview、chain mode、cue normalization
- `LayoutMiddleware`
  - 在测量时消费可影响 geometry 的 style/effect preview
- `StageMiddleware`
  - 通常在 layout 之后消费 anchor、placement、paragraph geometry

这不是说 effect 一定“先于” layout 执行，而是：

- 影响测量的 style 信息必须先进入 layout planning
- 依赖几何和 anchor 的 stage planning 不应继续早于 placement 猜测

## 三大中间件

### A. `LayoutMiddleware`

负责：

- 将文本 runs、layout cues、anchor refs 转为 layout plan
- 输出 preflight 几何与 final placement 所需结构
- 处理 `lineScope`、marker、reserved anchor、in-flow/out-of-flow

输入：

- text runs
- layout cues
- paragraph options
- anchor refs

输出建议：

- `LayoutPlan`
- `LayoutPreflightResult`
- `AnchorState`
- `LinePlan`
- `PlacementPlan`

这里需要特别收紧一个概念：

- `LayoutStream` 可以继续存在
- 但它应当只是 `LayoutMiddleware` 内部的执行表示
- 它不应继续扮演全系统通用 IR

也就是说，stage cue、playback cue、graph gate、state probe 不应再伪装成 layout stream item。

### B. `EffectMiddleware`

负责：

- 将 effect chains、style cues、timing cues 转为 playback/effect plan
- 统一链执行模式
- 明确哪些样式参与测量，哪些样式参与播放

输入：

- effect cues
- chain nodes
- resolved targets
- timing policy

输出建议：

- `EffectPlan`
- `ChainExecutionPlan`
- `BehaviorPlan`
- `EntrancePlan`
- `StyleReplayPlan`

重点是将这些规则正式化：

- `group_sync`
- `char_stagger`
- `char_tween`
- `container_only`

### C. `StageMiddleware`

负责：

- 将 stage cues 组织成 paragraph / token / group / segment 级 stage plan
- 定义 anchor 与 blocking
- 进行属性冲突诊断
- 生成 in-flight continuation 信息

输入：

- stage cues
- anchor refs
- paragraph / segment scope

输出建议：

- `StagePlan`
- `StageCue`
- `StageConflictDiagnostics`
- `InFlightStagePlan`

它应当成为未来 `scene.clear`、`cam.offset`、camera tween continuity 的正式承载层。

## 未来扩展所需的辅助中间件

虽然这轮重点仍是 layout/effect/stage 三大中间件，但如果要对齐 TODO，IR 设计必须同时为两类辅助中间件留位：

### D. `ControlFlowMiddleware`

负责：

- `@ if / @ elif / @ else / @ loop / @ while / @ jump / @ wait`
- 生成 `SegmentBoundaryPlan`
- 生成 `SegmentEdgePlan`
- 输出 default path 与 branch metadata

### E. `StateMiddleware`

负责：

- `StateRef`
- `ExprNode`
- `StateMutationCue`
- `StateSnapshotPlan`
- `StateReplayPlan`

这样未来的 `Checkpoint.state`、branch evaluation、wait signal 才不会变成 execution 层临时补丁。

## 共享基础类型

不管是哪条 middleware，建议共享这些核心模型：

- `AnchorRef`
  - `named`
  - `reserved(line/prev/next)`
  - 未来可扩展 paragraph / bounds anchor
- `LifecycleAnchor`
  - `paragraph_start`
  - `paragraph_end`
  - `line_break`
  - `token_start`
  - `token_end`
  - `group_end`
  - `segment_entry`
  - `segment_exit`
- `TargetRef`
  - `char`
  - `token`
  - `group`
  - `paragraph`
  - `container`
- `BlockingPolicy`
- `ConcurrencyPolicy`
- `TimingPolicy`
- `SourceOrigin`
- `StateRef`
- `ExprNode`
- `DiagnosticEvent`
- `AuditEvent`

## `ResolvedCue` 分类建议

建议未来统一为：

```ts
type ResolvedCue =
  | LayoutCue
  | PlaybackCue
  | EffectCue
  | StageCue
  | StateCue
  | LifecycleCue;
```

并建议先固定一个共享骨架：

```ts
interface BaseCue {
  id?: string;
  family: "layout" | "playback" | "effect" | "stage" | "state" | "lifecycle";
  kind: string;
  origin: "authored" | "lowered" | "generated";
  anchor: LifecycleAnchor | AnchorRef;
  target?: TargetRef;
  blocking?: BlockingPolicy;
  concurrency?: ConcurrencyPolicy;
  sourceOrigin?: SourceOrigin;
  payload?: Record<string, unknown>;
}
```

这里建议 `id` 在第一阶段保持可选：

- 先让 cue 分类、anchor、target、blocking 等骨架落地
- 等 Inspector v2 / plan-level tracing 真正需要稳定追踪时，再把 `id` 提升为强制字段

其中：

- `LayoutCue`
  - `mark`
  - `goto`
  - `flow`
  - `offset`
  - `push/pop display offset`
- `PlaybackCue`
  - `go`
  - `slow`
  - `fast`
  - `hold`
  - `pause`
  - future `ease` / `stagger`
- `EffectCue`
  - visual / filter / style / entrance / behavior
- `StageCue`
  - `cam.move`
  - `cam.zoom`
  - `cam.offset`
  - `scene.clear`
- `StateCue`
  - `set`
  - snapshot / restore
  - signal wait
- `LifecycleCue`
  - `token_end`
  - `group_end`
  - `line_break`
  - `paragraph_start`
  - `paragraph_end`

这套分类的意义不是“给所有东西起新名字”，而是让：

- authored cues
- lowering 产生的 cues
- runtime 过去偷偷生成的 cues

都进入同一套计划模型。

## cue / policy / host state 的区分

为了避免未来继续把语义塞进错误层次，还应明确区分：

- `Cue`
  - 可被规划、排序、绑定 anchor、参与 timeline/graph 的节点
- `Policy`
  - presentation / layout / overwrite / mode 规则
- `HostState`
  - `KineticChar.animOffset`
  - camera snapshot
  - active mutex sets
- `Audit`
  - diagnostics / trace / report

例如：

- `cam.move` 是 `StageCue`
- `stage/scroll mode` 是 `PresentationPolicy`
- `cameraOffset` 当前值是 `HostState`
- `camAuditLog` 应迁移为 `AuditEvent`

## plan 与显示对象的投影边界

当前很多 execution 数据仍然寄宿在 `KineticChar` 上，例如：

- visual effects
- timing sugars
- stage instructions
- base style snapshot

未来应明确区分：

- `PlanNode`
  - 语义/执行规划层节点
- `DisplayProjection`
  - 投影到 `KineticChar` / `TokenWrapper` / `KineticText` 的显示层结果

同时也应明确 dummy 的迁移方向：

- 零宽 layout 节点保留为 `LayoutItem`
- 零时长或零几何 cue 保留为 `CueNode`
- 不再默认将这些节点投影成 dummy `KineticChar`

## paragraph / char / stage host 的投影边界

除了 plan 与显示对象的区分，还需要明确 runtime host 的分层：

- `ParagraphInstance`
  - paragraph runtime instance
- `KineticText`
  - paragraph display host
- `CharInstance`
  - char/token/group/line/source identity
- `KineticChar`
  - char display host
- `StageRuntime`
  - camera/world/ui runtime host
- `ReaderHost`
  - app / renderer / viewport host

这几层如果不分开，未来 graph/state/plugin/interactive runtime 仍会继续把 execution 元数据写回显示对象或 singleton manager。

当前从 manager 层读出的一个重要判断是：

- `EffectManager` / `StyleManager` 适合作为 registry kernel 保留
- `LayoutManager` 适合作为 operator/expander kernel 保留，并补 metadata
- `StageManager` 适合作为 stage runtime kernel 保留，但必须从 reader/presentation/value-resolve/audit 里减负

## diagnostics / audit 作为跨层基础设施

未来的 IR / middleware / runtime 不应各自输出散乱日志，而应共享统一事件模型。

建议至少统一：

- `DiagnosticEvent`
  - `severity`
  - `subsystem`
  - `origin`
  - `message`
- `AuditEvent`
  - `phase`
  - `subsystem`
  - `origin`
  - `payload`

这样：

- parser warning
- layout preflight trace
- stage conflict diagnostics
- segment build trace
- seek replay trace

都能进入同一 Inspector / export / test harness。

## 面向插件化的 IR 约束

为了对齐 TODO v1.7，IR 设计必须考虑未来插件和 Hook 的稳定面：

- parser / normalizer 允许 sugar 与 grammar contribution
- middleware 的输入输出类型应保持稳定，便于 hook 注入
- cue / plan / source origin 需要足够可序列化，便于 LSP、Inspector、主题和插件工具链消费

推荐预留这些接口层：

- `afterParse(DocumentSemanticIR)`
- `beforeLayout(LayoutPlan)`
- `beforeTimeline(ParagraphExecutionPlan)`
- `onSegmentChange(SegmentExecutionPlan)`

## 当前与目标的差异

### 当前

- parser 输出过渡态 `ParagraphIR`
- layout builder 继续生成准执行结构
- `EffectProcessor` / `TextPlayer` / `ScriptPlayer` 现场补全执行语义
- 没有 document graph / state / plugin-aware IR 主层

### 目标

- parser 输出 document/paragraph semantic IR
- 三大中间件各自产出 layout/effect/stage plan
- control/state middleware 负责 graph 与状态层
- runtime 主要消费 plan，而不继续猜作者意图

## 第一刀的实际启动路径

虽然完整蓝图包含 document / graph / state / segment 这些层，但第一刀不建议一次引入全部层级。

建议先把真正落地的启动路径收敛为：

```text
ParagraphAst
  -> SemanticParagraphIR
  -> Middleware Plans
  -> ParagraphExecutionPlan
```

也就是：

- `DocumentAST`
- `DocumentSemanticIR`
- `ResolvedParagraphIR`
- `SegmentGraphPlan`

这些层先保留为正式目标与类型入口，不作为第一刀必须落地的实现层。

## 迁移顺序建议

1. 先定义 `DocumentSemanticIR`、`ResolvedParagraphIR` 与三大 middleware 的输入输出类型
2. 先接入 `LayoutMiddleware`，对齐现有 `layout-refactor-outline.md`
3. 再接入 `EffectMiddleware`，让 `TextPlayer` 改消费 `ChainExecutionPlan`
4. 再接入 `StageMiddleware`，让 `ScriptPlayer` 消费 `StagePlan`
5. 同时预留 `ControlFlowMiddleware` / `StateMiddleware` 的类型与入口
6. 最后再逐步移除 legacy `tokens/globalEffects` 依赖

## 非目标

- 立即重写具体 effect preset
- 立即重写 StageManager 的 tween 实现
- 立即把所有逻辑推到 parser 中

## 延后目标

以下内容本轮只先占位，不急于锁死：

- `DocumentSemanticIR` 的最终字段定型
  - 等 Phase B 的 control/state 语法真正进入主线后再最终冻结
- `ResolvedParagraphIR` 是否长期单独保留
  - 允许未来根据 middleware 输入稳定度再决定是否合并层级
- plugin hook 的精确注入时机
  - 这轮先保证类型入口与稳定边界，不抢先定义所有执行细节

## 与现有文档的关系

- parser 侧适配见：`parser-adaptation-outline.md`
- layout 执行链见：`layout-refactor-outline.md`
- execution 组织层见：`execution-refactor-outline.md`
