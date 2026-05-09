# KMD — Implementation Roadmap

## 1. 韵律标准与排版进化 (v1.1.0) — DONE

- [x] MD 语法解糖、Baseline V2、相对字距。

## 2. Monaco 编辑器与智能增强 (v1.1.5) — DONE

- [x] Monarch 高亮、IntelliSense 补全、实时错误诊断。

## 3. 生产力工具集 (v1.2.0 - v1.3.0) — DONE

- [x] Pinia 状态抽离、WindowFrame 容器、标签页系统。

## 4. 自由布局引擎 (v1.4.0 - Docking System) — DONE

- [x] 递归 `LayoutTree`、拖拽停靠 (DnD)、原子布局重构。

## 5. 深度联调与同步 (v1.5.0 - Front Matter Sync) — DONE

- [x] 双向同步引擎、科技感 Inspector、布局审计系统。

## 6. 时间之主 (v1.6.0 - Segment Graph & Timeline Engine) — Current

### Phase A — Timeline 化（线性脚本精确跳转）— DONE

- [x] **A1. Triple-Track Classification**: `EffectMetadata.track` 四轨分类，28 presets + 18 styles 审计。
- [x] **A2. TextPlayer Timeline 化**: `buildTimeline()` 替代旧 `play()`，字符入场/时序糖衣/组特效链/Behavior 收集。
- [x] **A3. Stage Timeline 化**: stagePresets 始终返回 Tween，cam.reset → timeline，移除 killTweensOf。
- [x] **A4. Segment 数据结构**: `Segment`, `ParagraphUnit`, `Checkpoint` 接口。
- [x] **A5. ScriptPlayer 重构**: `buildSegment()`, `playSegment()`, `seekToTime()`, Behavior 注册。
- [x] **A6. Cross-Paragraph Animation Foundation**:
  - [x] `buildMode` flag + `overwrite:false` / `immediateRender:false` in stagePresets。
  - [x] `InFlightAnimation` tracking in buildSegment()。
  - [x] `cam.offset` additive camera layer (3-layer composition)。
  - [x] Stage tween trim-on-conflict (`trimActiveStageTween()`)。
- [x] **A7. Three-Tier Layout System**:
  - [x] Visual Displacement (`offset/up/down/left/right`) → `pushDisplayOffset`/`popDisplayOffset` (per-token scope)。
  - [x] Visual Teleport (`goto`) → `isFlowBroken` (unchanged)。
  - [x] Flow Control (`flow`) → moves cursor + syncs `baselineY` (NEW)。
  - [x] Dual-path routing: per-token via expander (visual), block-level via operator (cursor)。
  - [x] Forward-reference fix: phantom pass `writtenKeys` tracking for reliable marker sync。
- [x] **A8. Phase A Cleanup**:
  - [x] 6 parser/layout bugs (comment crash, phantom paragraph, bare @, sugar height, markEnd/self width, empty-body cmd line)。
  - [x] 23 TS build errors → 0。
  - [x] Semantic refactors: wait → hold/pause, Monaco `---` highlighting, dynamic file discovery。

### Phase A.R — Refactor Foundation（为 Phase B/C 铺路）— DONE

> 实施方案见 `docs/refactor/phase-1-implementation-plan.md`
> 目标：先建立共享契约、parser 边界、layout preflight 与 execution adapter seam，再进入 Phase B 的 graph/state/control-flow 扩展。

- [x] **AR1. Shared Types Foundation**
  - [x] 建立 `src/core/types/` 共享契约入口
  - [x] 定义 `BaseCue`, `AnchorRef`, `ChainExecutionPlan`, `LayoutPreflightResult`, `DiagnosticEvent`
- [x] **AR2. Parser Boundary Extraction**
  - [x] 从 `lowering.ts` 中抽出 `ScopeRouter`
  - [x] 隔离 `CompatProjector`
  - [x] 让 parser 面向 `CommandRegistryView`
- [x] **AR3. Layout Preflight Formalization**
  - [x] 将 phantom pass 升级为正式的 `LayoutPreflightResult`
  - [x] 显式化 `AnchorState` / `LinePlan` / `estimatedBounds`
  - [x] 在不强拆 `LayoutStreamBuilder` 的前提下收缩双 pass 重复逻辑
- [x] **AR4. Execution Adapter Seed**
  - [x] 引入 `ParagraphExecutionPlan` / `ChainExecutionPlan` 适配层
  - [x] 让 `TextPlayer` 开始消费 plan-like input
  - [x] 将段落 placement 先收口到 `SegmentBuilder` 内部，而不是提前独立 coordinator
