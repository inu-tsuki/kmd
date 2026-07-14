# KMD Implementation Roadmap

> 文档状态：Active
> 最近更新：2026-07-14
> 权威范围：KMD 当前主线判断与阶段顺序——已完成阶段、当前焦点、gated 下一阶段（Phase B 恢复条件）

## 当前判断

KMD 1.6 Phase A 与 Phase B Prep 已完成 parser、layout、execution、stage、diagnostics 和 metadata 的主链路准备。继续推进 Phase B 前曾发现语言设计本身需要更完整的重构；**2026-07-08 语言设计收敛已完成**：主谓模型、选择器、连接符/拍、从句、作用域、控制流等以封盘决议 D1–D27 记入 `docs/knowledge/language/design.md` 及分章（总-分结构），旧→新形态对照与解析器工程债见 `docs/knowledge/language/migration.md`。

同时，Android Reader 需要一个可复用、无 Pinia、无 editor shell 耦合的 WebView runtime。因此曾在 Phase B 前插入 Phase R。Phase R 的 R0-R7 已完成：`@kmd/reader-runtime-web` 已作为 workspace package 接管 reader-only bundle 构建。

当前路线调整为：

> Phase R 已完成包边界建立；Phase B 语言设计收敛审查与 Android artifact/WebView 集成验证均已完成。Phase B 不再等待 Android，可在主仓库排期允许时按 `phase-b/1.6-phase-b-plan.md` 从 B0.1 新链解析器恢复实施。

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

### Ready: Phase B, Android Integration Frozen

集成收束结论：

- Android 真机/模拟器 WebView smoke 与 reader artifact 消费链路已补实：真实 bundle 打进 APK、本地 HTTPS 虚拟域名加载、`runtimeReady → loadScript → ready → play → progress → ended` 已闭合；R3-K1 设备测试 8/8。Android 课程至 R3 阶段于 2026-07-14 封存，后续以独立仓库 `r3-final` Release 为恢复基线。
- Android Reader 进入维护休眠，不再作为 Phase B、runtime 重构或 community-api 的入口 gate。ready/ended 呈现、companion 手感与 renderer 压力完善进入 Android Post-R3 backlog，恢复时重新核实。
- `reader-runtime-web` artifact 路径、fallback shell、debug probe 和 renderer recovery 持续稳定。
- 保持 `packages/reader-runtime-web` 禁止导入 Vue、Pinia、Monaco、TextMate、editor panels。
- ~~收敛 `docs/knowledge/language/design.md` 与 `docs/knowledge/language/brainstorm.md` 中的 Phase B 语法设计。~~
  已完成（2026-07-08）：`knowledge/language/` 重组为总-分结构（design.md 总纲 + chain/selection/scope/control-flow/migration 分章），封盘决议 D1–D27。
- 更新文档状态，避免旧的 “Phase R current” 文案继续误导排期。

### Next When Scheduled: Phase B — Language / State / Control Flow / Segment Graph

Phase B 保留为下一轮语言与 execution graph 阶段。按封盘规范（D1–D27）重述，它包括：

- 新链语法：主语作用域链、`{}`/`{文本}` 选择器、连接符与拍、从句、实例化粒度、量词字面量
- 宏/对象、`$()` 取值展开、`:::` 围栏选区、`+` 并联句子、续行
- 两级作用域（文档级 `var` / 场景级）与 `StateStore`、表达式、`{=}` 文本插值、选项级联
- 三高度控制流：行内 `{=cond ? A | B}`、`[if]`、`[if -> #标签]`（`#` 锚点即跳转目标）
- `SegmentGraphPlan` 与 graph playback（loop/wait 表面语法未封盘，运行时形态先行）

工作包拆分与顺序见 `phase-b/1.6-phase-b-plan.md`（2026-07-08 按收敛结论重写）。

进入条件：

- reader-runtime-web package boundary 保持稳定，不因 Phase B 回流 editor-only imports。
- ~~Android WebView smoke 与 reader artifact 消费链路足够稳定。~~ 已满足并冻结（2026-07-14）。
- ~~Phase B 语言设计文档完成一次收敛审查。~~ 已满足（2026-07-08）。
- Phase B 新语法优先进入 DocumentAST / DocumentSemanticIR，不直接塞回 legacy token/layout stream。

### After Phase B: Runtime Host Semantics Consolidation

Phase B 完成新语法、execution plan、`SegmentGraphPlan` 与 graph playback ownership 后，集中
收束宿主可观察的 runtime 语义：

- reader runtime settings transaction：projection rebuild 不泄漏内部 `progress=0`、
  空 markers、`idle` 或重复 `ready`。
- 按 INV-9 固化 host preference / author composition 的 mode capability matrix。
- 实现 `reducedMotion` 的统一 execution/effect 策略，覆盖自然播放、seek/replay 与 graph path。
- 用 reader artifact 浏览器 smoke 和 Android bridge 集成验证最终协议语义。

这项工作刻意晚于 Phase B：不在 legacy `ScriptPlayer` 上固化即将被 graph runtime 改写的
事务边界；也必须早于 Phase C 的非确定性交互 runtime，否则 host settings 会再次扩散到更多
执行后端。详细工作包见
[`../packages/reader-runtime-web.md`](../packages/reader-runtime-web.md)。

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
