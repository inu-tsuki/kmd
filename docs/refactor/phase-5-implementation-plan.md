# Phase 5 Implementation Plan

> 状态：PLANNED
> 目标：消除 paragraph build 主链路中的双语义源，启动 `LayoutStreamBuilder -> TextLayoutEngine -> TextBuilder` 的正式拆分，使 parser / layout / execution 共享同一份 paragraph 输入
> 对齐文档：`layout-refactor-outline.md`、`execution-refactor-outline.md`、`ir-refactor-outline.md`、`phase4-code-review.md`

## 为什么是现在

Phase 4 已经把 stage 这一轴站稳了。当前最突出的结构问题不再是 `StageManager`，而是 paragraph build 主链路里还存在两份事实来源：

- `SegmentBuilder` 读取 parser 产出的 `KMDParagraphData`
- `KineticText / TextBuilder` 又从 `rawText` 重新 `parseParagraph()`

这意味着：

- 审查时很容易误判 `scene.clear` 这类语义的归属
- parser-side 的 `ParagraphIR` 没有真正成为 build 主输入
- `LayoutStreamBuilder`、`TextBuilder`、`KineticText` 之间的职责边界一直处于“能跑，但说不清谁拥有语义”的状态

如果不先收掉这条双语义源，后面的 `StateMiddleware`、`ControlFlowMiddleware`、`SegmentGraphPlan` 很容易再次落回“文档一份、runtime 再解释一份”的老路。

## 当前链路与目标链路

当前主链路：

```text
KMDParagraphData + rawText
  -> SegmentBuilder
  -> KineticText.init(rawText)
  -> parser.parseParagraph()
  -> TextBuilder
  -> LayoutStreamBuilder
  -> TextLayoutEngine
  -> KineticChar / TokenWrapper
```

第五阶段目标链路：

```text
KMDParagraphData / ParagraphIR
  -> ParagraphBuildInput
  -> LayoutPlanner
  -> TextLayoutEngine
  -> DisplayAssembler
  -> CompatBinder
  -> KineticText / ParagraphUnit
```

这并不要求 Phase 5 一次性删掉所有 compat path，但要求：

- segment build 的主路径不再依赖 `rawText` 二次 parse
- `LayoutStreamBuilder` 不再继续兼任 planner + display object factory
- `TextBuilder` 不再继续同时承担 parser bridge、layout bridge、display glue、compat writeback

## 第五阶段的实际目标

1. 建立 paragraph build 的单一语义源
2. 启动 `LayoutPlanner / DisplayAssembler / CompatBinder` 三角拆分
3. 收紧 `TextBuilder` / `KineticText` 的 build boundary
4. 为 Phase B 的 graph/state/control-flow 打开稳定入口

## 范围

### In Scope

1. `SegmentBuilder -> KineticText/TextBuilder` 主路径改为消费 parser-side paragraph input
2. `LayoutStreamBuilder` 第一轮拆分：planner 逻辑与显示对象物化分离
3. `TextBuilder` 的角色收缩与 compat wrapper 建立
4. `TextLayoutEngine` 与 host 类型的边界清理起手
5. 针对 paragraph build parity 的验证与回归文档

### Out of Scope

1. 全局 `DiagnosticsCollector / AuditBus` 统一
2. `StageManager` 的第二轮瘦身
3. `DocumentSemanticIR` / `SegmentGraphPlan` 的真实 rollout
4. `StateStore` / `@if` / `@loop` / `@jump` 等 Phase B 语法功能
5. `KineticText / KineticChar` 的最终形态收缩

## 当前已知问题

### 1. 双语义源

当前 `SegmentBuilder` 先读 parser 的 `KMDParagraphData`，随后 `KineticText.init(rawText)` 又重新解析同一段文本。功能上暂时可用，但这会制造：

- 语义归属审查歧义
- parser / layout / execution 之间的 ownership 模糊
- 未来 graph/state 接入时的重复解释风险

### 2. `LayoutStreamBuilder` 职责过杂

它当前同时承担：

- measurement style 准备
- layout instruction 展开
- stage lane 收集
- timing sugar 附着
- `KineticChar` 创建前的数据组装

这让它既像 planner，又像 display factory，还像 compat binder。

### 3. `TextBuilder` 仍是隐藏的胶水层

它当前同时承担：

- parser paragraph data 接入
- base style / store 读取
- layout bridge 调用
- `KineticChar` / `TokenWrapper` 物化
- `KineticText` legacy 字段回写

这条链如果不拆，Phase B 只会继续往一个“知道所有细节”的 builder 上加东西。

### 4. `TextLayoutEngine` 仍牵着 host 类型

目前 engine 仍通过 `FullOptions` 与 `KineticText` 建立边界，这说明 layout core 还没有完全独立成 host-agnostic 输入/输出。

## 工作包

### WP1. Paragraph Single-Source Build Path

目标：让 segment build 主路径直接消费 parser-side paragraph input，而不是在 `KineticText/TextBuilder` 里再次 `parseParagraph(rawText)`。

建议方向：

- 引入 `ParagraphBuildInput`
- 为 `KineticText` 增加 parser-driven init/rebuild 入口
- 保留 `init(rawText)` 作为 editor / preview / compat path，而不是主段落 build path

建议触达文件：

