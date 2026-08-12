# KMD Writing Guide

> 最近更新：2026-05-26
> 状态：Draft / 基于现有样本归纳

这份文档不是语法手册，而是根据现有 `.kmd` 样本提炼出的创作守则。目标是帮助我们在 `community-api` 中写出既好看、又能稳定测试 runtime 的作品脚本。

现有样本大致分成两类：

- `apps/community-api/content/works/*/rev-1.kmd`：短诗式作品种子，几乎没有指令，适合观察基础阅读节奏。
- `apps/editor/public/*.kmd` 与 `apps/editor/public/tests/*.kmd`：语法与 runtime 功能 fixture，覆盖 timing、stage、layout、effect、font、seek 等边界；`apps/editor/public/examples/` 放叙事/展示作品，不进入 parser golden。

## 总体原则

KMD 更像“可播放的文字分镜”，不是普通文章加上一串装饰命令。

好的脚本应当遵循三个约束：

1. 每个段落只承担一个清晰的画面节拍。
2. 每个节拍只使用少量明确动效，不把所有语法挤在一行。
3. 作品脚本优先服务情绪、镜头和阅读呼吸；测试脚本才优先服务覆盖率。

如果一行文字不加指令也能成立，加指令后只应让它更准确，而不是更吵。

## 基础结构

面向 reader runtime 和 Android WebView 的社区作品，推荐显式写 frontmatter。舞台类作品应声明设计画布：

```kmd
---
title: Rain City Slow Motion
mode: stage
speed: 40
designWidth: 1920
designHeight: 1080
---
```

没有 frontmatter 的作品仍应能作为纯文本播放。但 Android Reader 会读取 `.kmd` frontmatter 中的 `mode` 来选择播放模式；`designWidth` / `designHeight` 只属于 `stage` / `interactive` 这类有设计坐标系的作品。

滚动阅读和分页阅读不是固定画布表演。它们应该自适应容器宽高，并由 runtime / host 执行阅读排版：

```kmd
---
title: Rain City Notes
mode: scroll
speed: 40
---
```

要测试镜头、横竖屏、stage viewport、审核工具和播放时长，舞台脚本最好声明 `mode`、`speed` 和设计尺寸；阅读脚本则应优先声明 `mode`、`speed`，避免把设计画布当成阅读布局事实。

段落之间用空行分隔。一个段落应当接近一个镜头或一个呼吸单位：

```kmd
The street light opens like a small moon.

Rain writes silver lines across the window.
```

## 节奏写法

### 用 `|` 写呼吸

短暂停顿优先使用管道符：

```kmd
我在这里|停一下。
这是一个|(1s)更长的停顿。
连续||停顿两次。
```

`|` 适合句内呼吸、犹豫、转折；它比额外拆段更细，也比全局 `pause` 更贴近文字。

### 用 `pause` 写外层等待

如果要让后续内容真正等待，使用外层 pause 或独立管道段：

```kmd
{等一下} @ pause(2s)
这段出现时，上面已经暂停了。
```

注意：链尾 `hold` 只影响链内后续特效；它不是段落级等待。需要等待下一行时，用 `pause` 或 `|`。

### 谨慎使用并发糖

`>`、`>>`、`>>>` 是很有表现力的节奏开关：

```kmd
快>速>推>进
这一行打到一半 >> 下一行就会开始。
{我是段落A} >>> 此后和段落B并行。
```

作品脚本里不要把它们当成默认标点。它们适合表达打断、追赶、重叠旁白、镜头提前切入。普通叙述仍然让默认速度工作。

## 特效作用域

### `f.` 写被花括号点名的对象

用花括号标出想强调的词，再用 `f.` 给它们分配特效：

```kmd
{多个} {Token} {对应} @ f.red f.green f.blue
```

最佳实践：

- 花括号数量和 `f.` 链数量尽量一致。
- 一个重点词优先用一条短链，例如 `f.red.hold(1s).blue`。
- 不要在一句话里同时给太多词加长链；读者会失去主焦点。

