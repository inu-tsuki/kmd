# Phase 2 Implementation Plan

> 状态：阶段性实施完成，代码审查建议已吸纳，验证完成
> 目标：在不提前进入 Phase B graph/state/control-flow 功能开发的前提下，继续收口 execution 主链路，把 `TextPlayer` 的现场编译职责和 `ScriptPlayer` 的大总管职责拆薄
> 对齐文档：`execution-refactor-outline.md`、`README.md`、`refactor-review-v2.md`、`phase1-code-review.md`

## 这一阶段为什么开始

Phase 1 已经完成了：

- 共享类型入口
- parser 边界抽离
- layout preflight 正式化
- execution adapter seam

现在的主要瓶颈已经非常集中：

- `TextPlayer` 仍在运行时现场推断 chain mode、lifecycle、stage anchor
- `ScriptPlayer` 仍同时承担 segment build、playback control、seek/replay、paragraph placement
- `ParagraphExecutionPlan` 仍是 adapter seam，还不是执行层真正稳定的 plan

这一阶段不是继续大范围扩展，而是把 execution 主走廊理顺，为下一步的：

- `StageManager` 分层
- `DocumentSemanticIR` / `ControlFlowMiddleware` / `StateMiddleware`
- Phase B graph/state 语法

准备更稳的接入点。

## 第二阶段的实际目标

这里的 `RuntimeParagraphExecutionPlan` 指当前代码层面正在使用的 paragraph execution contract。
它是总蓝图中 `ParagraphExecutionPlan` 的现阶段实现形态，而不是一套与 README / IR 文档并列的新层级名词。

这一阶段只收敛到下面这条执行链：

```text
RuntimeParagraphExecutionPlan
  -> Chain / Lifecycle planning
  -> TextPlayer timeline assembly
  -> SegmentBuilder
  -> PlaybackController
```

也就是说，第二阶段不要求：

- 完整 rollout `DocumentSemanticIR`
- 引入 `SegmentGraphPlan`
- 立刻拆分 `StageManager -> ReaderHost / PresentationManager / StageRuntime`
- 彻底瘦身 `KineticText / KineticChar`
- 推出 state / control-flow / plugin runtime

## 范围

### In Scope

1. `TextPlayer` planner 深化
2. `ParagraphExecutionPlan` 语义增强
3. `ScriptPlayer.buildSegment()` 的 `SegmentBuilder` 抽离
4. seek / replay 相关控制逻辑的 `PlaybackController` 抽离
5. 执行层回归验证与最小 diagnostics 补强

### Out of Scope

1. `StageManager` 的正式分层
2. `GraphRuntimeCoordinator`
3. `ControlFlowMiddleware` / `StateMiddleware` 的真实实现
4. `KineticText` / `KineticChar` 的结构性瘦身
5. legacy `play()` 的删除

## 工作包

### WP1. TextPlayer Planner Deepening

目标：把 `TextPlayer` 里最重的 runtime 现场推断，前移到 plan 阶段或内部 planner helper。

优先处理的语义：

- `ChainExecutionMode` 的正式消费
- `hold:char` / `char_stagger` 的 plan 化
- token-end / newline / paragraph-start 等 lifecycle cue 的显式命名
- stage cue 的 anchor 语义从热路径中抽离
- review 指出的 `char_stagger` 边界条件补 assert 或 fallback audit

建议触达文件：

- `src/core/render/text/TextPlayer.ts`
- `src/core/execution/paragraphExecutionPlan.ts`
- 必要时新增：
  - `src/core/execution/chainPlanning.ts`
  - 或 `src/core/render/text/internal/*`

本阶段约束：

- 不要求完全消灭 `TextPlayer` 内所有条件分支
- 不要求一次引入完整的 `ResolvedCue` runtime 消费器
- 优先将“高频、稳定、已识别”的语义前移

验收标准：

- `TextPlayer.buildTimeline()` 不再依赖 `hold:char` 这类命令名特判作为唯一模式入口
- `char_stagger` 缺 plan 时有显式 fallback diagnostics，不允许静默退化
- `buildTimeline()` 的主循环中，至少一类 lifecycle / chain mode 判断被 plan 替代

### WP2. ParagraphExecutionPlan Enrichment

目标：让当前 adapter seam 变成真正可继续扩展的 paragraph execution contract。

本阶段至少补强：

- `ChainExecutionPlan` 的消费字段对齐
- lifecycle cue 命名空间
- text item 与 cue item 的区分
- token-level stage / playback / effect 绑定的稳定读取方式

建议触达文件：

- `src/core/types/execution.ts`
- `src/core/execution/paragraphExecutionPlan.ts`
- 必要时调整：
  - `src/core/types/cue.ts`
  - `src/core/types/layout.ts`

本阶段约束：

- `BaseCue.id` 继续保持 optional
- 不把 paragraph plan 一次扩张成完整 document plan
- 不引入新的大层级名词，优先在现有 contract 上长字段

验收标准：

- `TextPlayer` 读取 plan 时，不再需要回退到大量 `KineticChar` 私有字段猜语义
- `ParagraphExecutionPlan` 可以清楚区分 authored cue、lowered cue、generated lifecycle cue

### WP3. SegmentBuilder Extraction

目标：把 `ScriptPlayer.buildSegment()` 从“脚本级大总管”收缩成明确的 orchestration shell。

