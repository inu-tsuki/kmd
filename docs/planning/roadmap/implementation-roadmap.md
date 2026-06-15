# KMD Implementation Roadmap

> 状态：Active
> 最近更新：2026-06-15

## 当前判断

KMD 1.6 Phase A 与 Phase B Prep 已完成 parser、layout、execution、stage、diagnostics 和 metadata 的主链路准备。但继续推进 Phase B 时，我们发现语言设计本身需要更完整的重构：命名空间、指令封装、响应式变量、布局关系、控制流和游戏化 segment 会一起展开。

同时，Android Reader 需要一个可复用、无 Pinia、无 editor shell 耦合的 WebView runtime。因此曾在 Phase B 前插入 Phase R。Phase R 的 R0-R7 已完成：`@kmd/reader-runtime-web` 已作为 workspace package 接管 reader-only bundle 构建。

当前路线调整为：

> Phase R 已完成包边界建立；当前先稳定 Android 真机/模拟器 smoke 与 package artifact 消费链路，同时完成 Phase B 语言设计收敛审查，再恢复 Phase B 实施。

## 阶段顺序

### Completed: Phase A / Phase B Prep

已完成：

- Timeline 化与 Segment 基础设施
- parser AST/IR 主链路与 compat 投影
- LayoutPlanner / DisplayAssembler / CompatBinder 起手
- StageRuntime / ReaderHost / PresentationManager 分层
- diagnostics / audit 总线统一
- effect/layout/stage metadata 与 parser syntax-only 预留
- `packages/language` 语言资产包

### Completed: Phase R — Reader Runtime Web Extraction

已完成：

- `createReaderRuntime(container, options)` / `ReaderRuntimeSession` 形式的 host contract。
- core reader hot path 移除 Pinia/editor shell direct import。
- source / asset / font loading 进入 host policy。
- reader-only entry 迁入 `packages/reader-runtime-web/`。
- `pnpm reader:build` 输出 `dist/reader-runtime/`。
- Android bridge 使用 v1 envelope，真实 `loadScript` payload 支持 `source/sourceUrl/assetManifest/settings`。
- Android Reader 可通过 Gradle 同步 `dist/reader-runtime/` 到 APK assets，并以本地 HTTPS 虚拟域名加载真实 bundle。

仍然不是 Phase R 目标：

- 不发布纯 `@kmd/core`。
- 不引入 Phase B 新语法。
- 不把 parser/layout/effect 重写到 Kotlin。

执行记录与后续 gate 见 `phase-r-reader-runtime-web.md`。

### Current: Integration Stabilization And Phase B Readiness

当前短线：

- Android 真机/模拟器 WebView smoke 与课程集成测试补实。
- `reader-runtime-web` artifact 路径、fallback shell、debug probe 和 renderer recovery 持续稳定。
- 保持 `packages/reader-runtime-web` 禁止导入 Vue、Pinia、Monaco、TextMate、editor panels。
- 收敛 `docs/knowledge/language/design.md` 与 `docs/knowledge/language/brainstorm.md` 中的 Phase B 语法设计。
- 更新文档状态，避免旧的 “Phase R current” 文案继续误导排期。

### Gated Next: Phase B — Language / State / Control Flow / Segment Graph

Phase B 保留为下一轮语言与 execution graph 阶段。它包括：

- `+` 并发链、续行、文本插值
- `StateStore`、表达式、响应式绑定
- `@ if / @ loop / @ tag / @ jump / @ wait`
- `SegmentGraphPlan` 与 graph playback
- namespace provider 与 command family 正式化

进入条件：

- reader-runtime-web package boundary 保持稳定，不因 Phase B 回流 editor-only imports。
- Android WebView smoke 与 reader artifact 消费链路足够稳定。
- Phase B 语言设计文档完成一次收敛审查。
- Phase B 新语法优先进入 DocumentAST / DocumentSemanticIR，不直接塞回 legacy token/layout stream。

### Future: Phase C And v1.7+

Phase C：

- SignalRegistry
- game-like segment runtime
- non-deterministic / interactive segment backend
- in-flight animation continuation

v1.7+：

- plugin API
- sugar registry
- LSP / VS Code preview
- theme and grammar contribution pipeline

## 维护规则

- `docs/planning/roadmap` 放阶段路线。
- `docs/planning/packages` 放生态包计划。
- `docs/planning/apps` 放生态应用计划。
- `docs/knowledge/language` 放仍在探索的语言设计。
- `docs/planning/TODO.md` 可保留详细任务池，但阶段优先级以本目录为准。
