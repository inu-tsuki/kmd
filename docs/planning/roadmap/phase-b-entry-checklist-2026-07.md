# Phase B 客观准入清单

> 状态：Active（架构体检处方 7 落地）
> 最近更新：2026-08-13
> 出处：架构体检处方 7（`../../planning/architecture-health-check-2026-07.md`）
> 目的：把 Phase B“能不能开工”从**主观判断**变成**可判定清单**——逐项给出状态与可执行的验证方式，不靠感觉。

## 怎么用这份清单

Phase B（从 B0.1 起）开工前，下表所有**硬 gate** 必须 ✅；**持续条件**在整个 Phase B 期间保持。每项都附**可执行的验证方式**，任何人照做都能得出同一个结论。

## 准入项

| # | 准入项 | 类型 | 状态 | 验证方式（可判定）|
| --- | --- | --- | --- | --- |
| 1 | 语言设计封盘（D1–D27）| 硬 gate | ✅ 2026-07-08 | `docs/knowledge/language/design.md` 五公理 + D1–D27 在；分章 `chain-model / selection-model / scope-and-lifetime / control-flow / migration` 齐 |
| 2 | Android 集成冻结 | 硬 gate | ✅ 2026-07-14 | `implementation-roadmap.md` “Ready: Phase B, Android Integration Frozen” 节在；R3-K1 设备测试 8/8 |
| 3 | reader-runtime-web 边界稳定 | 持续条件 | ✅ 持续 | `pnpm reader:typecheck` 绿；`packages/reader-runtime-web` 无 Vue/Pinia/Monaco/TextMate/editor-panels import（grep 验证）|
| 4 | 测试网就位（处方 5）| 硬 gate | ✅ 2026-07-20（PR #24）| `pnpm test` 全绿；parser 黄金覆盖全语料 + B0.1 触及语法；CI 含 vitest 步骤 + shader 门禁（无 `SKIP_SHADER_GATE` 逃生门）|
| 5 | SegmentBuilder 已拆（处方 6）| 硬 gate | ✅ 2026-07-20（PR #24）| 按下方“Gate #5 可复现验证”执行：以 `core:check`、五个职责文件存在且 `SegmentBuilder` 实际委托为准；行数只作历史记录，不作为会随注释/格式漂移的 gate。PlaybackController 收口仍为 deferred。|
| 6 | Phase B 设计评审包齐备 | 硬 gate | ✅ 2026-08-13（候选定稿齐备） | [`phase-b/b0-chain-frontend-architecture.md`](phase-b/b0-chain-frontend-architecture.md) + [`phase-b/b0.1-chain-parser-design.md`](phase-b/b0.1-chain-parser-design.md) 已覆盖 typed literal/链 AST、decoded/raw 与 NUMBER legacy compatibility、malformed intentional tightening、`LegacyCommandAdapter` / 非链 scalar helper / `CompatProjector` 边界、top-level/block-option/inline-pause/comment/range production inventory、structured diagnostics/LSP、typed AST tooling/runtime 读取约束、S1–S5 owner/门禁与 `test:parser` 接线；关键 ADR 为 [`../../knowledge/decisions/2026-08-12-typed-chain-ast-legacy-projection.md`](../../knowledge/decisions/2026-08-12-typed-chain-ast-legacy-projection.md)（提案中，只有 #8 才代表决策采纳） |
| 7 | 无 open design issue | 硬 gate | ✅（有记录的迁移债，非未定设计）| `design.md` 无悬而未决项；已知实现问题记录在 `migration.md` 解析器工程债 1–9，属“已知待迁移”，不是“设计未定” |
| 8 | 一次评审通过 | 硬 gate | ⬜ 待完成 | 本清单 + B0.1 落地设计经决策者过目确认 |

### Gate #5 可复现验证

```powershell
pnpm core:check
$required = @('BehaviorRecordBuilder', 'StyleRecordBuilder', 'StageModifierBuilder', 'CleanupRegistry', 'StyleWritePort')
foreach ($name in $required) {
  $path = "packages/core/src/player/$name.ts"
  if (-not (Test-Path -LiteralPath $path)) { throw "missing $path" }
}
rg -n "BehaviorRecordBuilder|StyleRecordBuilder|StageModifierBuilder|CleanupRegistry|DefaultStyleWritePort" packages/core/src/player/SegmentBuilder.ts
```

最后一条必须同时看到五个类型的 import，以及对应 builder/registry/port 的实例化或委托调用；只存在空文件不算通过。

## 判定规则

- 所有**硬 gate** ✅ ⟹ Phase B（B0.1）可开工。
- **当前缺口**：仅 **#8 决策者评审**。#6 只证明候选设计已把已知 production entry、兼容值和诊断合同写到可裁决程度，不表示方案已经定稿采纳；ADR 仍是“提案中”。决策者需明确确认架构文档 §9 与 ADR 决策 1–14，才能把 #8 置为 ✅ 并开始 B0.1 编码。
- **持续条件 #3** 在 Phase B 每个工作包的 gate 里复查（见 `phase-b/1.6-phase-b-plan.md` §7）。
- 已完成的硬 gate（#1/#2/#4/#5）若被后续改动破坏（如测试网被绕过、reader 边界被污染），状态回退为 ⬜，须重新满足。

## 与旧门条件的关系

旧门条件“语言设计文档完成一次收敛审查”**不可判定**。本清单以 **#1（封盘 D1–D27）+ #7（无 open design issue）+ #8（评审采纳）** 三项替代，使其可判定；并新增 **#4 测试网 / #5 SegmentBuilder / #6 设计评审包齐备** 三项工程 gate，把“无测试网不动手”“先设计后编码”的纪律固化下来。
