# 时间线与缓动架构

> 本文档描述 KMD 运行时的时间线/动画基础设施，以及缓动（easing）时间曲线控制的可行性路径。
> 理解此文档可以判断 ease 参数能否引入到特效、排版和舞台中，以及需要改什么。

## 结论先行

**底层架构完全可以支持时间曲线控制，无需架构变更。** KMD 播放系统建立在 GSAP 之上，`ease` 是 GSAP 的一等参数。`params` 管线端到端贯通——从解析器到特效函数，ease 参数能自动流达。`gsap.parseEase` 已在 seek-trim 中使用。entrance / stage camera / behavior 侧 tween 均可支持 ease。

## 时间线架构

### 双层时间线

整个播放系统建立在 **GSAP timelines 和 tweens** 上，非自建逐帧循环（behavior modifier 除外，见下文）。

**Segment 时间线**（`SegmentBuilder.build`, `SegmentBuilder.ts:111`）：
- `const segmentTl = gsap.timeline({ paused: true })` — 每段一个主时间线。
- `TextPlayer.buildTimeline` 构建的逐段子时间线通过 `segmentTl.add(buildResult.timeline, segmentCursor)` 挂载（`:243`）。
- 舞台相机 tween 由 `stageManager.apply(...)` 产出，经 `captureTween` → `timeline.add(result, position)` 挂载（`:544-548`）。
- `Segment` 对象存储 `timeline: ReturnType<typeof gsap.timeline>` + 并行记录数组（`behaviors`/`styleRecords`/`instantEffects`/`stageTweenRecords`）。

### Seek/Play 机制

`PlaybackController`（`PlaybackController.ts`）：
- `playSegment`（`:36`）：注册 behaviors/instant effects 后 `tl.play()` 或 `tl.restart()`。
- `seekToTime`（`:63`）：`segment.timeline.seek(clamped)` — GSAP 自动按 ease 插值所有 entrance tween 和 stage tween 到该位置。然后手动重注册 behaviors（`registerBehaviors`）、重放 styles（`replayStyles`）、重应用 instant filters（`registerInstantEffects`）——因为这三类不在时间线上。
- `onUpdate` 回调报告 `segmentTl.time() * 1000`；`onComplete` 暂停时间线（BUG-14 修复，`:369`）。

### 使用的 GSAP 方法

| 方法 | 用途 | ease 支持 |
|---|---|---|
| `gsap.timeline()` | segment/child/clear/reset 时间线 | — |
| `gsap.to()` | entrance tween、stage camera、scroll | ✅ `ease` in TweenVars |
| `gsap.fromTo()` | seek-trimmed stage tween | ✅ |
| `gsap.set()` | 初始状态（`tl.set(char, {visible:true}, cursor)`） | ❌ 瞬时 |
| `tl.call()` | behaviors/instant/stage modifier/style replay/line-sync | ❌ 瞬时 |
| `tl.add()` | 挂载 entrance/group tween | ✅（tween 自带 ease） |
| `tl.eventCallback()` | onUpdate/onComplete | — |

## 已有缓动使用（hardcoded）

GSAP ease 系统已被广泛使用，但全部 hardcode 在 preset 代码里，用户不可控：

| 位置 | 硬编码 ease |
|---|---|
| `entrance.ts` 所有入场效果 | `fadeIn`→`power1.out`、`popIn`→`back.out(1.7)`、`pulseIn`→`power2.out`/`power1.inOut`、`jumpIn`→`bounce.out`、`blurIn`→`power2.out` |
| `behavior.ts:199` fadeShake | `power1.in`（amplitude ramp tween） |
| `stagePresets.ts` 所有相机命令 | `power2.inOut`（`d > 0` 时） |
| `SegmentBuilder.ts:514,531` | `ActiveStageTweenEntry`/`InFlightAnimation` 硬编码 `power2.inOut` |
| `LayoutEngine.ts:305` scroll | `power2.out` |
| `TextPlayer.ts:348` 默认 fadeIn | `power1.out` |

**关键**：`gsap.parseEase` 已在 `SegmentBuilder.ts:90` 用于 seek-trim 计算——缓动感知的 seek-trim 基础设施已存在。GSAP 完整 ease 词表（`power2.inOut`/`back.out(1.7)`/`bounce.out`/`CustomEase`/函数 ease）均可访问。

## 参数管线：ease 如何流达

`EffectConfig.params` 端到端贯通：

```
KMD 语法 f.x(ease=power2.inOut)
  → KMDCommandParser.parseParams: autoConvert("power2.inOut") → 字符串 "power2.inOut"
  → EffectProcessor.resolveParams: 原样传递（非 var.* 引用）
  → effectManager.apply(target, name, params, true)
  → effect fn(target, params): params.ease === "power2.inOut"
```

**参数形式 `f.x(ease=power2.inOut)` 今天即可用**——解析器的 `parseParams` 已处理 `key=value`，`autoConvert` 保留字符串，`resolveParams` 原样传递。**唯一缺失的是效果函数不读 `params.ease`**。

## Behavior 的 addModifier 机制

`KineticChar.addModifier`（`KineticChar.ts:157`）注册 **逐帧回调** `(time: number) => Partial<TransformOffset>`，非 tween。`update` 方法每 GSAP ticker 帧调用 `syncProperties`，融合三层：
1. 基础布局坐标（`layoutX/Y` + `displayOffset`）
2. 动画层（`animOffset` — GSAP tween 驱动，可 seek）
3. 行为层（迭代 `modifiers`，每个 `mod.fn(time)` 返回偏移量叠加）

### Behavior 能否支持 ease？

**不能直接替换为 tween**——wave（sin）/shake（random）/gravity（物理积分）/rainbow（HSL 循环）是时间连续函数，没有自然"duration"或"ease"。它们刻意在时间线外以 survive seek（由 `registerBehaviors` 重注册）。

