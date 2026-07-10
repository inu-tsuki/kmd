# 架构体检 2026-07 · 结论与处方追踪

> 最近更新：2026-07-07
> 性质：planning —— 处方 5–10 影响后续开发排序；全部完成后本文档移入 `docs/archive/`。
> 体检方式：四路并行审计（核心架构 / 模块边界 / 文档一致性 / 质量基础设施），结论均经代码逐条核实。
> 长期事实沉淀：模式地图见 `docs/knowledge/architecture/design-patterns-map.md`，提案/ADR 模板见 `docs/knowledge/decisions/TEMPLATE.md`。

## 一句话结论

**骨骼健康，免疫缺失**：依赖方向干净（零循环依赖、core/UI 边界零违规、文档准确率 95%+），
但此前无 CI、无 reader 包类型检查、核心 runtime 自动化测试覆盖 <5% —— 错误改动可以静默进入 main。

## 主要发现（按危险度）

1. **零自动化防线**（已由处方 1–2 处置）：无 CI；`reader:build` 曾只跑 Vite 不做类型检查；
   首次对 reader 包跑 tsc 即暴露 2 处积累问题（`commandCatalog.ts` 非法转换、vite.config 误入 include）。
2. **三个上帝对象**：`SegmentBuilder.ts`（851 行/74 方法）、`TextPlayer.ts`（781 行）、`PlaybackController.ts`（715 行）。
   真正的耦合不在 import 而在共享可变状态：`PlaybackRuntimeState` 的 cleanup 数组有 3 个写入方，`KineticChar.style` 有 5 个写入方（R16/SA-31 曾在此踩坑）。
3. **文档缺口**：GEMINI.md 过期（已修）；Phase B 准入条件主观；`docs/knowledge/decisions/` 空置；
   核心区 162 处 `as any`（Pixi 私有内部、`globalThis.KmdRuntimeConfig` 无 schema）。

## 处方追踪

### 已完成（2026-07-07，本次提交）

- [x] **处方 1**：`reader:build` / `reader:check` 前置 `tsc --noEmit`；新增根脚本 `reader:typecheck`。
- [x] **处方 2**：`.github/workflows/ci.yml` —— PR/push 时跑 language:check + 编辑器 build + test:parser + reader typecheck/build + community-api build/test。
- [x] **处方 3**：GEMINI.md 重写为最小指针文档（消除版本号与 `docs/ai/*` 幽灵引用，指向 CLAUDE.md/AGENTS.md/roadmap）。
- [x] **处方 4**：四个 manager（effect/style/layout/stage）新增公开 `getRegisteredNames()`，
  替换 `kmd-lang.ts` 中 `(manager as any).registry` 强转。
  **顺带修复潜伏 bug**：`stageManager` 上并无 `registry` 字段（在 `StageRuntime` 里），
  原代码令 stage 命令补全在运行时抛 TypeError（被 Monaco 静默吞掉），`cam.` 补全实际失效。

### Backlog（处方 5–10，按建议顺序）

- [ ] **处方 5 · 测试收编**（Phase B 开工前完成，约 1–2 周）
  把 `apps/editor/src/test-*.ts` / `final-*-test.ts` 散件收编为 Vitest 套件；
  重点补 layout 坐标稳定性与 effects 四轨分类测试 —— **Phase B 将大改这些区域，无测试网不动手**。
  同时：CI 安装 glslang（`glslang-tools`），将 `test:shaders` 纳入必跑门禁（当前 `SKIP_SHADER_GATE=1` 可绕过）。
  **部分落地（2026-07-10）**：Playwright Chromium 已接入 CI，首个 production reader bundle e2e 覆盖
  `fx-bg.kmd` 的 Pixi texture 生命周期、背景/内容层级与 `:bg` filter 归属；Vitest 收编与 shader CI 仍待完成。
- [ ] **处方 6 · 拆解 SegmentBuilder**（约 2–3 天）
  按记录类型抽出 BehaviorRecordBuilder / StyleRecordBuilder / StageModifierBuilder 子构建器，目标 851→~400 行。
