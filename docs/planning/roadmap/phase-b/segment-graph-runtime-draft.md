# Segment Graph Runtime Draft

> 文档状态：草案 / 未实施 / 未立项
> 最近更新：2026-06-30
> 触发来源：Phase B 控制流（`@ if / @ loop / @ tag / @ jump / @ wait`）的运行时形态在 `1.6-phase-b-plan.md` 工作包中反复出现（`SegmentGraphPlan` / `GraphPlaybackRuntime` / `defaultPath` / `warp replay` / `graph_gate`），但都是占位词，没有定义。本草案补这一层。

## 1. 本文件是什么、不是什么

**是什么**：Phase B 工作包（`1.6-phase-b-plan.md` B3/B4）缺的"运行时到底长什么样"那一层设计。把工作包里的占位词（`SegmentGraphPlan`、`GraphPlaybackRuntime`、`defaultPath`、`warp replay`、`graph_gate`）落到数据结构形状与边求值规则，使未来 B3/B4 实施时有可引用的规格。

**不是什么**：
- **不是近期实施计划**，不改变现有代码。工作包拆分与顺序仍以 `1.6-phase-b-plan.md` 为准。
- **不是已验证事实**。Segment Graph 未实现、未跑通、未回归，故放 `planning/` 而非 `knowledge/`。等 Phase B 真实施并验证后再"毕业"迁入 `knowledge/runtime/core/`（晋升路径与 R13 的 `replayStyles` 语义记录同源）。
- **不重复工作包清单**。B0-B6 各做什么见 plan，此处只补运行时形态。

**Phase B 恢复条件不变**（`1.6-phase-b-plan.md §1`）：reader-runtime-web smoke 稳定、语言收敛审查、包边界不被污染。本草案只是设计沉淀，不解除这些 gate。

## 2. 第一性原则：控制流不进 timeline

这是整套设计的地基。

当前 Phase A 的 `Segment`（`apps/editor/src/core/state/Segment.ts`）结构：

```ts
interface Segment {
  timeline: gsap.core.Timeline;   // 确定性，seek 可插值
  behaviors / styleRecords / instantEffects / entranceFilters / stageModifierRecords;
                                    // 不在时间线上，靠 record 重放
  entryCheckpoint / exitCheckpoint; // 状态快照
  duration: number;
}
```

GSAP `timeline.seek(t)` 是**确定性插值**——只能沿固定 tween 序列前后移动。但 `@ loop` / `@ jump` 是**控制流**：同一个文本块第二次进入时，相机变量、stage 状态、已揭示段落都可能不同。硬塞进一条 timeline 会让：

- `timeline.seek()` 语义崩溃（同一时间点对应多个状态）。
- `replayStyles` / `registerBehaviors` 这类 record 重放逻辑全部歧义（R13 刚修的就是"同一资源多窗口"病，见 `knowledge/runtime/core/lifecycle-invariants.md` SA-28）。
- `Checkpoint` 的"段入口快照"语义失效。

**结论**：Segment 内部永远是确定性 timeline，Segment 之间用 graph。控制流是 graph runtime 的 record-driven 调度，**不进 timeline**。这与 `knowledge/runtime/core/timeline-and-easing.md` 的"四类不在时间线上、靠 record 重放的指令"（styles / behaviors / instant effects / stage modifiers）同构——控制流是 graph runtime 层的第五类 record-driven 调度，只是它的 record 是边。

> 兼容性：线性脚本退化成"单节点 graph + 一条 default 边"，`PlaybackController` 行为零变化（B3 验收：原有 single-segment playback 行为保持一致）。

## 3. 在管线中的位置

`1.6-phase-b-plan.md §3` 的目标管线中，控制流在这两层结构化：

```text
Source → DocumentParser → DocumentAST
  → AstNormalizer → DocumentDependencyResolver
  → ControlFlowLowerer / StateLowerer   ← 控制流在这层结构化（文档级，不进段落 parser）
  → DocumentSemanticIR
  → ... → ParagraphExecutionPlan → SegmentExecutionPlan
  → SegmentGraphPlan                     ← graph 在这层烘焙
  → GraphPlaybackRuntime                 ← 运行时求值边
```