- `src/core/player/SegmentBuilder.ts`
- `src/core/KineticText.ts`
- `src/core/render/text/TextBuilder.ts`
- 视情况新增：
  - `src/core/render/text/types.ts`

验收标准：

- `SegmentBuilder.build()` 的主路径不再依赖二次 parse
- `hasSceneClearCue` 这类判断只需要面对 parser-side paragraph data
- editor / preview 仍可通过 compat path 直接从源码构建

### WP2. `LayoutPlanner` Extraction

目标：把 `LayoutStreamBuilder` 中的纯规划逻辑抽离出来。

建议第一轮先收这些职责：

- measurement style 准备
- initial style preview
- token width / char width 测量
- pre/post command 展开
- stage lane / timing sugar 收集

建议结果：

- `LayoutPlanner`
- `LayoutStreamBuilder` 变成 compat façade 或薄包装器

建议触达文件：

- `src/core/layout/LayoutStreamBuilder.ts`
- 新增：
  - `src/core/layout/LayoutPlanner.ts`

验收标准：

- planner 输出 typed item/glyph plan
- pure planner path 不直接创建 `KineticChar`
- `LayoutStreamBuilder` 不再继续是“布局+执行+显示对象工厂”的合体

### WP3. `DisplayAssembler` / `CompatBinder` Split

目标：把 `TextBuilder` 里的显示对象物化与 compat 写回拆开。

建议方向：

- `DisplayAssembler`
  - 消费 layout results 与 glyph plan
  - 创建 `KineticChar` / `TokenWrapper`
  - 应用 `baseStyleSnapshot`、dummy char、line/token wrapper 装配
- `CompatBinder`
  - 回写 `_pendingGlobalEffects`
  - 绑定 `timingSugars` / `stageInstructions` / legacy token props

建议触达文件：

- `src/core/render/text/TextBuilder.ts`
- 新增：
  - `src/core/render/text/DisplayAssembler.ts`
  - `src/core/render/text/CompatBinder.ts`

验收标准：

- `TextBuilder` 不再同时承担 parser bridge、display assembly、compat writeback
- `KineticChar` 的创建责任有明确归属

### WP4. Paragraph Build Boundary Cleanup

目标：让 paragraph build 的边界开始脱离宿主对象与 UI store 的隐式依赖。

建议方向：

- 将 `TextBuilder` 从 parser 与 UI store 的直接依赖收缩为 build-context 驱动
- 为 `TextLayoutEngine` 引入 host-agnostic options 类型
- 不要求本轮彻底清掉 `TextPlayer` / `ScriptPlayer` 的 store 读取，但要先把 paragraph build 入口收紧

建议触达文件：

- `src/core/render/text/TextBuilder.ts`
- `src/core/layout/TextLayoutEngine.ts`
- `src/core/KineticText.ts`

验收标准：

- `TextLayoutEngine` 不再直接依赖 `KineticText.FullOptions`
- paragraph build path 的 store 依赖有明确输入边界，而不是散落在 builder 内部

### WP5. Validation and Guard Rails

目标：确保这轮拆分不把现有 seek / stage / layout 语义打坏。

最低验证集：

- `pnpm build`
- `pnpm test:parser`
- 样例脚本人工回归：
  - `scene.clear`
  - `page`
  - `seek`
  - paragraph build parity（parser-driven path 与 compat source-driven path）

文档同步：

- `docs/refactor/README.md`
- `docs/ai/TODO.md`
- Phase 5 代码审查文档（完成后新增）

## 推荐顺序

1. `WP1 Paragraph Single-Source Build Path`
2. `WP2 LayoutPlanner Extraction`
3. `WP3 DisplayAssembler / CompatBinder Split`
4. `WP4 Paragraph Build Boundary Cleanup`
5. `WP5 Validation and Guard Rails`

这样排序的原因：

- 不先收掉双语义源，后续 planner 拆分会一直踩在两个输入事实来源上
- planner 与 display assembly 需要先分开，`TextBuilder` 才有收缩空间
- boundary cleanup 放在第三步之后更稳，否则容易一边拆类型一边继续搬运胶水

## 风险与控制

### 风险 1：compat path 与 parser-driven path 语义漂移

控制方式：

- Phase 5 期间保留 `init(rawText)` compat path
- 对关键样例做 parity 检查
- 先让 `SegmentBuilder` 主路径切换，再考虑更大范围替换

### 风险 2：为了“拆干净”而一次性引入过多抽象

控制方式：

- 第一轮只要求角色边界成立，不要求最终命名一次到位
- 可以先让 `LayoutStreamBuilder` 变成 façade，再继续内部瘦身

### 风险 3：误伤 seek / stage cue / timing sugar

控制方式：

- 不在本轮同时改变 `TextPlayer` 时间语义
- `scene.clear / page / seek` 作为必跑回归集
- 把 compat binder 保留到最后拆，避免过早切断 legacy 字段写回

## 阶段完成定义

第五阶段完成后，应至少满足：

1. segment build 主路径不再依赖 `rawText` 二次 parse
2. `LayoutPlanner` 已真实存在，`LayoutStreamBuilder` 不再继续承担全部角色
3. `DisplayAssembler / CompatBinder` 已让 `TextBuilder` 的职责明显收缩
4. paragraph build 的输入边界已足够稳定，可作为 Phase B 的前置基座
