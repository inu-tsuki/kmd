# Layout Refactor Outline

> 状态：初步方案
> 范围：`LayoutStreamBuilder -> TextLayoutEngine -> TextBuilder` 这一段的布局执行链
> 目标：在不立刻重构的前提下，固定当前问题、未来方向和重构边界，并确保 layout 设计能兼容 TODO 中未来的 graph/state/plugin 扩展

## 背景

解析器已经完成了 `AST -> IR -> legacy projection` 的第一轮重构，但布局执行链仍处于过渡态：

- `ParagraphIR` 还是混合语义的过渡 IR
- `LayoutStreamBuilder` 同时承担 layout、timing、stage 数据装配
- `TextLayoutEngine` 通过双 pass 同时处理前向 marker、行布局和最终 placement

目前系统能工作，但还没有形成清晰的 execution pipeline。
同时，TODO 中未来的这些需求还没有直接进入 layout 方案约束：

- Segment Graph 与 default path seek
- State / interpolation / control flow 语法
- 插件式 sugar / hook / beforeLayout
- 更强的 line-level geometry 与 IDE 反馈

## 当前职责

### `LayoutStreamBuilder`

- 消费 `ParagraphIR.inline`
- 将 layout instructions 展开为 `preCmd/postCmd`
- 在测量前应用初始 style
- 为后续 runtime 组装 `charData`

### `TextLayoutEngine`

- 执行 layout stream 中的命令
- 维护 cursor / baseline / in-flow 状态
- 通过 phantom pass 支持前向 marker 引用
- 输出最终 `LayoutResult[]`

## 已确认的问题

### 1. 双 pass 结构尚未正式化

当前 `runPhantomPass()` 和 `calculate()` 共享目标，但没有共享统一执行框架：

- 首行 ascent 计算重复
- wrap 逻辑重复
- tracking / stepDistance 逻辑重复
- align 修正逻辑重复

风险不是代码丑，而是两遍执行未来容易语义漂移。

### 2. layout / playback / stage 仍有混合

`LayoutStreamBuilder` 目前不仅构建 layout stream，还把：

- timing sugars
- visual effects 的初始 style
- stage instructions

一起塞进 `charData`。这说明真正的 execution IR 还没有成型。

### 3. marker 保留语义与 engine 耦合过深

`prev.start` / `line.mid` / `next.end` 这类语法对作者很友好，但目前它们：

- 以裸字符串协议存在
- 由 `TextLayoutEngine` 直接维护
- 与内部 `phantom_*` 临时标记共享同一心智模型

这在长期上不够健康。

### 4. 输入边界仍偏 builder 私有

`TextLayoutEngine` 实际消费的是：

- `LayoutItem`
- 加上 `charData` 私有约定

说明布局引擎的输入类型还没有真正独立。

### 5. 仍缺少 document/state/plugin aware 的边界

未来 layout 不会只服务“线性 paragraph reveal”：

- `{var.xxx}` 插值会影响测量与重排
- `@ if / @ loop / @ jump` 会影响 paragraph 的图级组织
- `beforeLayout` / layout plugin hook 需要稳定输入输出契约

当前 layout 方案还没有把这些未来约束写进主设计。

### 6. `layout stream` 的定位仍然过大

当前代码很容易给人一种错觉：

- `LayoutStreamBuilder` 生成的 stream 像是整个系统的总线
- timing / stage / visual / dummy item 都在顺着这条流移动

但更健康的未来定位应当是：

- `layout stream` 只是 `LayoutMiddleware` 内部的顺序执行表示
- 它适合承载 text run、layout command、anchor write、line break
- 它不应继续承担 stage cue、playback cue、document control flow 的总 IR

如果不尽早收紧这个定位，未来 graph/state/interactive runtime 很容易再次被硬塞进 layout lane。

### 7. `LayoutManager` kernel 基本健康，但 layout 语义政策仍散落在 preset 中

这轮对 manager 的阅读说明：

- `LayoutManager` 本体非常轻
- 真正承载大量语言语义的是 `layoutPresets` / `layoutExpanders`

目前还缺少明确的：

- `LayoutMetadata`
- command family / policy 分类
- planner / IDE 可直接消费的布局命令元信息

因此下一轮 layout 重构不应优先推倒 `LayoutManager`，而应优先：

- 结构化 anchor / marker
- 抽离 design-space / presentation policy
- 为 layout command 增加 metadata 层

## 重构目标

下一轮 layout 重构不以“增加大量高级排版特性”为主，而以“正式化布局执行链”为主：

1. 将双 pass 提升为正式的 `preflight + final placement` 模型
2. 将纯布局职责从 playback / stage 装配中分离出来
3. 结构化保留 anchor，而不是继续扩张字符串协议
4. 为未来更强的排版能力预留接口
5. 为 graph/state/plugin 扩展保持稳定的 layout 输入输出边界

## 初步方向

### 1. 正式化双 pass

将当前 phantom pass 改造为真正的 `preflight pass`：

- 第一遍产出布局情报，而不只是前向 marker
- 第二遍消费 preflight 结果做最终 placement

建议引入：

- `LayoutPreflightResult`
- `LinePlan`
- `AnchorState`
- `LayoutDiagnostics`

建议至少先固定一个最小骨架：

```ts
interface LayoutPreflightResult {
  lines: LinePlan[];
  anchors: AnchorState;
  diagnostics: DiagnosticEvent[];
  estimatedBounds: { minX: number; minY: number; maxX: number; maxY: number };
}
```