### `.` 写整行广播

`.` 前缀适合表达整行的状态：

```kmd
~~我……|~我真的不知道…… @ .shake(strength=2).offset(800, 0)
```

它适合角色位置、整句颤抖、整行偏移。若只是强调一个词，优先使用 `f.`。

### 裸命令写布局和舞台

裸名命令常用于布局或舞台：

```kmd
[align=center]
我现在处于{屏幕中间} @ up(100).mark(center_point)

@ cam.move(0, 400, 2s)!
镜头执行完成后才继续。
```

`!` 表示阻塞，适合“镜头到位后再出字”。没有 `!` 时，镜头可以和文字并行，适合环境氛围。

## 镜头与舞台

舞台命令最适合做作品的“骨架”，而不是每句都动：

```kmd
[cam.zoom(0.8, 1s)!]
演出开始。

[cam.move(500, 0, 15s)]
第一段：camera 开始缓慢右移。
```

推荐模式：

- 开场用一次 `cam.zoom` 或 `cam.move` 建立空间。
- 中段用一个长时间非阻塞镜头制造流动。
- 收尾用 `cam.reset(1s)!` 回到稳定状态。

Android WebView 下要少做高频、过密、长时间叠加的行为效果。尤其是全屏播放、Profiler、seek 频繁操作时，脚本越克制越容易暴露真正的问题，而不是把 renderer 压到不稳定。

## 文字效果

现有可稳定作为作品基础的效果包括：

- 颜色与样式：`red`、`blue`、`green`、`yellow`、`bold`、`italic`、`big`、`small`
- 行为：`shake`、`wave`、`rainbow`
- 入场：`fadeIn`、`popIn`、`jumpIn`、`blurIn`
- 排版：`align`、`offset`、`goto`、`mark`
- 舞台：`cam.move`、`cam.zoom`、`cam.rotate`、`cam.offset`、`cam.reset`、`cam.shake`

作品脚本中，行为特效应当有明确语义：

```kmd
{雨} @ f.wave
```

比下面这种写法更健康：

```kmd
{雨} @ f.red.wave.rainbow.shake.popIn
```

前者让“雨”获得流动感；后者只是在堆效果。

## 字体与移动端

字体是移动端 runtime 的高风险资源。当前 Android reader 已经避免默认加载所有大字体，因此作品脚本应当：

- 不随意显式切换大字体。
- 需要字体时，让 Work metadata 或 asset manifest 明确声明。
- 用 `bold`、`italic`、`big`、`small` 等轻量样式优先表达层次。

用于字体测试的脚本可以保留在 editor 测试样本中；community-api 的默认作品不应把字体加载作为日常播放前提。

## 社区作品脚本的推荐分层

未来 `community-api` 可以维护四类 `.kmd`：

1. 基础短篇：纯文本或少量停顿，验证列表、详情、阅读入口和基础播放。
2. 氛围短片：少量 stage 命令加一两个行为效果，验证移动端播放观感。
3. Runtime 回归片段：专门覆盖 seek、viewport、镜头、layout、pause、hold。
4. 审核样本：包含可预期的问题，例如过多字体、过密行为效果、未声明资源、疑似不稳定语法。

不要让一个脚本同时承担所有责任。漂亮作品负责美感，回归脚本负责边界，审核样本负责暴露风险。

## 写作检查清单

发布到 community-api 前，可以快速检查：

- 是否有 frontmatter，至少包含 `title`、`mode`、`speed`？
- 每段是否有一个明确画面目标？
- 是否只有一个主导动效，而不是所有效果同时出现？
- `f.` 链和花括号组是否能一眼对应？
- `hold`、`pause`、`|` 的等待语义是否用对？
- 镜头是否有开始、变化和收束？
- 是否避免了不必要的字体加载？
- 是否能在 Android WebView 上不依赖 debug probe 正常播放？

一句话记忆：

> 先写能被读懂的节拍，再给节拍上运动。