第一刀只抽：

- paragraph instantiation/build
- paragraph timeline attach
- stage/global effect build-time application
- checkpoint / marker 收集

保留在内部、不提前独立的职责：

- `private placeParagraph()`

这条遵循 `refactor-review-v2.md` 的建议：paragraph placement 目前还太薄，不值得独立 coordinator。

建议触达文件：

- `src/core/player/ScriptPlayer.ts`
- 新增：
  - `src/core/player/SegmentBuilder.ts`

验收标准：

- `ScriptPlayer` 不再直接持有大段 `buildSegment()` 过程式装配逻辑
- `SegmentBuilder` 可以在不触碰 play/pause/seek API 的情况下独立测试
- paragraph placement 逻辑已被局部收口，但仍内聚在 `SegmentBuilder` 内部

### WP4. PlaybackController Extraction

目标：把 `ScriptPlayer` 中与运行控制有关但与 segment build 无直接关系的职责抽离。

优先抽出的能力：

- `seekToTime()`
- behavior re-register
- style replay/reset
- play / pause / skip 的 façade 级协调

建议触达文件：

- `src/core/player/ScriptPlayer.ts`
- 新增：
  - `src/core/player/PlaybackController.ts`

本阶段约束：

- 不要求同时处理 graph-aware runtime
- 不要求引入新的外部 API 层
- `Segment` 结构保持兼容

验收标准：

- `ScriptPlayer` 的职责清晰分成：
  - load / orchestration
  - build（委托 `SegmentBuilder`）
  - playback control（委托 `PlaybackController`）

### WP5. Validation and Guard Rails

目标：把第二阶段最容易出现的 silent regression 提前变成显式信号。

最少补这些：

- `TextPlayer` 的 `char_stagger` fallback diagnostics
- 关键样例脚本的 timeline / seek 回归检查
- `SegmentBuilder` 抽离后的段落数量、marker、checkpoint 数量一致性检查

验收标准：

- `pnpm build`
- `pnpm test:parser`
- 关键样例脚本回归检查（parser/layout/timeline/seek）

## 推荐顺序

1. `WP1 TextPlayer Planner Deepening`
2. `WP2 ParagraphExecutionPlan Enrichment`
3. `WP3 SegmentBuilder Extraction`
4. `WP4 PlaybackController Extraction`
5. `WP5 Validation and Guard Rails`

这样排序的原因：

- `TextPlayer` 仍是 execution 语义最密集的热区，先收它，后面 `ScriptPlayer` 的拆分才不会只是机械搬家
- `ParagraphExecutionPlan` 必须先足够稳定，`SegmentBuilder` 才有清晰输入
- `PlaybackController` 依赖 `SegmentBuilder` 的结果边界清楚之后再抽更稳

## 风险与控制

### 风险 1：planner 前移后，真实 char 序列与 plan 脱节

控制方式：

- 第二阶段只把已稳定识别的 chain/lifecycle 语义前移
- 保留 runtime fallback，但要发 diagnostics，不允许静默吞掉 plan 缺口

### 风险 2：`ScriptPlayer` 拆分时意外改变 stage continuity

控制方式：

- 第一刀只抽 `SegmentBuilder`
- `trimActiveStageTween()` 仍保持现状，不在本阶段重写冲突策略

### 风险 3：把 paragraph placement 过早抽成独立 coordinator

控制方式：

- 明确保持 `placeParagraph()` 为 `SegmentBuilder` 内部方法
- 等 scroll/page/interactive 三模式真正膨胀后再独立

## 阶段完成定义

第二阶段完成后，应至少满足：

1. `TextPlayer` 的核心 chain mode / lifecycle 规划不再主要依赖热路径命令名特判
2. `ParagraphExecutionPlan` 成为 execution 主链的稳定契约，而不只是薄适配器
3. `ScriptPlayer.buildSegment()` 已提取为 `SegmentBuilder`
4. seek / replay 主控制逻辑已提取到 `PlaybackController`
5. 第二阶段新增的 fallback / diagnostics 已接入现有验证流程

## 第二阶段之后再做什么

第二阶段完成后，更适合进入：

- `StageManager` 分层
- `ReaderHost / PresentationManager / StageRuntime` 拆分
- `DocumentSemanticIR` / `ControlFlowMiddleware` / `StateMiddleware`
- `SegmentGraphPlan`
- Phase B 的 graph / state / control-flow 功能开发

## 当前落地状态

- `WP1 TextPlayer Planner Deepening`：已完成
- `WP2 ParagraphExecutionPlan Enrichment`：已完成
- `WP3 SegmentBuilder Extraction`：已完成
- `WP4 PlaybackController Extraction`：已完成
- `phase2-code-review.md` 收尾吸纳：
  - `SegmentBuildContext.metadata` 已收紧为 `KMDMetadata`
  - `SegmentBuilder` / `PlaybackController` 已去除对 `useEditorStore()` 的直接依赖，改由 runtime state 回调承接
  - `chainPlanning.ts` 中的恒等 `toCueAnchor()` 已移除
- 验证进度：
  - `pnpm exec vue-tsc -p tsconfig.app.json --noEmit`：已通过
  - `pnpm build`：已通过
  - `pnpm test:parser`：已通过（用户手动确认）
  - 关键样例脚本回归检查：已通过（用户手动确认）