纪律（plan §2 设计原则）：
1. `@ if / @ loop / @ jump` 由 `DocumentParser`（文档级）处理，**不进段落 parser**。
2. `ControlFlowLowerer` 输出结构化 control nodes，**不压进 `paragraph.globalEffects`**（避免再造多路径单一真相源 bug，即 INV-7 那类病）。
3. 跨文档跳转先只作 **graph edge metadata**，不直接触发 loader。

## 4. 核心数据结构

工作包（B3）给出的形状：

```ts
interface SegmentGraph {
  nodes: SegmentGraphNode[];      // 每个节点持有一个烘焙好的确定性 Segment
  edges: SegmentGraphEdge[];      // condition / default / jump / loop-back / wait-gate
  defaultPath: NodeId[];          // seek 兜底路径（见 §6）
}

interface SegmentGraphNode {
  id: NodeId;
  segment: Segment;               // ← 现有 Segment，零改动
  entryTags: TagId[];             // @ tag 锚点
  exitTags: TagId[];
}

interface SegmentGraphEdge {
  from: NodeId;
  to: NodeId;
  kind: "default" | "conditional" | "jump" | "loop-back" | "wait-gate";
  priority?: number;              // 条件边按优先级求值（@ if / @ elif）
  condition?: Expression;         // @ if 的条件（读 StateStore）
  loop?: { counter: string; max: Expression };  // @ loop N
  jumpTarget?: TagId;             // @ jump target（= 目标节点的 entryTag）
  wait?: { signal?: string; click?: boolean };  // @ wait
  documentRef?: DocumentId;       // 未来跨 .kmd（先作 metadata，不触发 loader）
}
```

**关键不变量**：`Segment` 本身不动。graph 是 Segment 之上的一层。`SegmentBuilder` 降级为"单 Segment builder"（B3 偿债），新增 `SegmentGraphBuilder` 负责"段落组切割 + edge 生成 + tag 索引"。

> Checkpoint 扩展（B1 偿债）：`Checkpoint` 现在只存 `stage` / `layout` / `activeParagraphs` / `inFlightAnimations`（`state/Segment.ts`）。控制流要求 `Checkpoint` 增 `state: StateSnapshot` 字段，使回边/跳转能恢复变量。这与 plan B1 的"`Checkpoint` 增加 `state`，不再只保存 stage/layout"一致。

## 5. 四种控制流语义的边求值规则

### 5.1 `@ if / @ elif / @ else` → 条件边

```
[Node A] --condition(exprA), priority 1--> [Node B]   @ if gold > 5
        \--condition(exprB), priority 2--> [Node C]   @ elif gold > 2
         \--default---------------------> [Node D]    @ else
```

**求值**：Node A 播完 → `GraphRuntimeCoordinator` 对出边按 `priority` 升序求值 `condition`（读 `StateStore`）→ 选第一条 true 的边 → 进入对应节点。`default` 边 priority 最低且恒 true。

**前置依赖**：B1 的 `StateStore { get, set, snapshot, restore }` + 极简表达式求值（字面量 / 变量 / 算术 / 比较 / 逻辑）。

### 5.2 `@ loop N` / `@ while` → 回边 + 计数器

```
[Node A] <--loop-back(counter i<N)-- [Node B]
```

**求值**：graph 的一条**回边**（back-edge），edge 挂 `{ counter, max }`。Node B 播完 → coordinator 递增 counter → 检查 `< max`（或 while 的 condition）→ true 则走回边回 Node A，false 则 fall through 到 default 出边。

**关键**：每次走回边进 Node A 前，**恢复 Node A 的 `entryCheckpoint`**（含 B1 扩展的 `state`），再 `timeline.seek(0)` 重播。这样"循环体第二次进入状态不对"的问题被 checkpoint 机制天然回避——Phase-A 的 `Checkpoint` 就是为这种"段入口可恢复"设计的。

**Open Question**（plan §8）：`@ loop N` 当 N 是表达式时，编译时求值还是运行时边计数？本草案取向**运行时 edge 计数**——因 N 可能依赖 state，编译时求值会丢失动态性。`@ while` 无 max，纯靠 condition。

### 5.3 `@ tag / @ jump` → tag 索引 + 非邻接边

