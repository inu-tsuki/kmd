# Phase 1 Implementation Plan

> 状态：已完成，进入 Phase 2 准备阶段
> 目标：把当前重构方案压成第一批可落地的代码改动，并为 Phase B/C 的 graph/state/plugin 演进建立稳定契约
> 对齐文档：`README.md`、`ir-refactor-outline.md`、`layout-refactor-outline.md`、`execution-refactor-outline.md`、`parser-adaptation-outline.md`

## 这一阶段为什么先做

当前系统最大的风险不是“没有方向”，而是：

- parser、layout、execution 都已经有重构方向
- 但这些方向还没有通过共享契约和清晰边界真正接到代码里
- 如果直接跳进 `TextPlayer` / `ScriptPlayer` / `StageManager` 的深层拆分，很容易一边改行为一边改架构，风险会叠加

所以第一阶段的目标很克制：

- 先把 **共享类型**
- **parser 边界**
- **layout preflight**
- **execution adapter seam**

这几根骨头立起来。

## 第一阶段的实际启动路径

完整蓝图仍然保留，但第一阶段只以这条 4 层路径为真实落地目标：

```text
ParagraphAst
  -> SemanticParagraphIR
  -> Middleware Plans
  -> ParagraphExecutionPlan
```

也就是说，这一阶段暂时不要求：

- `DocumentSemanticIR` 全量投入使用
- `SegmentGraphPlan` 正式落地
- `StageManager` 完整拆分
- `LayoutStreamBuilder` 三角拆分完成

## 范围

### In Scope

1. 共享类型与契约入口
2. parser 侧的边界抽离与 legacy 隔离
3. layout 双 pass 的正式化与 `LayoutPreflightResult`
4. execution 的最小 adapter seam

### Out of Scope

1. `DocumentSemanticIR` 的完整 rollout
2. `ControlFlowMiddleware` / `StateMiddleware` 的真实实现
3. `StageManager -> ReaderHost / PresentationManager / StageRuntime` 的完整拆分
4. `KineticText` / `KineticChar` 的彻底瘦身
5. `LayoutStreamBuilder` 的完整三角拆分

## 工作包

### WP1. Shared Types Foundation

先建立统一契约面，避免后续每个模块各自再定义一套近似类型。

建议文件目标：

- `src/core/types/cue.ts`
- `src/core/types/anchor.ts`
- `src/core/types/layout.ts`
- `src/core/types/execution.ts`
- `src/core/types/diagnostics.ts`
- `src/core/types/index.ts`

本阶段至少落这些骨架：

- `BaseCue`
- `AnchorRef`
- `ChainExecutionPlan`
- `LayoutPreflightResult`
- `DiagnosticEvent`
- `AuditEvent`

验收标准：

- 类型定义能被 parser / layout / execution 三侧共同 import
- `BaseCue.id` 在这一阶段保持可选
- 不要求一次定义完所有 future fields，但命名空间要稳定

### WP2. Parser Boundary Extraction

目标不是重写 parser，而是把过渡期职责切开。

建议文件目标：

- `src/core/parser/Parser.ts`
- `src/core/parser/lowering.ts`
- `src/core/parser/commandCatalog.ts`
- `src/core/parser/ScopeRouter.ts`
- `src/core/parser/CompatProjector.ts`

本阶段至少完成：

- 从 `lowering.ts` 中抽出 `ScopeRouter`
- 把 legacy `tokens/globalEffects` 投影隔离到 `CompatProjector`
- 让 parser 面向 `CommandRegistryView`，不继续直接绑定 manager singleton

验收标准：

- `pnpm test:parser` 通过
- 当前 parser 行为与 compatibility projection 不出现已知回归
- `lowering.ts` 不再继续承担 compatibility 主逻辑

### WP3. Layout Preflight Formalization

目标是把当前 phantom pass 升级为正式的 preflight 结果，而不是立刻重写整条 layout 链。

建议文件目标：

- `src/core/layout/TextLayoutEngine.ts`
- `src/core/layout/types.ts`
- 必要时新增内部 helper（例如 `AnchorCoordinator` 或 pass runner 辅助模块）