- [x] **AR5. Validation Gates**
  - [x] `pnpm test:parser`
  - [x] `pnpm build`
  - [x] 关键样例脚本回归检查（parser/layout/timeline）

### Phase A.E — Execution Consolidation（TextPlayer / ScriptPlayer 收口）— DONE

> 实施方案见 `docs/refactor/phase-2-implementation-plan.md`
> 目标：在不提前进入 Phase B graph/state/control-flow 的前提下，继续收口 execution 主链路，完成 `TextPlayer` planner 深化与 `ScriptPlayer` 的 `SegmentBuilder / PlaybackController` 拆分。

- [x] **AE1. TextPlayer Planner Deepening**
  - [x] 将稳定的 chain mode / lifecycle 语义前移到 plan 阶段
  - [x] 为 `char_stagger` 缺 plan 场景增加 fallback diagnostics
  - [x] 降低 `buildTimeline()` 对命令名热路径特判的依赖
- [x] **AE2. ParagraphExecutionPlan Enrichment**
  - [x] 补强 `ParagraphExecutionPlan` / `ChainExecutionPlan` 的执行契约
  - [x] 显式区分 authored cue、lowered cue、generated lifecycle cue
  - [x] 让 `TextPlayer` 通过 plan 稳定读取 token/stage/playback 绑定
- [x] **AE3. SegmentBuilder Extraction**
  - [x] 从 `ScriptPlayer.buildSegment()` 中提取 `SegmentBuilder`
  - [x] 将 paragraph placement 先收口为 `SegmentBuilder` 内部方法
  - [x] 保持段落 build / timeline attach / marker/checkpoint 收集的现有行为
- [x] **AE4. PlaybackController Extraction**
  - [x] 从 `ScriptPlayer` 中提取 seek / replay / behavior re-register / style replay 控制逻辑
  - [x] 保持 `Segment` 结构和现有 player façade 兼容
- [x] **AE5. Validation and Guard Rails**
  - [x] `pnpm build`
  - [x] `pnpm test:parser`
  - [x] 关键样例脚本回归检查（parser/layout/timeline/seek）

### Phase A.S — Stage Host Split Preparation（StageManager 分层准备）— DONE

> 实施方案见 `docs/refactor/phase-3-implementation-plan.md`
> 目标：围绕 `StageManager` 建立 `StageRuntime / ReaderHost / PresentationManager / RuntimeValueResolver / Stage diagnostics` 的稳定边界，为真实拆分和 Phase B 接入做准备。

- [x] **AS1. Stage Role Decomposition**
  - [x] 正式命名 `StageRuntime / ReaderHost / PresentationManager / RuntimeValueResolver / StageAuditPort`
  - [x] 建立最小的 adapter seam，不要求一次搬空 `StageManager.ts`
- [x] **AS2. ReaderHost / Presentation Policy Seam**
  - [x] 将 host 挂载与 mode/resize/viewport 规则从 stage cue 执行面中分离
  - [x] 固定 `stage` / `scroll` / `page` 模式下的边界职责
- [x] **AS3. RuntimeValueResolver Extraction**
  - [x] 抽离 `resolveValue()` 共享接缝
  - [x] 第一轮只覆盖 number / marker / `var.*` / fallback
  - [x] `EffectProcessor.resolveParams()` 已接入同一 resolver；effect 参数现可解析 marker 坐标与 `var.*`
- [x] **AS4. Stage Diagnostics / Audit Seed**
  - [x] 建立 `StageConflictDiagnostics` 的最小落点
  - [x] 建立 stage 侧 `AuditEvent` / collector 接口
- [x] **AS5. `scene.clear` Migration Prep**
  - [x] 固定 `---` -> `scene.clear` 的内部迁移目标
  - [x] 为注册式 stage cue 承接预留路径
  - [x] 保留 `SegmentBuilder` 兼容外壳，并明确与 `stagePresets["scene.clear"]` 的同步迁移关系

### Phase A.T — Stage Runtime Extraction（StageRuntime 真拆）— DONE

> 实施方案见 `docs/refactor/phase-4-implementation-plan.md`
> 目标：在 Phase A.S 已建立的接缝上，真正切出 `StageRuntime`，收掉 `scene.clear` 的兼容双路径，并让 `StageManager` 收缩为 façade / composition root。

- [x] **AT1. StageRuntime Extraction**
  - [x] 从 `StageManager` 中切出 `camera / cameraOffset / buildMode / registry / apply / modifiers`
  - [x] 保持对外 API 兼容，不要求一次改名所有调用点
