# Execution Refactor Outline

> 状态：升级版初步方案
> 范围：`EffectProcessor -> TextPlayer -> ScriptPlayer -> StageManager` 这一段的执行链
> 目标：既收束 Phase A 遗留的 runtime 现场编译问题，也为 Phase B/C 的 Segment Graph、State、交互式 runtime 做铺垫
> 配套文档：`layout-refactor-outline.md`、`ir-refactor-outline.md`、`parser-adaptation-outline.md`

## 背景

parser 已经完成第一轮 `AST -> IR -> legacy projection` 重构，但 execution 层仍在多个 runtime 模块里现场补全语义：

```text
ParagraphData / ParagraphIR
  -> TextBuilder
  -> LayoutStreamBuilder
  -> TextLayoutEngine
  -> KineticText / chars / tokens
  -> TextPlayer.buildTimeline()
  -> ScriptPlayer.buildSegment()
  -> Segment timeline + checkpoints + seek
```

这套链路已经能工作，也支撑了当前的 Phase A 能力，但对 TODO 中未来的这些目标准备不足：

- Segment Graph / 条件分支 / 循环 / jump / wait
- StateStore / 表达式 / state replay
- 插件化 Hook 与语法糖注册
- 非纯确定性 timeline 的交互式 runtime

## 当前职责分布

### `EffectProcessor`

- layout / visual / stage 分流
- track 分类
- timing sugar 解释
- char / group apply 策略
- 初始 style 应用

### `TextPlayer`

- 段落级 timeline 构建
- token/group/char 链条展开
- 行内 reveal 节奏、换行呼吸、advance 语义
- behavior/style record 收集

### `ScriptPlayer`

- 脚本加载
- paragraph 实例化
- segment timeline 总装配
- stage tween 冲突处理
- checkpoint / seek / replay
- paragraph placement 与 timeline marker 导出

## 已确认的问题

### 1. 执行规划权散落在多个 runtime 模块

当前这些判断没有统一收口：

- cue 的真实作用域
- cue 的触发时机
- chain 的执行模式
- stage 指令的 anchor
- blocking / advance / fork 语义

结果是：

- `EffectProcessor` 解释一部分
- `TextPlayer` 再解释一部分
- `ScriptPlayer` 在 paragraph / segment 层再解释一部分

### 2. `TextPlayer` 已经像“现场编译器”

`TextPlayer` 现在不仅组装 timeline，还在临时决定：

- `hold:char` 是否转为 char chain
- `targetType="both"` 默认走 char 还是 container
- stage 指令是立即触发还是 token-end 触发
- `>>` / `>>>` 如何 fork 到下一行或下一段

这些逻辑更接近 planner，而不是纯 assembler。

### 3. `ScriptPlayer` 职责过载

当前它同时承担：

- `ScriptLoader`
- `SegmentBuilder`
- `StageConflictProcessor`
- `PlaybackController`
- 段落 placement 分支逻辑

这是 execution 层尚未拆分的直接表现。

### 4. 舞台冲突处理以 runtime 修补为主

`trimActiveStageTween()` 解决了实际问题，但它目前更像主要机制，而不是兜底机制。

长期更健康的方向应当是：

- planner / validator 先预警
- runtime trim 保留为回滚与容错

### 5. 缺少 state / control flow 执行层

TODO 的未来路线要求：

- `@ if / @ loop / @ while / @ jump / @ wait`
- `StateStore`
- `Checkpoint.state`
- 非线性 Segment Graph seek

但当前 execution 方案几乎全部围绕线性 timeline 设计，对 graph / state 只有局部准备，没有正式结构。

### 6. 只有确定性 timeline backend，没有 execution backend 分叉

当前设计默认：

- 预烘焙 GSAP timeline
- seek/replay
- behavior re-register

但 TODO Phase C 已经明确提出：

- `SignalRegistry`
- 游戏化 Segment
- 非预烘焙 / 非完全确定性的交互式 runtime

这意味着未来 execution 不会只有一种 backend。

### 7. `TextBuilder` 仍是隐藏的 execution 桥接层

当前主链路里，`TextBuilder` 实际承担了：

- parser paragraph data 接入
- base style / host options 组装
- layout bridge 调用
- `KineticChar` / `TokenWrapper` 物化
- legacy pending effects 回写

这说明 execution 目前不仅在 `TextPlayer` / `ScriptPlayer` 中散落，也在 paragraph build 入口就开始混合。

长期更健康的做法应当是：

- `ParagraphBuildContext`
- `LayoutBridge`
- `DisplayAssembler`
- `CompatBinder`

分别承担这些角色，而不是继续依赖一个静态 glue builder。

### 8. `KineticText` 仍是 paragraph runtime host 的聚合点

当前 `KineticText` 同时承担：

