# Phase 3 代码审查

## 一、完成了什么

| 类别                           | 文件                                                  | 行为                                                                                               |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **新增：舞台类型**             | `src/core/stage/types.ts` (44 行)                     | `CameraState / StageState / StageMode / StageViewport / StageAuditEntry / StageConflictDiagnostic` |
| **新增：ReaderHost 抽象**      | `src/core/stage/ReaderHost.ts` (43 行)                | `ReaderHost` 接口 + `PixiReaderHost` 适配器                                                        |
| **新增：PresentationManager**  | `src/core/stage/PresentationManager.ts` (52 行)       | 设计分辨率、`stage / scroll` 模式、viewport 计算                                                   |
| **新增：审计端口**             | `src/core/stage/StageAudit.ts` (35 行)                | `StageAuditPort` 接口 + `MemoryStageAuditPort` 实现                                                |
| **新增：共享值解析**           | `src/core/runtime/RuntimeValueResolver.ts` (32 行)    | 静态 `resolveReference / resolveNumeric`，覆盖 marker / `var.*` / 数值 fallback                    |
| **修改：StageManager.ts**      | ~310 行                                               | 委托 `PresentationManager / ReaderHost / StageAuditPort / RuntimeValueResolver`；保留对外 getter   |
| **修改：App.ts**               | `stageManager.init(new PixiReaderHost(this.pixiApp))` | host 由 App 注入，StageManager 不再直接 import `readerApp`                                         |
| **修改：EffectProcessor.ts**   | `resolveParams()`                                     | 参数解析改走 `RuntimeValueResolver.resolveReference`                                               |
| **修改：parser/lowering.ts**   | scene-clear                                           | `---` 多生成一条 `scene.clear` layout instruction（前于原有 `pause`）                              |
| **修改：SegmentBuilder.ts**    | stage tween 冲突                                      | 修剪前先 `stageManager.reportConflictDiagnostic()`                                                 |
| **修改：stagePresets.ts**      | 新增 `"scene.clear"`                                  | 目前是 `() => gsap.timeline()` 占位                                                                |
| **修改：final-parser-test.ts** | 新 assertion                                          | 保证 `---` 既保留 `isSceneClear=true`，也会下沉出 `scene.clear`                                    |

`vue-tsc -p tsconfig.app.json --noEmit` 本地通过。

## 二、WP 对照

### WP1. Stage Role Decomposition ✅

`StageManager.ts` 现在的职责表基本清晰：

| 角色                                                            | 归属                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| HostState（camera / cameraOffset）                              | `StageManager` 本体（待进一步从 apply 中抽出 `StageRuntime`） |
| Presentation（design resolution / mode / viewport / letterbox） | `PresentationManager`（part of composition）                  |
| Host binding（mount / resize / ticker / bg color）              | `ReaderHost` + `PixiReaderHost`                               |
| Value resolve（marker / `var.*` / numeric）                     | `RuntimeValueResolver`                                        |
| Audit / Conflict                                                | `StageAuditPort`                                              |

符合计划里"拆准备，不一次完成搬空"的范围界定。`StageManager` 内部把 `designWidth / designHeight / isFixedRatio / viewport` 都改为 getter 转发，对外 API 未破坏。

### WP2. ReaderHost / Presentation Policy Seam ✅

- `readerApp` 的直接 import 已从 `StageManager` 剥离，改由 `App.ts` 构造 `PixiReaderHost` 注入。
- 重要的是：**host 的构造点和 stage runtime 解耦了**，这是未来 headless / worker / test runner 的前置条件。
- `PresentationManager.updateViewport()` 作为单独函数承担 `stage` 模式下的 letterbox 比例计算；`StageManager.resize()` 仅负责 letterbox 绘制和 `updateWorldTransform`。

### WP3. RuntimeValueResolver Extraction ✅

关键点：`EffectProcessor.resolveParams` 现在和 stage 走同一套 resolver。**这是一个行为扩展**：

- 旧行为：只识别 `"var."` 前缀
- 新行为：同时识别 marker 坐标（形如 `name.type.x/y`）+ `var.*`

这正是 `phase-3-implementation-plan.md` 想要的共享接缝，但属于"静默扩展"——建议在 `TODO` / review doc 里明示 effect 参数现在也能吃 marker，避免将来有人把它当成意外行为。