- [x] **AT2. `scene.clear` Single-Path Runtime Migration**
  - [x] 让 `scene.clear` 成为唯一 runtime clear 行为路径
  - [x] 将 `SegmentBuilder` 中基于 `isSceneClear` 的旧显隐逻辑降级为 parser discriminant / timeline marker 用途
- [x] **AT3. StageManager Façade Cleanup**
  - [x] 让 `StageManager` 主要保留 host / presentation / audit / compat façade 职责
  - [x] 明显收缩其运行时执行面
- [x] **AT4. ReaderHost Lifecycle Seam**
  - [x] 为 host 绑定补齐最小 detach / dispose 契约
- [x] **AT5. Validation and Guard Rails**
  - [x] `pnpm build`
  - [x] `pnpm test:parser`
  - [x] 关键样例脚本回归检查（stage clear / page mode / seek）

### Phase A.U — Layout Mainline Unification（单一语义源 / Builder 三角拆分起手）— DONE

> 实施方案见 `docs/refactor/phase-5-implementation-plan.md`
> 目标：收掉 paragraph build 主链路里的双语义源，让 `LayoutStreamBuilder -> TextLayoutEngine -> TextBuilder` 这一段逐步变成 parser-side paragraph input 驱动的正式角色链，为 Phase B 建立稳定的 paragraph build boundary。

- [x] **AU1. Paragraph Single-Source Build Path**
  - [x] 引入 `ParagraphBuildInput` / compat loader，让 `SegmentBuilder` 主路径不再依赖 `KineticText.init(rawText)` 二次 parse
  - [x] 保留 editor / preview 所需的 source-driven compat path
- [x] **AU2. LayoutPlanner Extraction**
  - [x] 从 `LayoutStreamBuilder` 中抽出测量、initial style preview、指令展开、stage lane 收集
  - [x] 让 planner 输出 typed item/glyph plan，而不是直接创建 `KineticChar`
- [x] **AU3. DisplayAssembler / CompatBinder Split**
  - [x] 将 `KineticChar` / `TokenWrapper` 物化从 planner 中移出
  - [x] 收口 pending effects / timing sugars / stage instruction 绑定的兼容写回
- [x] **AU4. Paragraph Build Boundary Cleanup**
  - [x] 将 `TextBuilder` 从 parser 与 UI store 的直接依赖中收缩为 build-context 驱动
  - [x] 逐步解除 `TextLayoutEngine` 对 `KineticText.FullOptions` 的 host 类型依赖
- [x] **AU5. Validation and Guard Rails**
  - [x] `pnpm build`
  - [x] `pnpm test:parser`
  - [x] 关键样例脚本回归检查（scene.clear / page / seek / paragraph build parity）

### Phase A.V — Diagnostics / Host Tightening（审计总线、Stage façade、legacy 收口）— DONE

> 实施方案见 `docs/refactor/phase-6-implementation-plan.md`
> 目标：统一 diagnostics / audit 总线，继续瘦身 `StageManager`，并拆掉 layout / execution 中残余的单体逻辑与旧导出路径，为 Phase B 提供更干净的 runtime surface。

- [x] **AV1. Unified DiagnosticsCollector / AuditBus**
  - [x] 建立 build-scope collector 与 runtime-scope bus
  - [x] 接入 parser / layout / execution / stage 的 diagnostics 与 audit 适配层
- [x] **AV2. StageManager Round 2 Slimming**
  - [x] 抽出 host session / resize / world transform 绑定
  - [x] 收紧 `camAuditLog` / `dumpCamReport()` 等 compat 出口
- [x] **AV3. Layout Diagnostics and Pass Tightening**
  - [x] 让 preflight / final placement 共享 pass runner 骨架
  - [x] 将 `LayoutEngine.dumpReport()` 降级为 compat wrapper，导出改走统一 bus
- [x] **AV4. Execution Monolith Split and Legacy Tightening**
  - [x] 从 `TextPlayer` 拆出 diagnostics sink / timing cursor / stage cue scheduler
  - [x] 从 `ScriptPlayer` 收口 source loader / build report / diagnostics 汇聚
- [x] **AV5. Validation and Guard Rails**
  - [x] `pnpm build`
  - [x] `pnpm test:parser`
  - [x] 关键样例脚本回归检查（scene.clear / page / seek / resize / diagnostics parity）
