# Phase 3 Implementation Plan

> 状态：DONE（含审查后收尾注记）
> 目标：围绕 `StageManager` 做分层准备，把 stage runtime、reader host、presentation policy、value resolve、diagnostics 这些边界先切出稳定接缝，再决定哪一层先真正落代码
> 对齐文档：`execution-refactor-outline.md`、`ir-refactor-outline.md`、`refactor-review-v2.md`、`phase2-code-review.md`

## 这一阶段为什么开始

Phase 1 和 Phase 2 已经把 parser、layout preflight、execution 主走廊收得比较稳了。

现在最明显的剩余“越界点”集中在 `StageManager`：

- 既是 stage registry / camera runtime
- 又直接依赖 `readerApp`
- 还同时管 mode / resize / viewport / letterbox
- 并且自己做参数解析、审计日志、导出

这说明下一阶段最值得做的，不是继续往 `TextPlayer` / `ScriptPlayer` 深挖，而是先把：

- `StageRuntime`
- `ReaderHost`
- `PresentationManager`
- `RuntimeValueResolver`
- `Diagnostics / Audit`

这几条边界准备出来。

## 第三阶段的实际目标

这一阶段不是立刻完整重写舞台系统，而是把下面这条链正式化：

```text
StageCue / StagePlan
  -> RuntimeValueResolver
  -> StageRuntime
  -> PresentationManager
  -> ReaderHost
```

也就是说，这一阶段优先做“拆分准备”和“接缝建立”，而不是一次性完成所有实现迁移。

## 范围

### In Scope

1. `StageManager` 的角色分解与接口前置
2. `ReaderHost / PresentationManager` 的最小边界定义
3. `RuntimeValueResolver` 的抽离准备
4. `StageConflictDiagnostics` 与 `AuditBus` 的最小落点
5. `sceneClear -> scene.clear` 的注册式迁移准备

### Out of Scope

1. `StageManager` 的完整文件级拆分
2. `App.ts` / reader 启动链的大改
3. `DocumentSemanticIR` / `ControlFlowMiddleware` / `StateMiddleware` 的真实实现
4. `KineticText / KineticChar` 的结构性瘦身
5. graph-aware runtime / Phase B 语法功能开发

## 这一轮还能纳入哪些既有规划内容

只纳入那些和 `StageManager` 分层天然耦合、并且不会把范围炸开的内容：

### 1. `RuntimeValueResolver` 种子实现

把目前 `StageManager.resolveValue()` 里对：

- marker 引用
- `var.*`
- 数值 fallback

的解析抽成共享能力。

这样下一步不管是：

- stage cue
- effect params
- future `state.*`

都不会继续各自复制一套求值逻辑。

审查后补记：

- `EffectProcessor.resolveParams()` 现在也复用了同一入口
- 这意味着 effect 参数解析行为已从“只认 `var.*`”扩展为“同时支持 marker 坐标引用与 `var.*`”
- 这是一条有意为之的共享接缝，不是偶然副作用

### 2. `StageConflictDiagnostics` 的前置壳层

这轮不要求真正把冲突检测做成完整 planner，但可以先把这些概念固定下来：

- channel key
- overwrite / additive
- warning event
- runtime trim fallback

这样 `trimActiveStageTween()` 才会真正退回到“兜底机制”的位置。

### 3. `scene.clear` 注册式迁移准备

这一轮已经完成兼容式迁移准备：

- `sceneClear` 是特殊语法糖
- `scene.clear` 是正式 stage cue

作者仍然写 `---`，但 parser/lowering/runtime 已经能把它识别成内部 `scene.clear` cue，同时保留现有 `SegmentBuilder` 里的 paragraph 显隐兼容逻辑。

审查后补记：

- 当前仍是“双路径兼容期”：`scene.clear` 已进入 stage channel，但真实 paragraph 显隐仍由 `SegmentBuilder` 旧路径承接
- 因此 `stagePresets["scene.clear"]` 与 `SegmentBuilder` 的 legacy `isSceneClear` 分支目前存在互锁关系
- 后续一旦给 `scene.clear` 加真实清场实现，必须同步删除旧分支，避免双执行

### 4. 统一审计系统的 stage 入口

这轮适合先建立最小的：

- `DiagnosticEvent`
- `AuditEvent`
- `AuditBus` 或 collector interface

并让 stage/runtime 相关日志从：

- `camAuditLog`
- `dumpCamReport()`

这类私有通道，转向统一事件模型。

### 5. reader / presentation policy 的最小 contract

即使暂时不真正拆出完整类，也适合先固定：

- host 提供什么
- presentation policy 负责什么
- stage runtime 绝不能再直接负责什么

这会直接约束后续改动不再往 `StageManager` 里堆。

## 工作包

### WP1. Stage Role Decomposition

目标：把 `StageManager` 现有职责拆成正式命名的角色，而不是继续让 runtime host 和 reader host 混在一起。

建议收口为：

- `StageRuntime`
- `ReaderHost`
- `PresentationManager`
- `RuntimeValueResolver`
- `StageAuditPort`

建议触达文件：

- `src/core/stage/StageManager.ts`
- 必要时新增：
  - `src/core/stage/types.ts`
  - `src/core/stage/ReaderHost.ts`
  - `src/core/stage/PresentationManager.ts`

验收标准：

- `StageManager` 现有职责有明确归属表
- 新旧接口之间至少有一层 adapter seam

### WP2. ReaderHost / Presentation Policy Seam

