# 主题二：扫院子 —— 台账（2026-08）

> 状态：COMPLETE。Phase B 前的纯清场包：compat 退场 + 架构体检处方 6(d)/10 收尾 + Known Gaps 巡回记录。
> 分支：`chore/theme-2-yard-sweep`（从 main 8ea2aef 切出，每片一个提交，PR 合入——沿用主题一惯例）。
> 对齐体例：`docs/planning/test-net-design-2026-07.md` §8 记账体。
> 规划来源：Claude Code plans `magical-moseying-llama.md`（2026-08-10），硬边界全部来自用户决策。

## 硬边界（执行时遵守情况）

- **不碰 parser/scanner/语言面**（Phase B 浪潮）——约束审计通过：`git diff --name-only main...` 不含 `core/parser/`。
- **timeline/stage 零行为变更**——S3 的 fillReset 是路由收口（'color' ∈ overrideGroups，净行为零变化）；S2 纯改名。
- **Known Gaps 三 bug 全部"记录不修"**（用户裁决）——见 `docs/planning/TODO.md` Known Gaps 节。
- **phase-b 两篇 untracked 讨论稿不入本分支**（属主线 gate #6）——两稿保持 untracked。

## 切片账目

| 片 | 提交 | 内容 | 状态 |
|---|---|---|---|
| #1 | `093b8dc` | 用户 CLAUDE.md/AGENTS.md 原则文本（独立提交，已定稿） | ✅ |
| S1 | `0f94b99` | Batch A 直删 + 文档同步 | ✅ |
| S2 | `caabe9a` | Batch B 迁移改名 | ✅ |
| S3 | `b8e8815` | 处方 6(d) rainbow 收口 + 回归（tripwire 47→49） | ✅ |
| S4a | `d3209a7` | 处方 10 前半：zod 配置防火墙（bundle 探针记账） | ✅ |
| S4b | `ac80ed0` | 处方 10 后半：Pixi 私有访问 adapter | ✅ |
| S5 | `9f02ee4` | Known Gaps 记录（纯文档） | ✅ |
| S6 | `b03d9c6` | 台账收口 | ✅ |
| S7 | 本提交 | CLAUDE.md 健康重构 + roadmap 规划上下文节（文档可发现性） | ✅ |

## 账目表

| 项 | 变化 | 备注 |
|---|---|---|
| 删除的 compat 符号 | 8 | `dumpCamReport`、`stageConflictDiagnostics`、`dumpReport`、`LayoutStreamBuilder`（整文件）、`camAuditLog`、`_pendingGlobalEffects`（3 点）、`store.isPlaying` |
| corpus 文件 | `final-test copy.kmd` 删除 + 2 处跳过行 | golden 零 diff 证明字节重复（54 parser-golden 用例全绿） |
| API 改名 | 2 | `seekTo→seekToParagraph`、`next→advanceToNextParagraph`（均去 async） |
| Tripwire | 47 → 49 | styling 8→10（新增 [13] 两个 it），记账入 S3 commit message |
| core `as any` | 79 → 72 | S1 删文件 −1（78）；S4b adapter 收口 −6（72）。App.ts 剩 2 处（document.fonts / KmdRuntimeConfig，非 pixi 内部） |
| reader bundle | 825,013 → 883,887 B（+58,874 B / +7.1%） | 主 chunk 564,614 → 623,488 B：S4a zod 全量打包 +57,871（探针先行记账）+ S4b adapter 收口 +1,003（App.ts 在 reader 闭包内）。S6 时曾误记 S4a 快照值 882,884，审查时以 HEAD 实测订正 |
| golden diff | 零 | 语料前后字节一致 |
| 分支 diff | 49 files，+1364 / −459 | 审查时实测（不含审查订正提交本身）；含新增测试（validator 11 it、adapter 13 it、styling [13] 2 it、session +2 it、e2e 1 spec）与文档 |

## 有意变更标注集