```
@ tag shop_start          → Node X.entryTags = [shop_start]
@ jump shop_start         → edge { from: 当前, to: Node X, kind: "jump", jumpTarget: "shop_start" }
```

**求值**：`SegmentGraphBuilder` 烘焙期建 `Map<TagId, NodeId>` 索引。`@ jump` 编译成 `kind: "jump"` 的非邻接边。运行时求值 jump 边时，coordinator 先恢复目标 Node 的 `entryCheckpoint` 再进入。

**diagnostics-first**（`execution-refactor-outline.md` Diagnostics 策略）：未定义跳转（`@ jump` 指向不存在的 tag）在 build 期报，不靠运行时崩溃。重复 tag、tag 跨文档但无 dependency 声明同理。

### 5.4 `@ wait click` / `@ wait signal` → wait-gate 边（引入暂停态）

这是唯一引入**非确定性**的语法。普通边是"上一节点播完立即求值"，wait-gate 边是"播完后挂起，等外部信号"。

```ts
edge.kind = "wait-gate"; edge.wait = { click: true }
```

**求值**：Node A 播完 → coordinator 发现出边是 wait-gate → **不立即选边**，注册 promise/回调，把播放状态置为 "waiting"（新的 PlaybackPhase）→ 用户点击 / 收到 signal → resolve → 走 default 出边。

**与 `PlaybackPhase` 的衔接**：现有 `PlaybackController.derivePhase` 返回 `playing | paused | ended`（`PlaybackController.ts` F-2）。`waiting` 是**第四种 phase**，seek 到 wait-gate 时按 static 快照停留（与 cam.shake seek 的 static 处理同构，见 `timeline-and-easing.md` 前提 4）。

**Phase 边界**：`@ wait signal` 在 Phase B 只**预留 signal 形状**（edge.wait.signal 字段），完整 `SignalRegistry` 是 Phase C（plan §6 非目标）。`@ wait click` 可在 B4 实现。

## 6. Graph seek 策略（B4）

这是最易出 bug 的领域（Phase-A R8-R13 反复踩坑的就在 seek/replay）。B4 的四种策略：

| seek 目标 | 策略 |
|---|---|
| 同一 Segment 内 | 现状不变：`timeline.seek(localTime)`（确定性） |
| 跨 Segment | 先恢复目标 Segment 的 `entryCheckpoint` → 再 seek 到本地时间 |
| 条件分支 | 默认沿 `defaultPath`（不真求值 condition，因 seek 不应有副作用） |
| loop/while | 入口 checkpoint + warp replay |

**为什么条件分支 seek 沿 defaultPath**：seek 是"瞬时跳转"，不能真去求值 condition（condition 可能依赖已变化的 state，而 seek 本身不该有副作用）。graph 维护 `defaultPath`（等价于"所有条件取第一条/else 分支的路径"），seek 沿它走。这是 plan §8 Open Question 列的"graph seek 对非 default path 的 UI 预期"——本草案取向：**直接 seek 只走 default，要看分支结果得真播放**（UI 侧未来可补路径选择器，但非首轮）。

**warp replay**：seek 到 loop 体中间时，恢复入口 checkpoint 后，快速（零时长或加速）重放到目标时间点，不真播放。这与 `replayStageModifiers` 的 static 模式、`replayStyles` 的 reset-then-replay 同族。

> **关键教训（接 R13/SA-28）**：graph seek 也要遵循"reset 窗口 vs apply 窗口解耦"。seek 到 graph 中间时，coordinator 须 reset 所有可能被污染的 state（不止当前节点的），再沿 path 重放——不能与 apply 共用同一时间过滤。R13 在单 Segment 内修的这类病，在 graph 层会以"跨节点 state 残留"的形态重现。实施 B4 前应把 `lifecycle-invariants.md` §G 的第六机制（两个语义维度共用一个过滤）作为检查清单。

## 7. 与现有 execution 设计的衔接

`execution-refactor-outline.md` 的"建议拆分角色"已点名本草案涉及的模块，此处对齐命名：

