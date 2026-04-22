# Phase 4 Implementation Plan

> 状态：COMPLETE
> 目标：在 Phase 3 已建立的 host / presentation / resolver / audit 接缝之上，真正切出 `StageRuntime`，并收掉 `scene.clear` 的兼容双路径
> 对齐文档：`execution-refactor-outline.md`、`ir-refactor-outline.md`、`phase3-code-review.md`

## 当前实施进展

- [x] 新增 `StageRuntime`，承接 `camera / cameraOffset / buildMode / registry / apply / modifiers`
- [x] `StageManager` 收缩为 host / presentation / audit / compat façade，并通过 provider 将 design metrics 与 audit 注入 runtime
- [x] `stagePresets` 已改为直接面向 `stageRuntime`
- [x] `scene.clear` 已改由 runtime handler 承载；`SegmentBuilder` 不再基于 `isSceneClear` 做第二条显隐执行路径
- [x] `ReaderHost` 已补 `unsubscribe` 返回值，`StageManager` 会回收 resize/ticker 绑定
- [x] 已验证 `pnpm build` 与 `pnpm test:parser`
- [x] 样例脚本中的 `scene.clear` / `page` / `seek` 链路已完成人工复核

> 收尾说明：Phase 4 已关闭。后续的 layout 主链路收束、单一语义源、`LayoutStreamBuilder` 三角拆分，转入 Phase 5。

## 这一阶段为什么开始

Phase 3 已经完成了这些关键准备：

- `ReaderHost`
- `PresentationManager`
- `RuntimeValueResolver`
- `StageAuditPort`
- `scene.clear` 的内部注册式落点

但真正的 stage runtime 仍然还留在 `StageManager` 里：

- `camera / cameraOffset / buildMode`
- `register / apply / addModifier / clearModifiers`
- 参数预解析与审计预测

这意味着当前代码虽然已经“能分层”，但还没有真的完成：

- `StageRuntime`
- `StageFacade`
- `scene.clear` 单路径运行时承载

这一刀做完，stage 这一轴才会从“准备完成”进入“结构真的站稳”。

## 第四阶段的实际目标

这一阶段要把当前这条链：

```text
StageCue
  -> StageManager
  -> ReaderHost / PresentationManager / RuntimeValueResolver / StageAuditPort
```

推进成：

```text
StageCue
  -> StageRuntime
  -> StageFacade (compat)
  -> ReaderHost / PresentationManager / RuntimeValueResolver / StageAuditPort
```

也就是说：

- `StageManager` 不再同时扮演 registry + runtime + host facade
- `scene.clear` 不再维持“双路径兼容”作为长期状态
- stage 这一轴为下一步的 diagnostics 统一与 Phase B 接入提供稳定落点

## 范围

### In Scope

1. `StageRuntime` 的真实切出
2. `StageManager` 向 façade / composition root 收缩
3. `scene.clear` 的运行时单路径迁移
4. `ReaderHost` 的最小生命周期清理（attach/detach/dispose seam）
5. stage diagnostics 与 runtime audit 的继续收口

### Out of Scope

1. `DiagnosticsCollector / AuditBus` 的全局统一实现
2. `LayoutStreamBuilder` 三角拆分
3. `ControlFlowMiddleware / StateMiddleware` 的真实实现
4. `DocumentSemanticIR` 的完整 rollout
5. `KineticText / KineticChar` 的结构性瘦身

## 这一轮还能顺带纳入哪些既有规划内容

### 1. 完整收掉 `scene.clear` 兼容双路径

这是 `phase3-code-review.md` 点得最准确的尾巴。

目标不是“再多做一个 TODO 注释”，而是让：

- `stagePresets["scene.clear"]`
- `SegmentBuilder` 中当前基于 `isSceneClear` 的显隐逻辑

最终只保留一条真正承载运行时行为的路径。

过渡期仍允许：

- parser 保留 `isSceneClear` 作为 discriminant

但运行时不应再依赖它做第二份行为判断。

### 2. 为 `StageManager` 的 `apply()` 解压

Phase 3 review 也指出了：

- `StageManager` 行数没明显下降
- 核心原因是 `apply()` 里的参数预解析 + 审计预测还在这里

Phase 4 不一定要把审计预测彻底拆完，但至少要把：

- registry/runtime 执行
- façade 转发

从同一个类里拆开。

### 3. 给 `ReaderHost` 补最低限度的生命周期契约

第三阶段留下的低优先级问题之一是：

- `onResize` 没有 detach 机制

