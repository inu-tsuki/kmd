# Refactor Overview

> 状态：Phase 1 与 Phase 2 已完成，当前进入下一阶段规划前的收口状态
> 目标：统一 parser / IR / layout / execution 四篇方案的入口、术语与优先级

## 管线总览

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

## 第一刀的实际启动路径

完整蓝图会保留，但第一刀不应一次把全部层级都落地。

建议先收敛到 4 层：

```text
ParagraphAst
  -> SemanticParagraphIR
  -> Middleware Plans
  -> ParagraphExecutionPlan
```

这样可以先把：

- parser compatibility 隔离
- layout preflight
- chain/stage/playback plan

这些最痛的执行链问题收掉，再逐步把 document graph / state / segment graph 接进来。

## 当前阶段

```text
Phase 1
  -> Shared types / parser boundary / layout preflight / execution seam
  -> DONE

Phase 2
  -> TextPlayer planner 深化 / SegmentBuilder 拆分 / PlaybackController 拆分
  -> DONE
```

## 文档导航

- [ir-refactor-outline.md](./ir-refactor-outline.md)
  - 顶层 IR 栈、`ResolvedCue` 分类、host/projection 边界
- [parser-adaptation-outline.md](./parser-adaptation-outline.md)
  - parser 适配、`ScopeRouter` / `SemanticLowerer` / `CompatProjector`
- [layout-refactor-outline.md](./layout-refactor-outline.md)
  - `LayoutStreamBuilder -> TextLayoutEngine -> TextBuilder` 的布局执行链
- [execution-refactor-outline.md](./execution-refactor-outline.md)
  - `EffectProcessor -> TextPlayer -> ScriptPlayer -> StageManager` 的执行链
- [phase-1-implementation-plan.md](./phase-1-implementation-plan.md)
  - 第一阶段实施范围、工作包、验收标准与风险控制
- [phase-2-implementation-plan.md](./phase-2-implementation-plan.md)
  - 第二阶段实施范围、TextPlayer planner 深化、SegmentBuilder / PlaybackController 拆分
- [refactor-review.md](./refactor-review.md)
  - 第一轮外部审查意见
- [refactor-review-v2.md](./refactor-review-v2.md)
  - 第二轮外部审查意见与落地建议
- [phase2-code-review.md](./phase2-code-review.md)
  - 第二阶段代码审查与收尾建议

## 术语约定

### `*Middleware`

表示架构边界层，负责把 semantic IR 降为 lane-specific plan。

- `LayoutMiddleware`
- `EffectMiddleware`
- `StageMiddleware`
- `ControlFlowMiddleware`
- `StateMiddleware`

### `*Planner` / `*Runner` / `*Assembler`

表示 middleware 内部或 runtime 邻接层的实现组件。

例如：

- `LayoutPlanner`
- `LayoutPassRunner`
- `DisplayAssembler`
- `ParagraphAssembler`

它们不是和 `*Middleware` 同级的全局架构层。

### `Cue / Policy / HostState / Audit`

- `Cue`
  - 可被规划、排序、绑定 anchor 的节点
- `Policy`
  - mode / viewport / overwrite / wrapping 等规则
- `HostState`
  - `cameraOffset`、`animOffset`、active mutex 等运行时状态
- `Audit`
  - diagnostics / trace / export / inspector 事件

## TextBuilder / Kinetic* 说明

本轮没有单列 `textbuilder-kineticchar-outline.md`，因为相关改造已经收纳进：

- [layout-refactor-outline.md](./layout-refactor-outline.md)
- [execution-refactor-outline.md](./execution-refactor-outline.md)
- [ir-refactor-outline.md](./ir-refactor-outline.md)

重点包括：

- `TextBuilder` 的桥接/胶水性质
- `KineticText` 作为 paragraph runtime host 的收缩方向
- `KineticChar` 从 runtime entity 回归 display host 的瘦身路径

## 当前优先级

1. Execution: `TextPlayer` planner 深化与 `ParagraphExecutionPlan` 补强
2. Script orchestration: `SegmentBuilder` / `PlaybackController` 拆分
3. Validation: lifecycle / chain mode / seek 回归护栏
4. Stage host split: `ReaderHost / PresentationManager / StageRuntime`
5. Phase B: graph / state / control-flow

## 延后目标

以下不是“永远不做”，而是明确延后到下一阶段：

- `DocumentSemanticIR` 的最终定型
  - 等 Phase B control-flow/state 语法进入主线后再锁死
- `StageTimelineCoordinator` 升级为有状态协调器
  - 等跨-segment continuity 成为刚需时再升级
- plugin hook 的执行期注入细节
  - 当前先保证类型入口和稳定面
- legacy `play()` 删除
  - 等 timeline 路径覆盖率和兼容条件满足后再退役