目标：把 `readerApp` 依赖和 mode/resize/viewport/letterbox 规则，从 stage cue 执行面里剥出来。

本阶段至少要做到：

- `init()` 不再是唯一能描述 host 绑定的地方
- `resize()` 的政策部分与 camera/runtime 部分可以被区分
- `setMode()` 不再天然等于“舞台演出逻辑”

验收标准：

- 文档与类型层能明确回答：
  - host 提供什么
  - presentation policy 负责什么
  - stage runtime 只负责什么

### WP3. RuntimeValueResolver Extraction

目标：把 `resolveValue()` 从 `StageManager` 中抽离成共享求值接口。

第一轮只覆盖：

- number passthrough
- marker 引用
- `var.*`
- fallback

这轮不要求支持完整表达式。

验收标准：

- stage 参数求值不再只能依赖 `StageManager` 私有方法
- 后续 `EffectProcessor` 可复用同一入口

### WP4. Stage Diagnostics / Audit Seed

目标：把 stage 冲突与审计，从私有日志和直接导出，转成统一事件模型的最小种子。

本阶段至少固定：

- `StageConflictDiagnostics`
- `AuditEvent`
- `StageAuditPort`

这轮可以先只做接口和少量接入点，不要求一次覆盖 layout/effect/script 全部子系统。

验收标准：

- `camAuditLog` 不再是未来唯一方向
- `dumpCamReport()` 被标记为兼容出口，而不是主设计

### WP5. `scene.clear` Migration Prep

目标：为 `sceneClear` 从特殊语法分支迁移到注册式 stage cue 做准备。

本阶段至少落实：

- 统一命名：脚本糖衣 `---`，内部目标 `scene.clear`
- stage registry 可以自然承接它
- 文档里写清楚 parser / lowering / stage runtime 的分工

这轮不要求强制删掉现有 special case，但已经让未来迁移路径变得直接。

## 推荐顺序

1. `WP1 Stage Role Decomposition`
2. `WP2 ReaderHost / Presentation Policy Seam`
3. `WP3 RuntimeValueResolver Extraction`
4. `WP4 Stage Diagnostics / Audit Seed`
5. `WP5 scene.clear Migration Prep`

这样排序的原因：

- 先切角色，后切依赖，不然会一边改 host 一边重新定义概念
- `RuntimeValueResolver` 和 diagnostics 都依赖角色边界清楚以后再落更稳
- `scene.clear` 放最后，能避免一开始就跨 parser/runtime 同时开口子

## 风险与控制

### 风险 1：把 `StageManager` 拆分准备做成完整重写

控制方式：

- 本阶段优先接口、契约、职责归属
- 不要求一次搬空 `StageManager.ts`

### 风险 2：reader host 与 presentation policy 提前拆太细

控制方式：

- 先允许它们是 type/interface + adapter seam
- 等 resize / mode / scroll/page 差异继续膨胀后再做完整实现拆分

### 风险 3：value resolve 过早承诺 state/expr 能力

控制方式：

- 本阶段只做 number / marker / `var.*`
- 表达式和 `state.*` 仍留给 Phase B

## 阶段完成定义

第三阶段完成后，应至少满足：

1. `StageManager` 的 runtime / host / presentation / resolve / audit 角色已经正式命名
2. `ReaderHost / PresentationManager / StageRuntime` 的边界有可用契约
3. `---` 已经能通过内部 `scene.clear` cue 接入 stage registry，同时保留兼容行为

## 本轮落地结果

- `StageManager` 已通过 `ReaderHost`、`PresentationManager`、`StageAuditPort`、`RuntimeValueResolver` 建立接缝
- stage conflict 已进入 diagnostics-first 路径，trim 退回到运行时兜底
- `scene.clear` 已进入 stage registry，`---` 会在 lowering 后生成内部 `scene.clear` 指令
- 旧的 `isSceneClear` / paragraph clear 逻辑仍保留在 `SegmentBuilder`，作为过渡期兼容外壳
- `dumpCamReport()` 已明确降级为兼容导出入口，未来方向是统一 `AuditBus / DiagnosticsCollector`
3. `RuntimeValueResolver` 已有共享接缝
4. stage conflict 已具备 diagnostics-first 的落点
5. `scene.clear` 的注册式迁移路径已经被文档和类型层固定

## 第三阶段之后再做什么

这一阶段完成后，更适合进入：

- `StageManager` 的真实代码拆分
- `ReaderHost / PresentationManager` 接到真实 app bootstrap
- `DocumentSemanticIR` / `ControlFlowMiddleware` / `StateMiddleware`
- Phase B 的 graph / state / control-flow 功能开发

## 当前落地状态

- `WP1 Stage Role Decomposition`：已完成第一轮
  - `StageManager` 已通过 `ReaderHost`、`PresentationManager`、`StageAuditPort`、`RuntimeValueResolver` 建立接缝
- `WP2 ReaderHost / Presentation Policy Seam`：已完成第一轮
  - `readerApp` 依赖已从 `StageManager` 主体中移除，改由 `PixiReaderHost` 适配
- `WP3 RuntimeValueResolver Extraction`：已完成第一轮
  - stage 与 effect 参数求值已共享同一个 runtime resolve seam
- `WP4 Stage Diagnostics / Audit Seed`：已完成第一轮
  - `camAuditLog` 已降为 `StageAuditPort` 的兼容视图
- `WP5 scene.clear Migration Prep`：未完成
- 验证进度：
  - `pnpm exec vue-tsc -p tsconfig.app.json --noEmit`：已通过
  - `pnpm build`：已通过
