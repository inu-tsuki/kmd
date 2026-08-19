# Architecture Decisions

> 最近更新：2026-08-19

这里预留给 ADR。每份文档应记录一个重要选择：背景、决策、取舍、替代方案和后续复核条件。

## 命名建议

```text
YYYY-MM-DD-short-decision-title.md
```

## 放置规则

- 已经影响长期架构的选择放这里。
- 仍在探索的想法先放 `../language/`、`../architecture/` 或 `../../planning/`。

## 当前决策

- `2026-07-10-dip-fx-surface-profiles.md`：DIP-FX 的文字、背景、frame surface profile 模型；作为 M3 gate。
- `2026-07-20-segment-timeline-not-graph-first.md`：段内确定性时间线 + 段间图边，而非图优先（Phase B 运行时形态）。
- `2026-07-20-phase-r-before-phase-b.md`：reader-runtime 抽包（Phase R）先于语言工作（Phase B）。
- `2026-07-20-record-replay-seek-idempotency.md`：record/replay 保证 seek 幂等（状态 = 脚本位置的纯函数）。
- `2026-07-20-reader-runtime-reexport-not-core-package.md`：历史决策；reader-runtime 曾以相对路径 re-export core，现已被 2026-08-10 决策取代。
- `2026-08-10-extract-private-core-package.md`：物理抽出私有 `@kmd/core`，但不冻结或发布 Phase B 前的内部 API。
- `2026-08-19-b0-1-parallel-build-no-compat-projection.md`：B0.1 并行建造——typed syntax AST 唯一事实源，不设 LegacyCommandAdapter / compat view；切换日语料重写即审计。取代 `codex/todo-integration` 分支的候选 ADR（2026-08-12 typed-chain-ast-legacy-projection）。
