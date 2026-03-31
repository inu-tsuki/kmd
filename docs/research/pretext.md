# `pretext` 调研归档

> 调研对象：[`chenglou/pretext`](https://github.com/chenglou/pretext)
> 调研时间：2026-03-31
> 结论状态：阶段性判断，可在后续排版内核重构时复查

## 一句话结论

`pretext` 不是 `kmd-editor` 的直接同类项目。

它更像一个专注于“多行文本测量与换行布局”的底层库，而 `kmd-editor` 是一个包含 DSL、解析器、排版、播放、动画、舞台与编辑器集成的完整创作系统。

如果看整个产品，重叠度较低；如果只看“文本测量与行布局引擎”这一层，重叠度中等。

## 调研对象摘要

根据 `pretext` README，截至 2026-03-31，该项目的自我定位是：

- 纯 JavaScript/TypeScript 的 multiline text measurement & layout 库
- 重点解决 DOM-free 文本高度预测与手动行布局
- 提供 `prepare()` / `layout()` 的冷热路径拆分
- 提供 `layoutWithLines()`、`walkLineRanges()`、`layoutNextLine()` 等 API
- 目标支持 DOM、Canvas、SVG，以及未来的 server-side 场景

参考来源：

- <https://github.com/chenglou/pretext>
- <https://github.com/chenglou/pretext/blob/main/README.md>

## 与本项目的重叠度

### 低重叠：产品与系统层

本项目当前的核心范围明显更大：

- KMD DSL 与命令语义
- `AST -> IR -> runtime` 解析主路径
- token/group/paragraph 级指令路由
- GSAP 时间线、行为特效、舞台指令
- Pixi 渲染、Monaco 编辑器、VS Code 扩展

这些能力都不在 `pretext` 的主要问题域内。

### 中等重叠：排版内核层

真正重叠的是“文本测量 + 换行 + 行布局”这一层。

本项目当前已有自研排版内核：

- `src/core/layout/LayoutStreamBuilder.ts`
- `src/core/layout/TextLayoutEngine.ts`
- `src/core/render/text/TextBuilder.ts`

其中已经涉及：

- `CanvasTextMetrics` 测量
- token/char 宽度计算
- baseline 对齐
- wrap 与 align
- phantom pass 与 marker 同步

这部分和 `pretext` 在抽象层上接近，但本项目附带了更多 DSL 语义和 runtime 约束。

## 可以借鉴的部分

### 1. 冷热路径拆分

`pretext` 的 `prepare()` / `layout()` 设计很值得参考。

它把“文本分段、测量、缓存”与“给定宽度后的快速布局计算”拆开，这对以下场景尤其有价值：

- 仅容器宽度变化时的快速重排
- seek / scrub 期间的快速重建
- 编辑器预览区频繁 resize

### 2. 多语言与浏览器一致性方法论

`pretext` 明显把精力投入在：

- mixed bidi
- emoji
- 浏览器差异
- corpus / benchmark / accuracy 体系

这对本项目未来要提升文本排版可信度时很有价值，尤其是中日韩与混排场景。

### 3. 行级 API 设计

`layoutWithLines()`、`walkLineRanges()`、`layoutNextLine()` 这一组 API 很值得研究。

它们不是简单给出高度，而是给出一种“可编排的行布局接口”。如果本项目未来要做：

- 更复杂的流式布局
- 不同宽度区域内的逐行排版
- 平衡排版或 shrink-wrap

这些 API 设计会有启发。

## 不适合直接通用的部分

### 1. KMD 语义路由

本项目的 `f.`、`.`、block option、`lowering.ts` 路由规则，是 DSL 级语义，不是通用文本库的职责。

`pretext` 不处理这些概念。

### 2. 时间线、特效与舞台

本项目的四轨特效模型、`TextPlayer.buildTimeline()`、stage 指令、跨段动画恢复，都属于播放引擎问题域。

`pretext` 不提供这类时序与视觉 runtime。

### 3. marker / goto / out-of-flow 语义

本项目当前布局不仅是“换行”，还包括：

- marker 前后引用
- `goto` / `flow`
- visual displacement 与 flow control 分层
- paragraph / line / token 作用域混合

这已经超出 `pretext` README 中声明的常规文本布局范围。

## 是否需要关注

需要，但建议作为“技术雷达”持续关注，不建议当前直接引入为运行时依赖。

理由：

- 它在 2026-03-26 到 2026-03-30 之间仍有密集更新，项目处于早期但活跃阶段
- 它解决的问题很具体，而且正好压在本项目最底层、最容易长期变复杂的那一层
- 它当前还不是一个能覆盖本项目 runtime 语义的替代品

更准确地说，`pretext` 适合被当成：

- 排版内核研究样本
- API 设计参考
- 多语言精度与 benchmark 方法参考

而不是：

- 整体方案替代品
- 现阶段可直接接入的上游依赖

## 对本项目的行动建议

### 近期

- 不接入依赖
- 保持关注其 README、benchmark、accuracy 相关演进
- 把它作为排版内核设计的参考资料

### 中期

如果未来出现以下目标，可以重新评估：

- 将“纯文本 in-flow 布局”从 KMD runtime 中进一步剥离
- 强化多语言换行准确性
- 为预览器或 IDE 做更快的文字高度预测与 reflow

### 长期

如果本项目未来形成“语义层 + 通用文本布局层”的更清晰边界，再评估是否有局部复用或接口对接的可能。

## 对文档库的补充说明

这类内容属于“外部项目调研”，不应继续散落在顶层讨论稿里。

后续类似文档建议统一归档到：

- `docs/research/项目名.md`

这样能把“核心机制文档”和“外部情报文档”分开，方便长期维护。