- [ ] **处方 7 · Phase B 客观准入清单**
  现行门条件"语言设计文档完成一次收敛审查"不可判定；建 `docs/planning/roadmap/` 下的收敛验收文档
  （例如：B0–B4 语法定稿、design.md 覆盖全部命令族、一次评审通过、无 open design issue）。
- [ ] **处方 8 · Compat 层清退**
  CompatBinder / CompatProjector / KineticChar・KineticText legacy 镜像共约 40 处引用；
  定死线（建议 Phase B 完成后的第一个维护窗口），先建引用清单再逐一迁移。
- [ ] **处方 9 · 补写 3–5 篇 ADR**（用 `docs/knowledge/decisions/TEMPLATE.md`）
  候选：Segment-timeline 而非 graph-first；Phase R 先于 Phase B；record/replay 保证 seek 幂等；
  reader-runtime 以相对路径 re-export 而非立即抽 `packages/core`。
- [ ] **处方 10 · 外部依赖防波堤**
  `globalThis.KmdRuntimeConfig` 加 schema 校验（zod 已在 community-api 使用，可复用）；
  `App.ts` 中对 Pixi 私有内部（`renderer.batchPipe` 等 11 处强转）收拢进单一 adapter 并加启动期预检。
- [x] **处方 11 · DIP-FX M2 Task B（`bg` 命令 + `:bg` 作用域）回归修复**（2026-07-09 提交 `3a38445` 代码审查发现，7 条 bug 全部修复）
  1. ✅ **`bg(...)` 命令名撞车**——`visual.ts` 旧 `bg` 改名 `box`（`mutexGroup:"box"`），消除 `effectManager.has("bg")` 恒真导致的 stage bg 死代码。`final-playback-test.ts` R12 用例同步改名。
  2. ✅ **`:bg` 四条轨道 target 解析补齐**——entrance track 加 `:bg` target 解析；style track `:bg` 跳过并 warn（Sprite 无 `getGraphicsLayer`）；`TextPlayer.unrollGroupChain` 容器级分支加 `:bg` target 解析；内联 style `:bg` 跳过。
  3. ✅ **`setBackgroundSprite` 不销毁共享 texture**——改 `destroy({ texture: false })` + `Assets.unload(url)` 释放缓存引用。
  4. ✅ **`dumpState`/`restoreState` 快照 `bgSpriteUrl`**——`StageState` 加字段，`loadState` 通过 `loadBackgroundFromUrl` 重新加载。
  5. ✅ **`bg(color)`/无参 `bg()` 清除图片 sprite**——补 `setBackgroundSprite(null)`。
  6. ✅ **`bg(src)` 异步竞态**——target 延后到 `segmentTl.call` 触发时解析 + `onBackgroundReady` 延后 apply。
  7. ✅ **并发 `bg(src)` 纪元号守卫**——`_bgEpoch` 丢弃过期 resolve。
  修复详情见 spec §0.5.1；`fx-bg.kmd` 补 `[.gray:bg]` 回归用例。门禁：build + parser + playback (260) + invariants ✅。

- [x] **处方 12 · DIP-FX `bg`/`frame` 作用域语法方向变更**（2026-07 语言设计讨论结果，已落地约束）
  - ✅ **不将 `frame` 作为第五个 `CommandLevel` 值加入**——`design.md` D12 封盘，工程债记在 `migration.md` #9。
  - ✅ **`:bg` 保留为过渡期兼容写法**，不立即重构——Phase B 排期未定。
  - ✅ **M2 剩余滤镜不受影响，照常推进**——走既有 `char/group/block` 机制。
  - Phase B 启动时 `bg` 收编为内建对象主语（`bg.<effect>(...)`），`frame` 同理，不进 `CommandLevel`。
  约束已写入 spec §0.5.1 和 `effect-pipeline.md`。

## 复核条件

- 处方 5 完成后：更新 CLAUDE.md"There is no full unit-test suite yet"表述。
- 全部完成后：本文档移入 `docs/archive/`，要点并入 roadmap 阶段记录。