- [x] **AV6. Execution Payload Decoupling**
  - [x] 为 paragraph build 主链路建立独立 execution payload，不再让 plan 反读 `KineticChar` 语义字段
  - [x] 让 `SegmentBuilder` / `createParagraphExecutionPlan()` / `TextPlayer.buildTimeline()` 主路径消费 payload
  - [x] 将 `KineticChar.stageInstructions / visualEffects / timingSugars` 降级为 legacy compat surface
- [x] **AV7. Layout Middleware Seed**
  - [x] 从 `TextLayoutEngine` 继续抽出 `LineAccumulator / AnchorCoordinator / LayoutAuditEmitter`
  - [x] 收紧 preflight/final 共享逻辑中的 reserved marker 与 line-break 状态更新
- [x] **AV8. Display Host / Runtime Entity Split Prep**
  - [x] 让 display host 与 runtime execution entity 通过显式 assembly 结构连接，而不是共享 `KineticChar` 可变字段
  - [x] 为 legacy `play()/bakeTimeline()/skipToEnd()` 留下兼容层，但停止让新主路径继续依赖它们

### Phase B Prep — Metadata / Host Boundary Readiness（Phase B 前置准备）— DONE

> 实施方案见 `docs/refactor/phase-b-prep-refactor-plan.md`
> 目标：在进入 state / control-flow / segment graph 前，补齐 effect、layout、stage、parser 的元信息入口和 host 边界，避免 Phase B 功能落到旧的隐式语义上。

- [x] **BP0. Scope and Guard Rails**
  - [x] 固定本阶段不实现用户可见 Phase B 语法
  - [x] 明确 `pnpm build`、`pnpm test:parser`、关键样例人工回归 gate
- [x] **BP1. Effect Metadata and Processor Slimming Prep**
  - [x] 为 effect/style/stage/layout 分类结果补稳定 typed classification
  - [x] 将 style preview helper、default-level、chain-hint 作为 middleware metadata seed
- [x] **BP2. Layout Command Metadata**
  - [x] 定义 `LayoutCommandMetadata`
  - [x] 标记 layout command family、operator/expander phase、marker 写入与 flow/display 影响
- [x] **BP3. Anchor and Layout Item Type Tightening**
  - [x] 收紧 layout stream text item 类型，减少 `(item as any).charData`
  - [x] 为 reserved anchor 名称补最小结构化类型
- [x] **BP4. LayoutEngine Host Boundary Prep**
  - [x] 抽出 scroll/reflow 所需 host view 接口
  - [x] 收口 `readerApp` 直连，保持 `layout` singleton 兼容
- [x] **BP5. Stage Preset Metadata**
  - [x] 定义 `StageCommandMetadata`
  - [x] 标记 camera property key、blocking、modifier-based、scene lifecycle cue
- [x] **BP6. Parser Frontend B0 Readiness**
  - [x] 明确 `+` 并发链、续行符、`{var.xxx}` 插值的 syntax-only AST 形状
  - [x] 预留 line-head control-flow node 类型，不执行 runtime lowering

### Phase B — Segment Graph、状态系统与语法演进

> **核心理念**: Segment 内部仍为预烘焙 Timeline（确定性、可 seek），Segment 之间的边为运行时求值（条件分支、状态驱动）。
> 控制流语法独立于特效链，使用行首 `@` 结构标记。状态层嵌入极简表达式求值器。
> 默认建立在 **Phase A.R Refactor Foundation**、**Phase A.E Execution Consolidation**、**Phase A.S Stage Host Split Preparation**、**Phase A.T Stage Runtime Extraction**、**Phase A.U Layout Mainline Unification** 与 **Phase A.V Diagnostics / Host Tightening** 完成的基础上推进；建议在 **Phase B Prep** 收口 metadata / host boundary 后正式启动。

#### B0. 语法统一与增强

> **命名规则**:
>
> - **点命名空间** (`cam.*`, `state.*`, `var.*`): 独立指令行的命令/引用，不深入特效链
> - **裸词** (`goto`, `flow`, `markStart`, `shake`, `hold`): 高频原子操作，可嵌入特效链
> - **冒号** (`hold:char`, `pause:char`): 层级修饰符
> - **行首 `@`** (`@ if`, `@ loop`, `@ set`): 控制流结构标记

- [ ] **B0.1 并发特效链 `+`**:
  - 语法: `{text} @ f.red.hold(1s).wave + markEnd(p1) + f.shake`
  - `+` 分隔同一 token 上的多条独立特效链
  - 实现: `KMDCommandParser` 按 `+` 分割后独立解析每段，合并到 token.effects