| 现有引用 | 本草案角色 | 出现处 |
|---|---|---|
| `GraphRuntimeCoordinator` | §5/§6 的边求值 + graph seek 协调 | execution-refactor-outline §建议拆分角色 |
| `graph_gate` | §5.4 的 wait-gate 边（暂停态切分点） | execution-refactor-outline §正式化链执行模式 |
| `DeterministicTimelinePlan` | Segment 内部确定性 timeline（Phase A/B 主路径） | execution-refactor-outline §明确 execution backend 分叉 |
| `InteractiveRuntimePlan` | wait-gate 引入的非确定性（Phase C 完整化） | execution-refactor-outline §明确 execution backend 分叉 |
| `StateCue` | §5.1/5.2 读写的 state（set / snapshot / restore / branch condition probe） | execution-refactor-outline §明确四类 execution cue |

**职责拆分纪律**（plan B4 偿债 + execution-refactor-outline）：
- `ScriptPlayer` 收缩为 load/build/play facade。
- 新增 `GraphPlaybackController`（graph 行为）与现有 `PlaybackController`（单 Segment 行为）分离——不把 graph 逻辑塞进 `ScriptPlayer`，避免重蹈 `TextPlayer` 当"现场编译器"的覆辙。
- core 到 editor store 的时间/行号/marker 更新改为 callbacks（不让 core import Pinia）。

## 8. 最小可工作第一刀（B3 → B4）

按 plan §5 推荐顺序，第一刀**不需要完整控制流**：

1. **B3**：把现有线性脚本包进 graph（单节点 + 一条 default 边）。`SegmentGraphBuilder` 切割段落组、生成 edges、建 tag 索引。验收：线性脚本行为零变化，但底层已是 graph。
2. **B4 第一子步**：graph runtime 只接 `@ tag / @ jump / @ if` 的**最小行为**（邻接边 + 条件边 + jump），**不含 loop/wait 的非确定性**。验收：seek/play/pause 对 editor API 仍稳定。

**loop 与 wait 放更后**：回边引入"二次进入"（需 checkpoint state 恢复），wait 引入暂停态（需 PlaybackPhase 扩 `waiting`）。两者 seek 语义更复杂，等 B3/B4 邻接 + 条件 + jump 稳定后再上。

## 9. Open Questions（沿用 plan §8 + 本草案新增）

沿用 plan §8：
- `state.*` 与 `var.*` 是否长期双命名空间。
- `.kmd` 引用另一个 `.kmd` 时的作用域（state 共享？effect object namespace 隔离？循环引用诊断？）。
- Work 与 `.kmd` 依赖图的绑定方式。

本草案新增：
- **defaultPath 的计算时机**：build 期静态计算（快，但 condition 含 state 时只是"假设全 false"的退化路径）还是 seek 时动态回溯（准，但慢）。取向 build 期静态 + 沿邻接 default 边。
- **wait-gate 期间的 state 写入**：用户在 `@ wait click` 期间通过其他渠道改 state（如调试器），点击后是否立即反映？取向：wait 期间 state 可写，resolve 时重新求值 default 边。
- **loop counter 的可见性**：`@ loop i in 0..N` 的 `i` 是否暴露为 state（可供循环体内 `{var.i}` 插值）？取向：暴露，counter 名即 state key。
- **graph seek 的行号/marker 上报**：跨节点 seek 后，editor timeline markers 如何表示非 default path？首轮取向：markers 只画 defaultPath，非 default 段不显示（与"直接 seek 只走 default"一致）。

## 10. 相关文档

- `1.6-phase-b-plan.md`：Phase B 工作包（B0-B6），本草案的上级。
- `../phase-a-refactor/execution-refactor-outline.md`：execution 层拆分诊断，`GraphRuntimeCoordinator` / `graph_gate` / backend 分叉的出处。
- `../../../knowledge/runtime/core/timeline-and-easing.md`：四类 record 重放指令 + seek replay 模型，控制流是其同族第五类。
- `../../../knowledge/runtime/core/lifecycle-invariants.md` §G：审查-修复循环元方法论，第六机制（两个语义维度共用一个过滤）是 graph seek 实施前的检查清单。
- `../../../knowledge/language/design.md` + `brainstorm.md`：语言设计探索，跨 `.kmd` 引用与 control-flow 命名空间收敛审查（Phase B 恢复条件之一）。