### 2. 拆分 `TextLayoutEngine`

未来建议拆为以下角色：

- `LayoutPassRunner`
  - 通用 stream 执行器
- `LineAccumulator`
  - 收集一行、换行、对齐、line finalize
- `AnchorCoordinator`
  - 维护 named markers、reserved anchors、phantom anchors
- `LayoutPlacer`
  - 负责最终 `LayoutResult` 生成

这里也需要明确术语：

- `LayoutMiddleware`
  - 是架构边界层
- `LayoutPlanner` / `LayoutPassRunner` / `LineAccumulator` / `DisplayAssembler`
  - 是 middleware 内部或邻接层组件

### 3. 收缩 `LayoutStreamBuilder`

未来建议将其拆成更明确的三层：

- `LayoutPlanner`
  - 只负责 layout lane、测量、stream 命令展开
- `DisplayAssembler`
  - 将 placement 结果投影到 `KineticChar` / `TokenWrapper` 等显示对象
- `CompatBinder`
  - 只处理过渡期 `charData` / pending effects / legacy paragraph props

timing / stage / playback 相关信息不应长期继续寄宿在 layout-only builder 中。

这里还需要明确一个落地策略：

- `LayoutPlanner / DisplayAssembler / CompatBinder` 是目标拆分方向
- 但第一刀不必强行把 `LayoutStreamBuilder.build()` 立刻拆成三个独立模块
- 更稳的顺序是：
  - 先正式化双 pass 与 preflight 结果
  - 再让 execution 侧开始消费更清晰的 plan
  - 最后回头细化 `LayoutStreamBuilder` 的内部三角拆分

同时建议为未来预留：

- `beforeLayout` hook 的 plan-level 入口
- 插值节点与 state-resolved text runs 的重排入口
- 面向 IDE/Inspector 的 line geometry / source map 输出

这里也应明确：

- `TextBuilder` 这类“胶水层”更像早期桥接器，而不是长期稳定边界
- 更健康的做法是将 parser/output context、layout bridge、display assembly、compat binding 分开
- core layout 不应继续直接依赖 UI store 或宿主对象的 `any` 协议
- `KineticText` / `KineticChar` 不应继续默认承担 layout 结果、execution cue、runtime cache 的混合宿主角色

### 4. 结构化 Anchor 系统

保留脚本层写法，例如：

- `line.start`
- `prev.mid`
- `next.end`

但在内部引入结构化模型：

- `AnchorRef`
- `AnchorState`

布局引擎只负责求值，不再直接维护一套面向脚本的裸字符串协议。

同时要注意区分：

- `LayoutCue`
  - `mark`
  - `goto`
  - `flow`
  - `offset`
- `LayoutPolicy`
  - design origin
  - lineHeight default
  - align / wrap heuristics

后者不应继续混在 operator preset 内部作为隐含政策。

### 5. 面向未来的 layout contract

未来 layout plan 应额外保证：

- 能被 `SegmentGraph` 上层消费，而不是只服务线性段落
- 能处理 state-driven text interpolation 后的快速 reflow
- 能输出更稳定的 line/anchor 几何，支撑 IDE、Inspector、stage anchor
- 能作为插件 hook 的稳定面，而不是继续暴露 builder 私有 `charData`
- 能投影到 `ParagraphInstance` / `KineticText` / `KineticChar` 等宿主，而不是直接把所有 plan 信息写回显示对象

### 6. dummy 的迁移方向

当前系统里有不少“零宽但需要占位”的节点通过 dummy `KineticChar` 继续向后流动。这在原型期很高效，但对新架构不够健康，因为它把：

- layout item
- execution cue
- display object

混成了一个对象。

未来更合理的方向应当是拆开：

- `LayoutItem`
  - 只存在于 layout stream 中
- `CueNode`
  - 只存在于 execution/effect/stage plan 中
- `DisplayObject`
  - 真正需要显示时才投影为 `KineticChar` / `TokenWrapper`

也就是说，可以保留“零几何节点”，但不应继续保留“伪装成字符的零几何显示对象”。

## 非目标

以下内容不属于下一轮 layout 重构的主目标：

- 立即引入完整专业排版特性
- 立即重写 `TextPlayer` / `ScriptPlayer`
- 一次性消灭所有 legacy `charData` / `tokens` 兼容层
- 直接引入外部布局库作为运行时依赖
- 让 layout 直接承担 control flow 或 state 求值职责

## 延后目标

以下内容本轮只先写入约束，不作为第一刀：

- 完整 `LayoutMetadata` 设计
  - 当前先明确缺口，不急于一次把 layout command 元信息做满
- 更专业的排版增强
  - CJK 细致禁则、balance layout、fit-to-box 等延后到边界稳定后
- 完全移除 legacy `charData`
  - 先收紧它的作用域，再逐步把 plan 信息迁出显示对象

## 与未来排版增强的关系

本轮若能完成边界重构，未来更容易接入：

- prepare/layout 分离
- 更稳定的 line-level geometry API
- CJK / mixed-script 更强断行策略
- fit-to-box / balance layout
- IDE 预估高度与快速 reflow

参考调研：

- [pretext.md](../research/pretext.md)

## 建议的下一步

在正式规划重构前，继续完整阅读 execution pipeline：

1. `EffectProcessor.ts`
2. `TextPlayer.ts`
3. `ScriptPlayer.ts`

读完之后，再统一产出一版：

- execution lanes 图
- Resolved IR / Anchor 模型草图
- layout / playback / stage 的边界提案