- [ ] **B0.2 续行符 `\`**:
  - 语法: 行尾 `\` 表示下一行与本行逻辑相连
  - 实现: `KMDScanner.scan()` 预处理阶段拼接续行
  - 用途: 管理复杂的多链特效内容，提升可读性
- [ ] **B0.3 文本插值 `{var.xxx}`**:
  - 在正文中引用变量值: `你有 {var.gold} 枚金币`
  - 实现: `KMDScanner` 识别非 `@` 后的 `{var.*}` 为插值 token

#### B1. 状态层 (StateStore + 表达式)

- [ ] **B1.1 StateStore 单例**:
  - `StateStore { get, set, snapshot, restore }` — `Map<string, number | boolean | string>`
  - 挂载为全局单例，与 `layout.globalMarkers` 中的 `var.*` 统一
  - `Checkpoint.state` 增加状态快照字段
- [ ] **B1.2 表达式求值器**:
  - Pratt parser (~150 行)，支持:
    - 字面量: `42`, `3.14`, `true`, `false`, `"hello"`
    - 变量: 裸名直接查 StateStore (表达式上下文无需 `var.` 前缀)
    - 算术: `+ - * / %`
    - 比较: `> < >= <= == !=`
    - 逻辑: `and or not`
  - **不支持**: 函数调用、数组、对象、三元运算
- [ ] **B1.3 `@ set` 赋值语法**:
  - `@ set gold = gold + 5` — 等号右侧为表达式
  - 实现: Parser 识别 `@ set` → 提取变量名和表达式 → 生成 state mutation 指令
  - 内联形式: `文本 @ state.set(gold, gold + 5)` — 作为 stage command 在 Timeline 时间点执行

#### B2. 控制流语法

> 控制流使用行首 `@` 结构标记。Parser 在分段时识别这些标记，切割 Segment 边界。

- [ ] **B2.1 条件分支**:

  ```kmd
  @ if gold >= 100
    你很富有。
  @ elif gold > 0
    还行。
  @ else
    身无分文。
  @ end
  ```

  - 条件部分使用表达式求值器 (B1.2)
  - 每个分支 arm 独立烘焙为 Segment
  - `SegmentEdge.condition` 为运行时求值函数

- [ ] **B2.2 循环**:

  ```kmd
  @ loop 3
    重复三次。
  @ end

  @ while gold > 0
    花掉一枚。 @ state.set(gold, gold - 1)
  @ end
  ```

  - `@ loop N`: 编译时展开 (N 已知) 或运行时计数 (N 为表达式)
  - `@ while expr`: 循环体烘焙一次为 Segment，迭代结束时检查条件决定重入或继续

- [ ] **B2.3 标签与跳转**:

  ```kmd
  @ tag chapter_2
  ...
  @ jump chapter_2
  ```

  - `@ tag(name)`: 命名 Segment 入口点
  - `@ jump(name)`: 无条件跳转到目标 tag 的 Segment
  - 进度条上 jump 目标显示为标记点

- [ ] **B2.4 等待**:

  ```kmd
  @ wait click
  @ wait signal doorOpened
  ```

  - 等待点切割 Segment，前段 exitCheckpoint 含暂停状态
  - Phase C 扩展为完整 SignalRegistry

#### B3. Segment Graph 数据结构

- [ ] **B3.1 SegmentGraph 类**: `nodes: Segment[]`, `edges: SegmentEdge[]`
- [ ] **B3.2 SegmentEdge**: `{ from, to, condition?: (state) => boolean, isDefault? }`
- [ ] **B3.3 Default path**: 所有 `isDefault=true` 边构成的链，用于进度条 seek

#### B4. Segment Graph 烘焙与跳转

- [ ] **B4.1 烘焙**: Parser 输出的控制流标记 → 切割段落组 → 每组独立 `buildSegment()`
- [ ] **B4.2 同 Segment 内 seek**: `timeline.seek(localTime)` (不变)
- [ ] **B4.3 跨 Segment seek (同路径)**: 恢复目标 `entryCheckpoint` (含 state) + `timeline.seek()`
- [ ] **B4.4 条件分支 seek**: 沿 default path 跳转 (近似)
- [ ] **B4.5 循环 seek**: 恢复循环入口 Checkpoint → warp-replay
- [ ] **B4.6 State 重放**: seek 时从 entryCheckpoint.state 恢复，沿路径重放 `@ set` 到目标时间

### Phase C — 交互式运行时

- [ ] **C1. SignalRegistry**: 异步事件状态跟踪，纳入 Checkpoint。`@ wait signal` 的完整运行时。
- [ ] **C2. 游戏化 Segment**: 无预烘焙 Timeline 的 Segment，Behavior Layer 驱动，实时玩家输入。
- [ ] **C3. Carry-over Anims**: 非确定性边界的进行中动画延续。消费 `InFlightAnimation` 数据。

### IDE Integration

- [ ] **Hot Replay**: Monaco "从此处播放" + segment seek。
- [ ] **Monaco 视觉增强**: Segment 边界标记、Minimap 增强、控制流折叠。
- [ ] **Inspector v2**: 指令元数据 + 实时调参 → 自动改写 KMD 源码。
- [ ] **VS Code 颜色主题加载**:
  - Monaco 与 VS Code `tokenColors` 格式完全兼容（已用 TM grammar），任何 `.json` 主题文件可直接传入 `defineTheme`
  - IDE Shell 变量映射：从主题 `colors` 对象提取 ~10 个键注入 CSS 变量
    ```
    editor.background       → --bg-editor
    sideBar.background      → --bg-sidebar
    titleBar.activeBackground → --bg-header
    editor.foreground       → --text-main
    statusBar.background    → status bar color
    activityBar.background  → --accent-secondary
    ...
    ```
  - 加载来源：项目文件夹中的 `theme.json` 或 `project.yaml` 中 `editorTheme:` 字段
  - 效果：Dracula、One Dark、Catppuccin 等主流 VS Code 主题开箱即用

## 7. 插件化生态 (v1.7.0 - Plugin Architecture)

> **核心理念**: 从内建注册表到开放插件接口，逐层递进。四大 Manager 已具备 `registerBatch` 能力，需要标准化插件契约、开放语法糖注册、建立管线钩子。

### P1. 插件接口标准化

- [ ] **P1.1 `KMDPlugin` 类型定义**:

  ```typescript
  interface KMDPlugin {
    name: string;
    version?: string;
    install(ctx: KMDPluginContext): void;
  }
  interface KMDPluginContext {
    effects: EffectManager;
    styles: StyleManager;
    layout: LayoutManager;
    stage: StageManager;
  }
  ```

  - 统一四大 Manager 的注册入口为 `KMDPluginContext`
  - `definePlugin()` 辅助函数提供类型安全 + 自动推断

- [ ] **P1.2 插件加载器**:
  - `pluginManager.use(plugin)` — 同步安装，按依赖顺序执行
  - 内建预设重构为 "core plugin"，通过 `use()` 加载而非构造函数硬编码
  - 冲突检测：同名注册警告，可配置 override 策略
- [ ] **P1.3 `MODIFIER_BASED_COMMANDS` 元数据化**:
  - 从硬编码 `Set` 改为 `StageEffectMeta.tweenMode: "tween" | "modifier"`
  - ScriptPlayer 读取 meta 决定 `captureTween` vs `tl.call()`
  - 新增舞台指令时无需手动维护 Set

### P2. 语法糖注册表化

- [ ] **P2.1 SugarRegistry 设计**:

  ```typescript
  scanner.registerSugar({
    trigger: "~", // 触发字符（串）
    mode: "inline", // inline | prefix | wrapper
    emit: { name: "slow", params: { 0: 2.0 } },
    level: "char",
  });
  ```

  - `inline`: 正文中的单字符触发 (`>`, `~`, `^`)
  - `prefix`: 行首触发 (`# `)
  - `wrapper`: 成对包裹 (`**...**`, `*...*`)