这一轮适合至少把 contract 立起来，哪怕实现仍然很薄。

这样后面再做：

- headless 测试
- host 切换
- 插件/预览多实例

就不会再次回头补洞。

## 工作包

### WP1. `StageRuntime` Extraction

目标：把下面这些职责从 `StageManager` 中切成真正的 runtime 类：

- `camera / cameraOffset / buildMode`
- `register / registerBatch / has / apply`
- `addModifier / removeModifier / clearModifiers`

建议结果：

- `StageRuntime`
- `StageManager` 变成 façade / compatibility root

建议触达文件：

- `src/core/stage/StageManager.ts`
- 新增：
  - `src/core/stage/StageRuntime.ts`

验收标准：

- stage presets 不再需要把“host / viewport / audit façade”也当成 runtime 本体的一部分
- `StageManager` 主要负责组合与兼容转发

### WP2. `scene.clear` Single-Path Runtime Migration

目标：让 `scene.clear` 成为真正的 runtime 承载者，而不再只是 registry stub。

建议方向：

- 将 paragraph clear 行为收口到 `scene.clear` 对应的 runtime handler
- `SegmentBuilder` 中旧的 `isSceneClear` 分支降级为 parser discriminant 或完全移除
- `page` 模式下的清屏等价逻辑一并收口

验收标准：

- 运行时只保留一条 clear 行为路径
- 不出现 `scene.clear` 与 legacy clear 双执行

### WP3. `StageManager` Façade Cleanup

目标：在 `StageRuntime` 切出后，收缩 `StageManager` 的角色。

保留：

- `ReaderHost`
- `PresentationManager`
- `StageAuditPort`
- 兼容 getter / façade

逐步移出：

- runtime 执行面
- registry 主体

验收标准：

- `StageManager` 行数和职责都明显下降
- 对外 API 基本不破坏

### WP4. `ReaderHost` Lifecycle Seam

目标：为 `attachHost()` / `onResize()` 这条链补齐最低限度的清理接口。

第一轮不要求完整多 host 管理，只要求：

- 旧 host listener 不再必然泄漏
- host contract 明确有 dispose/unsubscribe 能力

验收标准：

- `ReaderHost` 不再是假定“只有一次 attach”才安全

### WP5. Stage Runtime Diagnostics Tightening

目标：继续收口 stage 侧 diagnostics，但只做 runtime 范围内的那一小步。

优先项：

- 把 `dumpCamReport()` 真正降级成兼容出口
- 明确 `scene.clear`、trim fallback、modifier-only 指令的审计事件

这轮不要求做全局 `DiagnosticsCollector`，只把 stage 侧事件形状压实。

验收标准：

- stage diagnostics 不再依赖散乱的私有日志语义

## 推荐顺序

1. `WP1 StageRuntime Extraction`
2. `WP2 scene.clear Single-Path Runtime Migration`
3. `WP3 StageManager Façade Cleanup`
4. `WP4 ReaderHost Lifecycle Seam`
5. `WP5 Stage Runtime Diagnostics Tightening`

这样排序的原因：

- 先切 runtime 主体，再迁 `scene.clear`，否则 clear 逻辑还是会绑在旧 façade 上
- façade 收缩应该跟 runtime 切出一起做，不然 `StageManager` 会越来越像空心大壳
- lifecycle 和 diagnostics 是收尾性工作，放在后面更稳

## 风险与控制

### 风险 1：`scene.clear` 迁移时误改 paragraph clear 语义

控制方式：

- 保留 parser discriminant 测试
- 增加样例脚本验证 page / stage 模式下的 clear 行为
- 迁移期间保证只存在一条真正会执行的 runtime clear 路径

### 风险 2：`StageRuntime` 切出后 stage presets 大面积改名

控制方式：

- 先允许 `StageManager` 继续向 presets 暴露兼容 façade
- 等 runtime 稳定后，再决定是否去掉 `stageManager` 这个名字

### 风险 3：一边拆 façade，一边又把新职责塞回去

控制方式：

- 文档明确：Phase 4 只做 stage 这一轴的 runtime 真拆
- diagnostics global、layout tri-split、Phase B 语法一律不纳入本轮

## 阶段完成定义

第四阶段完成后，应至少满足：

1. `StageRuntime` 已真实存在，`StageManager` 不再兼任 runtime 本体
2. `scene.clear` 已成为单路径 runtime 行为
3. `ReaderHost` 具备最小 lifecycle seam
4. stage 这一轴已经从“分层准备”进入“结构可持续演进”