- paragraph display container
- build / rebuild 入口
- paragraph-global effect target
- playback facade
- layout metric 查询宿主

这对原型期很高效，但对未来的 execution / graph / state 架构意味着：

- paragraph runtime state 继续直接寄宿在显示对象上
- build / play / placement / effect host 边界难以收束

更健康的方向应当是：

- `KineticText` 收缩为 paragraph display host
- `ParagraphInstance` / `ParagraphAssembler` 承担 runtime instance 与 build 结果
- `ParagraphController` 负责 play / skip / rebuild 生命周期

### 9. `KineticChar` 已经是 runtime entity，而不只是显示对象

当前 `KineticChar` 同时承载：

- layout position / display offset
- animation / behavior state
- visual effects / timing sugars / stage instructions
- style snapshot / seek reset 支撑

这说明 execution 计划仍然直接写在显示对象上。

未来应逐步区分：

- `KineticChar`
  - 只保留显示与局部变换宿主职责
- `CharInstance`
  - 保存 token/group/line/source identity
- `CueBinding`
  - 保存 entrance / stage / playback / chain execution 绑定

### 10. `StageManager` 已跨越“舞台演出”边界

当前 `StageManager` 不仅负责：

- camera/world/ui layers
- stage registry
- stage state snapshot

还直接负责：

- `readerApp` host 挂载
- renderer resize 监听
- stage/scroll mode 切换
- viewport / letterbox policy
- marker / `var.*` 参数解析
- audit 导出

这说明它已经同时承担：

- `StageRuntime`
- `ReaderHost`
- `PresentationManager`
- 部分 `RuntimeValueResolver`

而这些角色长期不应继续揉在一个 singleton 里。

### 11. 调试与审计体系仍散落

当前审计信息分散在：

- layout 构建/执行日志
- `StageManager.camAuditLog`
- `ScriptPlayer` build 期输出

这意味着系统尚未建立统一的：

- diagnostics
- audit trace
- Inspector / export integration

下一轮 execution 设计需要把它们收束到共享事件模型中。

### 12. 四大 manager 的健康度并不一致

这一轮代码回顾已经可以比较明确地给出判断：

- `EffectManager`
  - registry kernel 基本健康
- `StyleManager`
  - registry kernel 基本健康，但 override policy 仍有少量硬编码
- `LayoutManager`
  - operator / expander registry 基本健康，但缺 metadata 层
- `StageManager`
  - 既有 registry kernel，也已经越界进 reader/presentation/runtime host

这意味着下一轮 execution 重构不应优先推倒 manager 本体，而应优先处理：

- metadata 不足
- planner / middleware 缺位
- bridge / host 分层混乱
- diagnostics / audit 散落

### 13. 当前系统里仍有大量“未命名 cue”

除了作者明确写下的命令，系统里还有很多在 runtime 中临时生成或隐式判定的 cue：

- lifecycle cue
  - `token_end`
  - `group_end`
  - `line_break`
  - `paragraph_start`
  - `paragraph_end`
- playback cue
  - punctuation pause
  - newline breathing gap
  - default enter stagger
  - `pause:char` override
- stage cue
  - token-end deferred stage apply
  - in-flight continuation
  - trim fallback
- paragraph cue
  - auto placement / stacking / mode-specific placement

这些语义当前分散在 `TextPlayer`、`ScriptPlayer`、`StageManager`、`TextBuilder` 中，是 execution if/else 膨胀的重要原因。

## 重构目标

1. 将 execution 解释权从 runtime helper 中收束到正式 planning 层
2. 保留现有 seek / replay / checkpoint 能力
3. 将 stage 冲突从“自动修补为主”改为“预警优先，修补兜底”
4. 将 `ScriptPlayer` 拆分为更明确的装配与控制角色
5. 为 Segment Graph / State / Interactive Runtime 提前预留 execution 入口
6. 将 paragraph host、char host、stage host 与 reader host 分层
7. 建立统一 diagnostics / audit trace 基础设施

## 目标结构

### 1. 引入显式 Execution Plan

目标不是让 runtime 直接吃 parser 的过渡态 `ParagraphIR`，而是增加一层：

- `ResolvedParagraphExecution`
- `ResolvedCue`
- `ChainExecutionPlan`
- `SegmentExecutionPlan`

这层应明确表达：

- cue scope
- anchor
- blocking policy
- timing policy
- target granularity
- dispatch lane
- source origin

建议进一步明确 `ResolvedCue` 本体，至少区分：

- `kind`
- `family`
- `origin`
  - `authored`
  - `lowered`
  - `generated`
- `anchor`
- `target`
- `blocking`
- `concurrency`
- `payload`

并建议先固定 `ChainExecutionPlan` 的最小接口骨架：