- [ ] **P2.2 Scanner 重构**:
  - 将 `scanLineBody()` 中硬编码的 `if (char === ...)` 分支改为遍历注册表
  - 匹配策略：最长前缀匹配（Trie 或排序数组）
  - 内建语法糖作为默认注册项，可被插件覆盖或扩展
- [ ] **P2.3 Markdown 语法糖可配置化**:
  - `**bold**`, `*italic*`, `# heading` 的行为（注入的 effects/sugars）可通过插件替换
  - 例：插件可将 `**...**` 改为注入 `neon` 而非 `bold`

### P3. 管线钩子系统 (Hook API)

- [ ] **P3.1 Hook 点定义**:

  ```typescript
  interface KMDHooks {
    afterParse: (paragraphs: KMDParagraphData[]) => void;
    beforeLayout: (stream: LayoutStream) => LayoutStream;
    onCharReveal: (char: KineticChar, time: number) => void;
    onSegmentChange: (from: Segment, to: Segment) => void;
    onTick: (time: number, chars: KineticChar[]) => void;
  }
  ```

  - 各 Hook 点定义清晰的输入/输出契约
  - 支持多插件注册同一 Hook（链式调用，按优先级排序）

- [ ] **P3.2 Hook 注入到管线**:
  - Parser → `afterParse`
  - LayoutStreamBuilder → `beforeLayout`
  - TextPlayer.placeCharOnTimeline → `onCharReveal`
  - ScriptPlayer → `onSegmentChange`, `onTick`
