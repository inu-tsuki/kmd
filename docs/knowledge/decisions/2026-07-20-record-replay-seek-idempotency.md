# record/replay 保证 seek 幂等

- 日期：2026-07-20
- 状态：已采纳（追溯归档，处方 9）

## 回应的力

动态排版要支持任意 seek（进度条拖动、页模式回翻）。GSAP timeline 的播放是有状态的：如何保证 **seek 到同一时间点总是得到同一状态**（幂等），与之前播放路径无关？

modifier-based stage 命令、instant/stackable effect、动态注册的 behavior 都不是普通 tween——只靠 `timeline.seek` 覆盖不了它们，seek 会出现漏 apply、重复累积、回翻丢状态。

## 决策

**record/replay 模型**：build 期把 behavior / effect / stage modifier 记录成带 `timePosition` 的 record；seek 时清空当前态，按 record 重放到目标时间。**状态是脚本位置的纯函数，不依赖到达路径。** 跨段 seek = 恢复目标 `entryCheckpoint`（含 state，Phase B 起）再 replay。

## 方案对比

### 方案 A：仅靠 timeline.seek
做法：只用 GSAP 的 seek。
代价 / 局限：覆盖不了 modifier / instant / 动态 behavior；无 record 就无法定义“目标时间的完整状态”；seek 非幂等。

### 方案 B：record/replay（采纳）
做法：记录 + 重放。seek = clear + replay-to-time；instant/stackable effect 有明确 replay boundary。
代价 / 局限：需要维护 record 数组与其 cleanup / replay 所有权（正是处方 6 收口的对象）。
为什么最简方案不够用：GSAP seek 只覆盖 tween；没有 record，modifier/instant/behavior 在 seek 时无从恢复，幂等无从谈起。

## 触碰的不变量

- **seek 幂等**（同位置同状态，与路径无关）。
- **cleanup 单一执行**（record 数组的登记/执行所有权，见处方 6 与 `2026-07-20-... CleanupRegistry` 相关讨论）。
- **instant/stackable replay boundary**（不继承更早背景的 filter 历史，见 dip-fx surface-profiles ADR 的 seek 验证）。
- 守护测试：playback 回归（331 用例，含 R3–R7 的 seek bug）+ invariants 守卫。

## 与 house style 的关系

与 PlaybackController 的 register/replay、StageModifierRecord、effect record 一致。“状态 = 脚本位置的纯函数”是核心 house 理念，也呼应 `scope-and-lifetime.md` D20（生命周期 = 脚本区间，回翻/seek 按脚本位置恢复）。

## 可逆性

低——这是 seek 正确性的地基，不会退。但实现可演进（replay 策略、record 结构可优化），幂等契约本身不变。

## 结果

已实现于 PlaybackController / SegmentBuilder 的 record + replay；R3–R7 触发的 seek/phase/resume bug 固化为 331 用例持久回归（`final-playback-test.ts`，现由 vitest 包装运行）。处方 6 进一步把 record 数组的登记收口到 CleanupRegistry sink、执行保留在单一 `clear*` 路径。