### WP4. Stage Diagnostics / Audit Seed ✅

- 私有 `camAuditLog` 数组 → `StageAuditPort.record / getEntries`
- 新增 `StageConflictDiagnostic`，`SegmentBuilder` 在 trim 前主动上报。
- `setAuditPort()` 允许注入替代实现——未来并入全局 `DiagnosticsCollector` 的接口面已经打开。

### WP5. `scene.clear` Migration Prep ⚠️（部分）

plan 里是"兼容式迁移准备"，计划文档末尾也标注 WP5 仍是 _未完成_。现状：

- `lowering.ts` 已下沉出 `scene.clear` 指令
- `LayoutStreamBuilder.ts:148` 的 `if (stageManager.has(instr.type)) stageInstructions.push(instr);` 会把它收进 stage channel
- `TextPlayer` 通过 `stageManager.apply("scene.clear", ...)` 派发
- `stagePresets["scene.clear"]` 是空 timeline
- `SegmentBuilder.ts:138` 仍然读 `t.isSceneClear` 做段落显隐

结果是：**runtime 会双路径触发，但 stage 侧是 no-op，实际的显隐动作仍由旧代码路径完成。** 功能无回归，但在 "scene.clear 成为真正承载者" 之前，这是个需要警惕的中间状态——一旦给 `stagePresets["scene.clear"]` 加真实实现，`SegmentBuilder.ts:138` 那行必须同步移除，否则会双执行。

## 三、审查发现

| #   | 严重度 | 发现                                                                                                                      | 建议                                                                                               |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | 🟡 中  | `EffectProcessor.resolveParams` 扩展为可解析 marker 坐标，行为范围比旧代码大                                              | 在 phase-3 plan / TODO 中显式标注这一行为扩展；看是否补一个测试 fixture                            |
| 2   | 🟡 中  | `scene.clear` 双路径（stub + 旧 `isSceneClear`）存在"一旦 stub 长肉必须同步拆"的耦合风险                                  | 在 `stagePresets["scene.clear"]` 和 `SegmentBuilder.ts:138` 各加一行 TODO 注释，写明这对必须同步改 |
| 3   | 🟢 低  | `dumpCamReport()` 仍硬编码 `http://localhost:9999/cam`，未标 `@deprecated`                                                | plan 里提到它"被标记为兼容出口"——建议真的加 JSDoc `@deprecated` 或 console.warn 注明未来会移除     |
| 4   | 🟢 低  | `StageAuditEntry.params: Record<string, any>`                                                                             | 可以先不动，未来收敛到 `ResolvedParams` 时统一                                                     |
| 5   | 🟢 低  | `MemoryStageAuditPort.clear()` 会同时清空 entries 和 conflicts，但端口没有单独的 `clearConflicts` / `clearEntries`        | conflicts 目前无界累积，视实际容量决定是否拆分                                                     |
| 6   | 🟢 低  | `ReaderHost.onResize` 没有 detach 机制；`attachHost()` 再次调用会让旧 host 的 listeners 泄漏                              | 当前只有单 host，低优先级；拆真之前加一个 `dispose` 就好                                           |
| 7   | 🟢 低  | `StageManager.resolveValue` 变成一行 delegation                                                                           | 可以保留做向后兼容；未来可把内部调用点直接换成 `RuntimeValueResolver`                              |
| 8   | 🟢 低  | `StageManager` 总行数并未显著下降（依然 ~310 行），核心原因是 `apply()` 里的"参数预解析 + 审计预测"仍在 StageManager 自己 | 属于计划范围之外的工作，下一阶段真正拆 `StageRuntime` 时再处理                                     |

## 四、整体评价

Phase 3 在执行层面做到了三件正确的事：

1. **没有破外部 API**——`stageManager.designWidth / viewport / camAuditLog / resolveValue / ...` 全部通过 getter/delegation 保持不变，上游消费者零改动。
2. **真的建立了可替换接缝**——`ReaderHost / StageAuditPort` 是接口注入，`RuntimeValueResolver` 是静态但已被两个消费者真正共用（不是"建了接口没人用"）。
3. **不把自己卷进完整重写**——`StageManager.ts` 还在，本轮也没强行瘦身；把"拆真"留给下一阶段。