```ts
interface ChainExecutionPlan {
  id: string;
  mode: "group_sync" | "char_stagger" | "char_tween" | "container_only" | "graph_gate";
  anchor: LifecycleAnchor | AnchorRef;
  target: TargetRef;
  blocking?: BlockingPolicy;
  steps: ResolvedCue[];
  sourceOrigin?: SourceOrigin;
}
```

### 2. 明确四类 execution cue

建议至少区分：

- `PlaybackCue`
  - reveal / delay / advance / hold / ease / stagger
- `EffectCue`
  - entrance / behavior / instant style / filter / modifier
- `StageCue`
  - camera / scene / paragraph-global stage action
- `StateCue`
  - set / snapshot / restore / signal wait / branch condition probe

这样 execution 层就不会把未来的 control/state 语义继续硬塞进 stage 或 helper。

同时建议补充：

- `LifecycleCue`
  - `token_end`
  - `group_end`
  - `line_break`
  - `paragraph_start`
  - `paragraph_end`

它们虽然很多并非作者直接书写，但应作为正式 cue 存在，而不是继续藏在 runtime 条件分支里。

还需要明确哪些东西 **不是 cue**：

- `PresentationPolicy`
  - stage/scroll mode
  - viewport
  - letterbox
- `LayoutPolicy`
  - design origin
  - alignment defaults
  - wrapping heuristics
- `HostState`
  - camera snapshot
  - char animOffset
  - active mutex sets

### 3. 正式化链执行模式

不要继续让 `TextPlayer` 通过 `hold:char` 这类特例反推模式。

建议引入：

- `group_sync`
- `char_stagger`
- `char_tween`
- `container_only`
- `graph_gate`

其中：

- 前四种描述当前特效链和段落 timeline 的常见模式
- `graph_gate` 用于未来的 `wait` / branch / signal 切分点

### 4. 明确 execution backend 分叉

建议未来分成两类 backend：

- `DeterministicTimelinePlan`
  - 当前 Phase A/Phase B 主要路径
  - 适合 seek、checkpoint、timeline replay
- `InteractiveRuntimePlan`
  - Phase C 游戏化或 signal-heavy segment
  - 不要求所有状态都能预烘焙成 GSAP timeline

这样未来不会把所有交互运行时能力硬塞进 timeline builder。

## 建议模块边界

### `EffectProcessor`

保留：

- track 分类
- runtime apply
- style recursive apply
- effect result 汇总

前移出去：

- chain 默认执行模式推断
- paragraph/global vs broadcast 语义推断
- “初始样式 vs 播放样式”的隐式协议判定

`EffectManager` / `StyleManager` 本体应尽量保留为 registry kernel，不作为下一轮主战场。

### `TextPlayer`

保留：

- GSAP timeline 装配
- behavior / style record 输出
- char/wrapper 级动画挂接

前移出去：

- chain mode 决策
- hold / ease / stagger 语义判定
- token-end / group-end / paragraph-start 等 lifecycle 选择

### `ScriptPlayer`

保留：

- segment orchestration
- seek/replay coordination
- checkpoint 生命周期

前移或拆分出去：

- paragraph instantiation
- paragraph placement
- stage conflict resolution
- paragraph/global cue 解释
- graph traversal policy

### `TextBuilder` / `ParagraphAssembler`

保留：

- paragraph build orchestration
- host/display object 的最终装配入口

拆分出去：

- store / theme / host config 获取
- layout bridge
- cue 到显示对象的绑定
- legacy pending effect 回写

### `KineticText` / `ParagraphInstanceHost`

保留：

- paragraph container
- paragraph-level display bounds 与 children 持有
- paragraph/global display target

前移出去：

- build / rebuild orchestration
- playback facade
- pending cue/runtime cache 宿主
- paragraph placement 协作状态

### `KineticChar` / `CharDisplayHost`

保留：

- layout coordinates
- display offset
- anim layer
- behavior host
- style snapshot / reset

前移出去：

- stage instruction 缓存
- timing sugar 缓存
- chain / cue execution metadata
- token/line/group identity 绑定

### `ReaderHost` / `PresentationManager`

新增边界，负责：

- app/pixi host 挂载
- resize 订阅
- `stage` / `scroll` / future interactive mode policy
- viewport / letterbox / baseScale

这层不应直接理解 `cam.move` 等 stage cue。

### `StageRuntime`

负责：

- camera / cameraOffset / modifiers
- stage registry apply
- state snapshot / restore

前移出去：

- `readerApp` 依赖
- mode / resize policy
- marker / `var.*` 参数解析
- audit export

`sceneClear` 未来应优先以注册式 stage cue 的形式进入这里，而不是继续作为全链路 special case。

`StageManager` 本体可继续保留 registry + runtime apply kernel，但需要从中抽走：

- reader/presentation policy
- value resolving
- diagnostics / audit export