本阶段至少完成：

- 让 preflight 明确产出 `LayoutPreflightResult`
- 把 anchor state / line plan / estimated bounds 变成显式结果
- 清理最危险的双 pass 重复逻辑

本阶段明确不要求：

- 立刻把 `LayoutStreamBuilder.build()` 拆成 `LayoutPlanner / DisplayAssembler / CompatBinder`

验收标准：

- 现有 marker / forward-reference 行为保持稳定
- 双 pass 的共享状态不再完全靠复制逻辑维持
- layout 输出能为后续 IDE / Inspector / stage anchor 提供正式 preflight 入口

### WP4. Execution Adapter Seed

这一阶段先建立 seam，不追求一次把 `TextPlayer` 改造成完整 planner consumer。

建议文件目标：

- `src/core/render/text/TextPlayer.ts`
- `src/core/render/text/TextBuilder.ts`
- `src/core/player/ScriptPlayer.ts`
- 必要时新增 `src/core/execution/` 下的 adapter 或 types 模块

本阶段至少完成：

- 引入 `ParagraphExecutionPlan` / `ChainExecutionPlan` 的最小适配层
- 明确 lifecycle cue 和 chain mode 的命名空间
- 让 `TextPlayer` 开始消费“plan-like input”，而不是继续完全现场推断

本阶段明确约束：

- paragraph placement 先保留在 `SegmentBuilder` 内部
- 以 `private placeParagraph()` 之类的内部方法形式收口
- 不提前拆独立 `ParagraphPlacementCoordinator`

验收标准：

- `TextPlayer` 语义不发生预期外变化
- `ScriptPlayer` 不需要同时承担新的大规模 host 拆分
- 后续第二阶段可以自然承接 `SegmentBuilder / PlaybackController` 的进一步拆分

## 推荐顺序

1. `WP1 Shared Types Foundation`
2. `WP2 Parser Boundary Extraction`
3. `WP3 Layout Preflight Formalization`
4. `WP4 Execution Adapter Seed`

这样做的原因是：

- parser 和 execution 都需要先共享同一套类型
- layout preflight 是后续 stage/effect planning 的几何基础
- execution adapter 的收益最大，但它不应该先于契约和 preflight 单独开工

## 风险与控制

### 风险 1：类型先行导致抽象过度

控制方式：

- 第一阶段的类型只定义“当前真的要接线”的骨架
- future fields 先用可选字段或留白注释，不在此时把所有 Phase B/C 细节一次塞满

### 风险 2：layout 双 pass 重构带来微妙回归

控制方式：

- 优先提炼 shared result，不追求一次重写全部结构
- 保留当前视觉行为为第一优先级

### 风险 3：execution seam 改造过早波及 host 层

控制方式：

- 第一阶段只引入 adapter，不强推 `KineticText` / `KineticChar` / `StageManager` 的完整拆分

## 阶段完成定义

第一阶段完成后，应至少满足：

1. `src/core/types/` 成为 parser / layout / execution 的共享契约入口
2. parser 的 `ScopeRouter` 与 `CompatProjector` 已分离
3. `TextLayoutEngine` 能正式产出 `LayoutPreflightResult`
4. `TextPlayer` 已开始消费 `ChainExecutionPlan` 或等价 adapter 输入
5. `pnpm test:parser` 和 `pnpm build` 通过

## 当前落地状态

- `WP1 Shared Types Foundation`：已完成
- `WP2 Parser Boundary Extraction`：已完成
- `WP3 Layout Preflight Formalization`：已完成
- `WP4 Execution Adapter Seed`：已完成
- 验证进度：
  - `pnpm build`：已通过
  - `pnpm test:parser`：已通过
  - 关键样例脚本回归检查：已通过

## 第一阶段之后再做什么

第一阶段完成后，下一批更适合进入：

- `TextPlayer` planner 深化
- `SegmentBuilder` / `PlaybackController` 拆分
- `StageManager` 的 `ReaderHost / PresentationManager / StageRuntime` 分层
- `DocumentSemanticIR`、`ControlFlowMiddleware`、`StateMiddleware` 的真正落地