唯一需要回头补的是 `scene.clear` 那条：要么在下一个小轮次里把 `SegmentBuilder.isSceneClear` 的段落显隐逻辑真的迁到 `stagePresets["scene.clear"]` 里，要么在两边加上互锁注释。目前是"重构准备"状态、不是"完成"状态——这一点 plan 文档已经如实标注。

---

# 接下来的重构方向

参考 `refactor-review-v2.md` §4/§5 的排期和 `phase-3-implementation-plan.md` "第三阶段之后再做什么"节，下一批候选工作按投入回报排序如下：

## A. 收尾 Phase 3 的两个尾巴（1–2 天，低风险）

1. **`scene.clear` 完全迁移**：将 `SegmentBuilder.ts:138` 的段落显隐搬进 `stagePresets["scene.clear"]`（或其配套 handler），并把 `token.isSceneClear` 的读用点降级为"parser 侧的 discriminant"，运行时不再分支。配套删除 `SegmentBuildContext.currentMode === "page"` 那条等价判定（因为 page 模式下的清屏也应该由 `scene.clear` 统一承载）。
2. **Phase 2 遗留的 store 耦合**：`SegmentBuilder.build()` 直接 `import { useEditorStore }`、`PlaybackController.seekToTime` 同样——改为 context 回调 (`onStoreUpdate?.()`)。这项 Phase 2 审查就列过，放在这里顺手。
3. **`SegmentBuildContext.metadata: any`** 收窄为 `{ speed: number; maxWidth?: number; [key: string]: any }`。

## B. `StageManager` 真正拆分成 `StageRuntime`（3–5 天，中风险）

Phase 3 建好了接缝，`StageManager` 主体还在。下一刀是把 `apply()` / `register()` / `addModifier()` / `camera / cameraOffset / buildMode` 抽成 `StageRuntime`，`StageManager` 要么降为 façade 要么直接删掉导出换名字。这个动作能把 `StageManager.ts` 从 310 行降到 ~120 行，并让 `stagePresets.ts` 不再依赖 `StageManager` 这个名字。

## C. 统一 `DiagnosticsCollector`（2–3 天，低风险）

现在存在三条独立审计渠道：

- parser `ParserDiagnostic`（已 extends `DiagnosticEvent`）
- `chainPlanning` 的 `diagnostics`
- `StageAuditPort` 的 `conflicts / entries`

把它们合成一个全局 `DiagnosticsCollector` / `AuditBus`，让 Inspector 有统一订阅点。这是 `refactor-review-v2.md` R1 问题 #7 的终点。

## D. `LayoutStreamBuilder` 三角拆分（5–7 天，中高风险）

这是 `refactor-review-v2.md` §4.1 缺口 A 至今没动的一块：`LayoutStreamBuilder.build()` 236 行要拆成 `LayoutPlanner / DisplayAssembler / CompatBinder`，同时明确 `EffectProcessor.partition()` 调用和 `KineticChar` 创建各自归谁。做完这一刀，parser→IR→layout→execution 的主链路就完整由正式角色接��。

## E. 进入 Phase B（graph / state / control-flow）

前置条件基本就绪：`RuntimeValueResolver` 已经有共享点可以接 `state.*`；`DocumentSemanticIR` 的延后目标也到时候该解冻。建议顺序：

1. `DocumentSemanticIR` 最小骨架（只纳入当前确实需要的字段）
2. `ControlFlowMiddleware` 骨架 + `@if / @loop` 语法
3. `StateMiddleware` + `state.*` expression（`RuntimeValueResolver.resolveReference` 扩展为可识别 `state.x`）
4. `SegmentGraphPlan`

## 推荐顺序

```text
A. Phase 3 尾巴（scene.clear 全迁 + store 解耦 + metadata 类型）
  └─> B. StageRuntime 真正切出
        └─> C. DiagnosticsCollector 统一
              └─> D. LayoutStreamBuilder 三角拆分
                    └─> E. Phase B 启动
```

A / C 是低风险补强，B 是"拆真"的自然下一步，D 是目前唯一还在"方向正确但缺行动指引"的模块，E 是功能演进的开始。如果只做一件，应该是 **A + B**（把 Phase 3 彻底收口，让 Stage 侧进入可测试且可拆的终态），再根据业务诉求决定是否先上 Phase B。