### `DiagnosticsCollector` / `AuditBus`

新增共享设施，负责收集：

- parser/layout/effect/stage/script diagnostics
- build-time audit trace
- runtime trace
- seek / checkpoint replay records

## 建议拆分角色

### `SegmentBuilder`

- 组装 paragraph execution units
- 输出 `SegmentExecutionPlan`
- 汇总 child timelines、behavior/style records、marker origins

### `StageTimelineCoordinator`

- 管理 stage tween continuity
- 生成 conflict diagnostics
- 保留 trim 作为 fallback
- 维护 `InFlightAnimation`

### `RuntimeValueResolver`

新增共享服务，负责：

- marker / anchor / `var.*` / future `state.*` 求值

它不应长期继续分散在 `EffectProcessor`、`StageManager`、layout helper 中。

这层也会成为 parser/LSP 与 runtime 之间的重要注入点，避免 parser 直接依赖具体 manager singleton。

### `PlaybackController`

- play / pause / seek / replay
- behavior re-register
- style replay
- runtime timeScale / auto-play 管理

### `SegmentBuilder` 内部的 paragraph placement

第一刀不建议把 paragraph placement 立即抽成独立 coordinator。

更稳的做法是先让它留在 `SegmentBuilder` 内部，例如：

- `private placeParagraph()`

负责：

- paragraph placement / stacking
- page / scroll / stage 模式差异
- 与 layout state 的桥接

等这块逻辑真正增长到值得独立时，再正式升格为单独模块。

### `GraphRuntimeCoordinator`

- future: SegmentGraph traversal
- branch evaluation
- jump / loop / wait handling
- default path 与 non-default path seek policy

## Diagnostics-first 策略

对 TODO 的未来拓展来说，execution 层不应只在 runtime 修补。

建议将以下内容前置为 diagnostics：

- stage tween property conflicts
- effect mutex / concurrent modifier conflicts
- impossible branch target / missing tag
- state mutation cycles 或 wait deadlock 风险

runtime trim / fallback 保留，但不再作为主要机制。

同时应统一收束：

- `console.log`
- `camAuditLog`
- ad hoc report/export

将它们迁移到共享的 diagnostics / audit 事件模型。

## Source Map / IDE 需求

未来 execution plan 应显式保留：

- cue source range
- chain source range
- paragraph origin
- segment origin
- edge origin

这是 TODO 中 Hot Replay、Segment 边界标记、Inspector v2、LSP 扩展的必要基础。

## 迁移顺序建议

1. 定义 `StageCue`、`PlaybackCue`、`StateCue`、`ChainExecutionPlan` 等类型
2. 在不改 runtime 行为的前提下，引入 execution-plan adapter
3. 让 `TextPlayer` 先消费 `ChainExecutionPlan`
4. 让 `ScriptPlayer` 改消费 `StageCue` / paragraph execution plan
5. 为 Phase B 增加 `GraphRuntimeCoordinator` 与 `StateCheckpoint` 支持
6. 收缩 `EffectProcessor` 中的语义判定
7. 最后将 runtime trim 降级为 fallback，并增加 build-time diagnostics

## Legacy `play()` 退役 gate

旧 `play()` 路径不应无限期共存，但也不应在缺少约束时提前删除。

建议至少满足以下条件后再退役：

1. `buildTimeline()` 路径覆盖当前主要展示模式
2. seek / replay / checkpoint 已有稳定回归验证
3. 不再存在依赖 legacy `Promise` 语义的调用方
4. `skipToEnd()` / `bakeTimeline()` 与 timeline 路径的行为已对齐

在此之前，legacy `play()` 应被视为受控兼容层，而不是继续演进的新主路径。

## 非目标

- 立即重写 GSAP seek 模型
- 立即移除所有 legacy `tokens/globalEffects`
- 立即统一所有 runtime 状态宿主

## 延后目标

以下内容本轮先定边界，不急于一次落地：

- `GraphRuntimeCoordinator` 的完整实现
  - 当前先保证 `graph_gate` 与 document-level control/state 有计划入口
- `InteractiveRuntimePlan` 的完整 backend
  - 先在 execution 设计中留出 backend 分叉，不立刻重写成游戏 runtime
- `StageTimelineCoordinator` 的 richer stateful 版本
  - 先把 stage conflict diagnostics 和 plan 分层做清楚，再升级协调器

## 相关观察

- stage cue 目前没有独立 planner，这是 execution 层最大的结构缺口之一
- `sceneClear` 最终应从特殊语法残留降为注册式 stage cue
- `cam.offset` 已经说明系统需要 additive stage lane，不能长期依赖同属性覆盖
- Phase B/C 要求 execution 层不再只是“线性 timeline 组装器”，而要成为 graph-aware runtime