**但可以 ease 它的 amplitude/envelope**——`fadeShake`（`behavior.ts:183-202`）已示范此模式：一个 modifier 做逐帧 jitter + 一个 `gsap.to(state, { strength: maxStrength, ease: "power1.in" })` tween ease 振幅随时间。`ease` 参数传入此 side tween 即可实现行为的时间曲线控制。

## 缺失项与改动量

| 缺失 | 改动量 | 修法 |
|---|---|---|
| **entrance 效果硬编码 ease** | ~8 处一行改 | 读 `params.ease ?? "power1.out"` 替代硬编码 |
| **stage camera 硬编码 ease** | ~6 处 | 从 params 读 `params.ease ?? "power2.inOut"` |
| **stage tween record 硬编码 ease** | `SegmentBuilder.ts:514,531` | 用 `config.params.ease` 替代硬编码 |
| **效果函数不读 `params.ease`** | 每个 entrance fn 一行 | `const ease = params.ease ?? "back.out(1.7)"` |
| **behavior ease** | 每效果设计决策 | `fadeShake` side-tween 模式 precedent；ease 传入 side tween |
| **layout transition** | 新效果，非架构改动 | 返回 GSAP tween tween `style.fontSize` → `captureTween` 挂载 |
| **parser 无 `ease` 语法** | 视形式 | 见下 |

## `f.x.ease.f.y` 点修饰符形式

当前 `parseEffectChain` 在 paren-depth 0 的 `.` 上切分，`f.x.ease.f.y` 变成命令 `["x", "ease", "f", "y"]`——`ease` 被当作未知独立命令，而非 `x` 的修饰符。

**两种方案**：

1. **参数形式**（零 parser 改动）：`f.x(ease=power2.inOut)` — 今天即可用，仅效果函数需读 `params.ease`。

2. **点修饰符形式**（需 grammar 改动）：`f.x.ease.f.y` — 需在 `parseEffectChain` 中特殊处理 `ease` 为链修饰符，将其附加到前一命令的 `params.ease` 而非发射自己的 `EffectConfig`。参考 `cam.` 命名空间保护模式（`KMDCommandParser.ts:47`，在切分前替换 `cam.` 为占位符）——类似的 `ease.` 保护 + 后处理 pass 是最干净的路径。

需改文件（点修饰符形式）：
- `parser/KMDCommandParser.ts` — `parseEffectChain` dot-splitter（加 `ease` 修饰符处理）
- `parser/types.ts` — 加 `EaseModifierAst` 或扩展 `EffectConfig.params.ease`
- `parser/lowering.ts` / `ScopeRouter.ts` — 将 ease 附加到前一命令的 params
- `effects/presets/entrance.ts` — 读 `params.ease`
- `stage/stagePresets.ts` — 读 `p.ease`
- `player/SegmentBuilder.ts:514,531` — 用 `config.params.ease` 替代硬编码
- `editor/kmd-lang.ts` — 加 `ease` 到 grammar/autocomplete 命令表

## 各域 ease 支持现状

### 特效 (Effects)

- **Entrance**：结构上完全支持。每个入场效果用 `gsap.to(animOffset, { ..., ease })`，`ease` 已硬编码。读 `params.ease ?? <默认>` 即可暴露给用户。seek 自动按 ease 插值（GSAP `timeline.seek()` 原生支持）。改 ~8 行。
- **Behavior**：连续函数（wave/shake/gravity）无自然 ease，但可 ease amplitude/envelope via `fadeShake` side-tween 模式。每效果设计决策。
- **Filter**：instant filter 无时间维度（静态），不适用 ease。behavior track 的动画 filter（如 rgbShift anim）通过 `addModifier` 驱动 uniform，可 ease 其 amplitude via side-tween。

### 舞台 (Stage)

- 结构上完全支持。`stagePresets.ts` 所有相机命令用 `gsap.to(..., { ease })`，已硬编码 `power2.inOut`。读 `params.ease` 即可暴露。
- `ActiveStageTweenEntry.ease` 已存储并复用 per-tween ease 做 seek-trim（`SegmentBuilder.ts:90` `gsap.parseEase`）。
- 改 ~6 处硬编码 + 2 处 record 创建。

### 排版 (Layout)

- 当前 layout/style 命令（`size`/`big`/`small`）瞬时应用 `TextStyle`，无 tween、无 duration、无 ease。
- 架构支持 tweened layout：新效果函数返回 GSAP tween → `captureTween` 挂载到时间线 → seek 自动插值。
- 需要新建"eased layout transition"效果（如 `sizeTo`），非架构改动。

## `size(1).ease.size(5)` 的可行性

`size(1).ease.size(5)` 逐渐变大的场景：
1. **新效果 `sizeTo`**（或扩展 `size` 接受 duration）：`gsap.to(char.style, { fontSize: target, duration, ease })` 返回 tween
2. `captureTween` 挂载到时间线 → forward play 自动插值，seek 按 ease 跳转
3. `params.ease` 传入 `gsap.to` 的 ease 字段

架构支持——只是该效果目前不存在。这是效果实现差距，非架构限制。

## 已知边界

- **`tl.call` 和 `tl.set` 无 ease**：瞬时操作，不适用时间曲线。
- **behavior modifier 不能直接变 tween**：连续函数 vs A→B 过渡的语义差异。
- **多段 timeline 的 ease**（如 `pulseIn` 有多个 `tl.to` 段）：`params.ease` 可覆盖主段或全部段——设计决策。
- **layout transition 与 StyleManager 的交互**：StyleManager 同步操作 TextStyle，tweened transition 需绕过 StyleManager 直接 tween style 属性，seek 时需 reset+replay（同 style record 机制）。