- [ ] **P3.3 安全沙箱**:
  - Hook 执行超时保护（防止死循环阻塞渲染）
  - Hook 异常隔离（单个 Hook 报错不影响其余管线）

### P5. 主题系统插件化

> **核心前提**：Monaco 已使用 TM grammar，与 VS Code `tokenColors` 完全兼容。
> 主题分两层：语法着色层（Monaco `tokenColors`）+ IDE 外壳层（CSS variables）。

- [ ] **P5.1 提取默认主题为独立文件**:
  - 将 `kmd-lang.ts` 中的 `defineTheme rules` 迁移为 VS Code 兼容格式
  - 输出为 `themes/kmd-dark.theme.json`（`tokenColors` 数组 + `colors` 对象）
  - 加载路径：`GrammarService` 或独立 `ThemeService` 负责 `monaco.editor.defineTheme()`

- [ ] **P5.2 VS Code 颜色主题直接加载**:
  - `ThemeService.load(themeJson)` — 接受标准 VS Code `IVsCodeTheme` 格式
  - 自动提取 `colors` → CSS variables（映射表约 15 个键）
  - 自动传递 `tokenColors` → Monaco `defineTheme`
  - 在 `project.yaml` 中声明：`editorTheme: ./themes/dracula.json`

- [ ] **P5.3 GrammarService — 语法插件化（方案 B）**:
  - 插件可通过 `SyntaxContribution` 贡献新 TM pattern（repository 条目 + bodyIncludes）
  - `GrammarService.rebuild()` 合并所有插件贡献 → 重新调用 `loadGrammar()` → 热更新 Monaco tokenizer
  - VS Code 扩展端：`pnpm emit-grammar` 构建步骤将运行时 grammar 写出为静态 `kmd.tmLanguage.json`
  - 长期：VS Code 扩展作为 LSP client，连接运行中的 KMD 服务获取插件贡献的 semantic tokens

### P4. 声明式插件包

- [ ] **P4.1 `.kmd-plugin` 清单格式**:
  ```yaml
  name: sparkle-pack
  version: 1.0
  effects:
    - name: sparkle
      type: behavior
      script: ./sparkle.js
  sugars:
    - trigger: "✨"
      mode: inline
      emit: { name: "sparkle" }
  ```
- [ ] **P4.2 运行时 `import()` 加载器**: 按清单动态加载脚本模块
- [ ] **P4.3 插件市场 UI**: IDE 内嵌插件浏览/安装/管理面板

## 8. kmd-vscode 编辑器集成 (v1.7–v1.8)

> **定位**：VS Code 扩展不复刻 Web IDE，只做 VS Code 原生没有的两件事——语言智能（LSP）和预览画布（Webview）。
> 文件系统是两端唯一的桥：VS Code 编辑 → 保存磁盘 → Web IDE 文件变更检测 → 重载。不需要 WebSocket 实时同步。

### V1. LSP 语言服务器（与 v1.7 插件化同步推进）

> 将 Web IDE 中 Monaco 的补全/验证逻辑提炼为独立 LSP server，
> 服务 VS Code、Neovim、Emacs 等任何 LSP 客户端。
> P1 插件接口完成后，补全列表自动具备插件感知能力。

- [ ] **V1.1 提取 `packages/kmd-language-server/`**:
  - 复用现有 `KMDParser` + `parser.validate()` — 零重写
  - 标准 LSP server 入口（`vscode-languageserver` npm 包）
  - `extensions/vscode-kmd/client.ts` 作为轻量 LSP client 包装
- [ ] **V1.2 Diagnostics（错误波浪线）**:
  - `parser.validate(text)` → `publishDiagnostics`
  - 替代目前 Monaco 里手写的 `setModelMarkers` 逻辑
- [ ] **V1.3 Completion（智能补全）**:
  - 复用 `kmd-lang.ts` 里的补全逻辑，迁移到 LSP `onCompletion`
  - 补全来源：`effectManager` / `styleManager` / `stageManager` / `layoutManager` 注册表
  - v1.7 P1 完成后：补全列表自动包含所有已安装插件贡献的指令