1. **store.isPlaying 退役**（S1）：SA-22 已确立 `playbackState` 为单一真相源，派生布尔失去最后消费者——有意删除。
2. **seekTo→seekToParagraph / next→advanceToNextParagraph**（S2）：退掉"兼容旧接口"框架标签，诚实改名；返回类型 `Promise<void>→void`。B4 验收承诺"seek/play/pause API 对 editor 稳定"，段落级导航是稳定缝，取 rename 不 inline。
3. **rainbow fillReset 路由收口**（S3）：净行为零变化（'color' ∈ overrideGroups），标注为有意的路由收口。
4. **SETTINGS_PAYLOAD_INVALID**（S4a）：新协议错误码（updateSettings payload 非 record），复刻 LOAD_SCRIPT_PAYLOAD_INVALID 惯例。
5. **Tripwire 47→49**（S3）：有意增 it，记账入 commit message。

## 刻意不做

| 项 | 去向 |
|---|---|
| `TextLayoutEngine.lastAuditLog` write-only（S1 后） | 记入本台账，留待后续（无消费者，清理需动 layout pass 内部） |
| `ReaderCanvas` 剩余 3 个死暴露（loadAndPlay/stop/getPlayer） | 处方 8（Compat 层清退）清点 |
| settings transaction / 字段特判 | post-B（防火墙 ≠ transaction；见 `docs/planning/packages/reader-runtime-web.md`） |
| `@deprecated` legacy mirrors（KineticChar/KineticText/CompatBinder 等） | 处方 8 |
| 8 处 core `debugOverlay` 读点 | 不动（已防御式 `?.`+`===true`；改写会动宿主注入的全局态——否决） |
| `roadmap/phase-a-refactor/` 内 LayoutStreamBuilder 历史叙述 | 档案性质，不改写 |
| `.vscode/CLAUDE.md` | 已本地同步，但被 `.gitignore` 排除（`.vscode/*`），不入版本库 |
| Known Gaps A/B/C 三 bug | 记录不修（用户裁决，S5） |

## S7 · CLAUDE.md 健康重构（2026-08-10，用户提问驱动）

用户问"CLAUDE.md 是否只含原则与稳定引用"。审计发现两类腐化：

1. **过期事实**：`bg` 命令"不存在"叙述（实际 2026-07 已注册，DIP-FX M2）；
   `dumpReport()`/`camAuditLog` "compat wrapper"（S1/S2 已彻底删除）；
   `presets.ts` 单文件路径（实为 `presets/` 目录）；"331 用例"/"vitest ^2.1.8"
   散文数字（必腐，账目归 test-net-design 与 package.json）。
2. **结构违规**：57 行架构描述 = `knowledge/runtime/core/` 三篇管道文档的第二副本；
   24 行语法速查 = `knowledge/language/design.md` 的第二副本（Phase B 将改语言面，必腐）。

处置：CLAUDE.md 193→137 行。架构节只留承重边界（reader 边界、scene.clear 单一路径、
构建消费面、singleton 名单）+ 管道文档引用；语法节只留方向性速记 + 权威引用 +
"不在本文件维护第二份语法"元规则。文档索引补 test-net-design / 健康检查 / 本台账三条
（回答"后续规划如何用上文档"的发现路径问题）。`implementation-roadmap.md` 加
"当前规划上下文"快照节（已完成/刻意不做/生效约束/下一步），每次主题收口更新。

健康判据（今后维护 CLAUDE.md 用）：只含原则、门禁、注册缝、稳定引用；
描述与账目一律下沉 knowledge/planning 文档。

## 门禁记录（S6 收口前）

- `pnpm build` ✓（含 schema/契约漂移守卫——约束版 StrictEqual，探针验证加字段即 TS2344 红）
- `pnpm test` 294/294 ✓ · `test:parser` 67/67 ✓（零 golden diff）· `test:playback` tripwire 49 ✓ · `test:invariants` ✓
- `pnpm test:e2e` 10/10 ✓（chromium 既有 spec 全绿 + boot-resilience 新例，30.4s）
- `pnpm language:check`：no-op 绿（未触语言资产）
- 尸检 grep 全零命中（archive/台账除外）：`dumpCamReport|stageConflictDiagnostics|dumpReport|LayoutStreamBuilder|camAuditLog|_pendingGlobalEffects`、store 级 `isPlaying` 读家
- 约束审计：`git diff --name-only main...` 不含 `core/parser/`；timeline/stage 行为代码零变更
