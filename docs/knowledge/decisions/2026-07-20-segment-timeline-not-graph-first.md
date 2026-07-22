# 段内时间线，而非图优先（Segment-Timeline, Not Graph-First）

- 日期：2026-07-20
- 状态：已采纳（追溯归档，处方 9）

## 回应的力

Phase B 引入控制流（分支/循环/跳转），需要 Segment 之间的图结构（SegmentGraph）。一个根本选择摆在面前：运行时该不该是**图优先**——一切都建模为图节点、由边求值驱动全部执行？还是**时间线优先**——段内仍是确定性时间线，图只管段间导航？

若选错，seek 的正确性、record/replay 的幂等、以及已有的整套 GSAP timeline 机制都会被推翻重来。

## 决策

**Segment 内部是确定性 `gsap.Timeline`（预烘焙、可 seek）；Segment 之间的边由 graph runtime 按 state / control-flow 在运行时求值。** 即“段内时间线 + 段间图边”，不是图优先。线性脚本是“只有 default edges 的图”的特例。

## 方案对比

### 方案 A：图优先（graph-first）
做法：一切皆图节点，运行时从入口沿边求值驱动执行。
代价 / 局限：seek 变成**路径依赖的非确定问题**（到达同一节点可能经过不同路径，状态不一致）；record/replay 幂等难以定义；现有确定性 timeline 机制需要重写。

### 方案 B：段内时间线 + 段间图边（采纳）
做法：段内保持确定性 timeline；图只表达段间导航（condition / default / jump / wait-gate 边）。段内 seek = `timeline.seek(localTime)`；跨段 seek = 恢复目标 `entryCheckpoint`（含 state）再 seek。
代价 / 局限：需要额外的 SegmentGraphPlan + 跨段 seek 逻辑；非 default path 的 seek 语义需另行定义（近似沿 default path）。
为什么最简方案不够用：纯 timeline（无图）表达不了分支/循环；但图优先会把 seek/幂等这些**已解决**的问题重新变成开放问题。段内时间线 + 段间图边各取所长。

## 触碰的不变量

- **seek 幂等**（段内 `timeline.seek`）——守护测试：playback 回归（331 用例）。
- **record/replay**（状态 = 脚本位置的纯函数，见 `2026-07-20-record-replay-seek-idempotency.md`）。
- **scene.clear 单路径**。
- 参照 `docs/knowledge/runtime/core/lifecycle-invariants.md`。

## 与 house style 的关系

沿用仓库既有的“确定性预烘焙 + 运行时只求值必要部分”分层，与 StageRuntime / PlaybackController 的 record/replay 一脉相承。图是**叠加层**，不替换底层时间线模型。

## 可逆性

高。SegmentGraphPlan 是叠加在段上的导航层；若图模型需调整，段内 timeline 与其 seek 行为不动。不锁死 `.kmd` 文件格式或公开 API。

## 结果

体现于 `docs/planning/roadmap/phase-b/1.6-phase-b-plan.md` B3（SegmentGraphPlan）/ B4（graph playback & seek）与 `segment-graph-runtime-draft.md`。现有 single-segment playback 即“只有 default edges 的图”特例，行为已稳定。loop/wait 表面语法封盘于 D25–D27（后向边即循环、`pause(事件)`），运行时形态先行。