- [ ] **V1.4 Hover 文档**:
  - 悬停在 effect/layout/stage 名称上显示简短说明
  - 来源：`EffectMeta.description`（为 meta 增加可选 description 字段）
- [ ] **V1.5 Semantic Tokens（动态高亮）**:
  - LSP semantic tokens 覆盖 tmLanguage 无法表达的动态部分
  - v1.7 P5.3 GrammarService 完成后：插件贡献的语法通过 semantic tokens 显示

### V2. Webview 预览面板（v1.8.0）

> 渲染引擎稳定后，打包为独立 bundle，嵌入 VS Code Webview。

- [ ] **V2.1 渲染引擎独立打包**:
  - 将 Pixi.js + GSAP + KMD 运行时抽取为 `packages/kmd-runtime/`
  - 同时服务 Web IDE 和 Webview，不重复打包
- [ ] **V2.2 `KMD: Open Preview` 命令**:
  - 侧边 Webview 面板，内嵌完整 Pixi.js 画布
  - VS Code `postMessage` 同步编辑器文本 → 实时预览（无需文件保存）
  - 布局：编辑器左 + 预览右（类 Markdown Preview）
- [ ] **V2.3 基础播放控制**:
  - Webview 内嵌简化版时间轴：▶ ⏸ ⏹ + 进度条 + 时间显示
  - 不需要 Dock 系统、Monitor、完整 Inspector

### V3. 轻量配置面板（v1.8.0 附带）

- [ ] **V3.1 Canvas 快速设置**:
  - VS Code TreeView 或简单 Webview：模式/分辨率/背景色
  - 修改后写回文件 frontmatter（复用 `updateFrontMatter` 逻辑）
- [ ] **V3.2 不需要实现的面板**（节省工作量）:
  - ~~Monitor 审计日志~~ → VS Code Output Channel 输出即可
  - ~~完整 Inspector~~ → V3.1 的简化版足够
  - ~~Dock 布局系统~~ → VS Code 自带布局
  - ~~文件浏览器~~ → VS Code 原生 Explorer

---

## 9. 资产与视觉进阶

- [ ] **Asset Explorer**: 图片/音频资源管理。
- [ ] **西文 Kerning Pair 自动微调**。

---

## Known Gaps (Phase A 遗留)

| 问题                               | 影响                                                                | 备注                  |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------- |
| `f.slow`/`f.fast` in effect chains | speedMultiplier 返回值在 Timeline 回调中丢失                        | 糖衣 `~`/`^` 正常工作 |
| Modifier-based stage cmds          | `cam.shake`/`cam.drift` 用 `tl.call()` 非可 seek Tween              | seek 时不插值         |
| Cross-segment animation recreation | `InFlightAnimation` 数据已记录但未被 Phase B 消费                   | Phase C 实现          |
| `cam.reset` 中断冲突               | `cam.reset` 未被记录为 active entry，中途被 `cam.move` 打断可能冲突 | 边缘场景              |

---

## KMD 语法统一规则

```
┌─────────────────────────────────────────────────────────────┐
│  结构层 (行首 @)                                              │
│    @ if/elif/else/end    条件分支                              │
│    @ loop/while/end      循环                                 │
│    @ tag/jump            标签与跳转                            │
│    @ wait                等待 (click/signal)                   │
│    @ set                 赋值 (= 右侧为表达式)                  │
├─────────────────────────────────────────────────────────────┤
│  指令层 (点命名空间，独立指令行为主)                               │
│    cam.*                 摄影机控制    cam.move(x,y,t)         │
│    state.*               内联状态变更  state.set(k, expr)      │
├─────────────────────────────────────────────────────────────┤
│  原子层 (裸词，可嵌入特效链)                                     │
│    goto/flow/up/down     排版指令                              │
│    markStart/markEnd     标记操作 (保持裸词，避免链内歧义)         │
│    shake/wave/red/bold   特效与样式                             │
│    hold/pause            时序控制                              │
├─────────────────────────────────────────────────────────────┤
│  修饰符                                                       │
│    hold:char / pause:char    冒号层级修饰                       │
│    var.x / prev.start        点分变量/标记引用                   │
│    f.red.hold(1s).wave       点分特效链                         │
│    chain1 + chain2           并发特效链                         │
│    行尾 \                     续行符                            │
└─────────────────────────────────────────────────────────────┘
```
