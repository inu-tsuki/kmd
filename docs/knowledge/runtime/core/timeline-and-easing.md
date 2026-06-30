# 时间线与缓动架构

> 本文档描述 KMD 运行时的时间线/动画基础设施，以及缓动（easing）时间曲线控制的可行性路径。
> 理解此文档可以判断 ease 参数能否引入到特效、排版和舞台中，以及需要改什么。
>
> **时序指令的 seek replay 模型**（R2-R12 审查提炼）见文末同名章节——引入时序指令链前必读的前提设计原则。
> **审查-修复循环的元方法论**（R8-R12 提炼）见 `lifecycle-invariants.md` §G——为什么同一类问题反复发病、如何预防的框架。

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

## 时序指令的 seek replay 模型（R2-R12 审查提炼）

> 本节从 stage camera 命令（`cam.shake`/`cam.drift`/`cam.reset`）及 instant 特效生命周期的 R2-R12 审查-修复流程中提炼**通用前提**——这些原则不只适用于 cam，未来引入任何"时序指令链"（hold/delay/pause 序列、相机脚本、scene 转场等）都需遵守。cam 专属的生命周期细节（资源类型、不变量、SA 记录）留在 `lifecycle-invariants.md`，此处只记时序层面的设计原则与教训。审查-修复循环的元方法论（为什么反复发病）见 `lifecycle-invariants.md` §G。

### 为什么需要 replay 模型

GSAP `timeline.seek()` 自动插值所有挂载的 tween 到目标位置，但 **`tl.call()` 注册的瞬时指令 seek 跨过时不补触发**。时序指令（cam.reset 的 clearModifiers、cam.shake 的 addModifier、pause/hold 的时长推进）经 `tl.call` 延迟执行——forward play 按时间触发，但 seek 到任意点时这些 call 被跳过，需靠 build 期记录的 **record 数组** 手动重放当前时间点应激活的指令。

当前 KMD 已有四类"不在时间线上、靠 record 重放"的指令：styles（`replayStyles`）、behaviors（`registerBehaviors`）、instant effects（`registerInstantEffects`）、stage modifiers（`replayStageModifiers`）。未来的时序指令链会是第五类，面临同样的 seek-replay 问题。

### 前提设计原则（R2-R12 验证）

引入新时序指令前，逐条确认——这些都是 R2-R12 踩过的坑：

**1. record 必须在 build 期携带已解析的值，replay 只读不重算（F-3）**
record 的 duration/strength/ease 等数值参数，经 `RuntimeValueResolver.resolveNumeric`（解析 `var.*`）在 build 期解析一次写入 record。replay（seek 时）只读 record，不重新解析。否则两套模型（build 期 tween 执行 vs replay 时 record 重算）各算各的，seek 到的点与正常播放到的点视觉不一致——R3-4/R4-3/R5-3/R9-Medium 全是这条的违反。**`resolvePauseDuration`（SA-19 抽的 helper）也须走 `resolveNumeric` 而非 `Number()`**——SA-25 修了它漏解析 `var.*` 的同源债。

**2. duration 的提取必须按命令语义，不能用通用 params[N]（SA-11）**
不同命令的 duration 在 params 的不同位置：`cam.shake(strength, duration)` 是 `params[1]`，`cam.drift(speed)` 的 `params[1]` 是 speed 不是 duration，`pause(duration)` 是 `params[0]`。提取 duration 必须按命令专用的 `getXxxDuration` helper，不能用通用 `Number(params[1])`——会把 speed 当 duration。未来时序指令的 duration 提取同理。

**3. seek 落点的状态判定必须单一真相源，不能各路径各判一次（F-2）**
seek 落点播放状态（playing/paused/ended）是 resume vs settle 的决定因素，必须过单一 helper（`PlaybackController.derivePhase`）。散落各处的 `isAutoPlaying && progress<1` / `tl.progress()>=1` 判定会漏子态——R5-1 加 gate 漏 R6-1 seek-to-end，R6-1 漏 R7-1 settle 落地。**状态机的"读"（derivePhase 识别状态）与"写"（settleEnded 落地状态）是两件事，缺任一都会让识别出的状态变成幽灵态**——R7-1 修了 seek 到尾不落地 ended。

**4. clear-all 类指令的 replay skip 须双维度：时间 + 创建序（SA-24 / R8-1→R8-3→R10→R11）**
带 duration 的 clear 类指令（如 cam.reset 的 clearModifiers）在 reset tween **末尾**（`effectiveTime = timePosition + duration`）才清——与正常播放对齐。replay 的 skip 条件是**双维度合取**：
- **时间维度** `timePosition < effectiveTime`：clear 动作前已 apply 的 modifier（resetDuration>0 时覆盖窗口内与 reset 前）。
- **创建序维度**（仅 `timePosition === effectiveTime` 时生效）：`record.sequence <= boundarySequence`——resetDuration=0 时 `effectiveTime === timePosition` 时间维度失效，或 `>>>` overlap 时不同 timePosition 但同 effectiveTime，此时只有创建序能判"reset 之前 apply"。**创建序必须是 build/push 顺序（`StageModifierRecord.sequence`），不是 ordered 索引**——stable sort 只在同 timePosition 保留 push 顺序，不同 timePosition 会被打乱（R11 教训）。

R8-R11 经五轮踩坑，每轮都因单维度/近似漏一侧：
- `<= effectiveTime` 漏了"reset 结束点新开始的 modifier"（R8-1）
- `< boundary.timePosition` 漏了"同 timestamp、reset 前创建的"（R8-2）
- `i <= boundaryIndex`（仅创建序）漏了"reset 动画窗口内 apply 的"（R8-3）
- `timePosition < effectiveTime`（仅时间）漏了"resetDuration=0 同 timestamp 复活"（R10）
- ordered 索引作创建序漏了">>> overlap 不同 timePosition 同 effectiveTime"（R11）

**根因**：clear-all 的语义是"清掉 clear 时刻所有存活的一切"——resetDuration>0 时单一时间维度足够，但 resetDuration=0 或 >>> overlap 退化为同 effectiveTime，时间维度失效，创建序成为唯一判据。且创建序必须是真实 build/push 序（`sequence` 字段），ordered 索引只是同 timestamp 退化的近似。两维度合取才覆盖全部。**多 clear 重叠时取最大 effectiveTime（最近触发的 clear）**（R9-High），同 max 取较大 sequence（更晚 push 的 reset，创建序覆盖更广）。

### clear-all vs clear-before 的语义判别

引入新时序指令时，先判别它的 clear 语义属于哪一类——这决定 replay skip 模型：

| 语义 | 定义 | replay skip 模型 | KMD 实例 |
|---|---|---|---|
| **clear-all** | 在某时间点清掉当时所有存活的状态/modifier | 双维度：`timePosition < effectiveTime` **或**（`timePosition === effectiveTime` 且 `sequence <= boundarySequence`）；多 clear 取 max effectiveTime + 同 max 取较大 sequence | `cam.reset`（resetTl 末尾 `clearModifiers()`） |
| **clear-before**（假说，当前无实例） | 清掉创建序 ≤ 本指令的特定状态 | 需 stable sequence 消歧同 timestamp | （未来若引入"只清自己之前的"指令） |

**关键**：clear-all 在 resetDuration>0 时单时间维度足够，但 resetDuration=0 或 >>> overlap 退化为同 effectiveTime，时间维度失效，创建序成为唯一判据。**创建序必须是 `StageModifierRecord.sequence`（build/push 序），不是 ordered 索引**——stable sort 只在同 timePosition 保留 push 顺序，不同 timePosition 会被打乱（R11 教训）。先读 preset 实现：clear 动作调的是 `clearModifiers()`（全清）还是 `removeModifier(name)`（指定）？全清就是 clear-all。

### 阻塞 vs 非阻塞指令对 timePosition 的影响（R8-3 / R9-High 揭示）

时序指令的 `blocking` 标志决定它是否推进 build 期 cursor：
- **blocking**（`config.blocking && result instanceof Tween/Timeline`，SegmentBuilder.ts:708）：cursor 推进 `result.duration()`，下一条指令的 timePosition > 本指令 effectiveTime → 无同 timestamp 歧义。
- **非 blocking**：cursor 不推进，后续指令可落在 `[timePosition, effectiveTime)` 窗口内 → 这些指令在正常播放时会被本指令的 clear-all 清掉，replay 必须也 skip 它们（`timePosition < effectiveTime` 覆盖）。

未来时序指令链若有 blocking/非 blocking 混用，replay 模型必须处理非 blocking 窗口内的指令——不能用"blocking 保证无窗口内指令"假设（R8-1 错误假设过）。

### ease 与 replay 的交叉点

cam.shake 的衰减是 timeline 内 tween（`gsap.to(state, {s:0, ease: power2.out})`），replay 到 shake 中途时需用 `gsap.parseEase(easeName)` 求剩余强度——**ease 名在 build 期写入 record（F-3），replay 用同源 ease 函数算**，不硬编码公式。R3-4 发现 GSAP `power2.out` 实为 `1-(1-t)^3`（不是 `^2`，§B-bis），硬编码会与 timeline 执行漂移。

**未来时序指令若带 ease**：ease 名必须进 record，replay 时用 `gsap.parseEase(record.easeName)` 求值——这是 ease 参数管线（见上"参数管线"节）与 replay 模型的交叉点。ease 不能只在 build 期 tween 里，replay 时拿不到就会漂移。

### 回归测试要求（SA-23/R8 教训）

时序指令的 replay 逻辑必须持久化回归测试，且**覆盖语义的全部边**：
- R8-2 测了"同 timestamp"没测"窗口内" → R8-3 漏网
- R8-3 测了"单 reset"没测"多 reset 重叠" → R9-High 漏网
- 每轮只测复现的那一侧，下一轮从另一侧漏

`pnpm test:playback`（`final-playback-test.ts`）已用真实 `gsap.timeline()` + 结构合法的空 segment 驱动（pixi v8 headless 可测，§B-bis），可 import 真实 `PlaybackController`。未来时序指令的 replay 逻辑应加 case 到此文件——不要用一次性 node 探针（R3-R7 的"逻辑复制探针"是不必要摩擦，验证完即丢，阻止不了回归）。

### 给未来时序指令链的检查清单

引入新时序指令（或扩展现有时序指令的行为）时，逐条确认：

1. **record 携 build 期已解析的值**？duration/strength/ease 经 `resolveNumeric` 在 build 期写入 record，replay 只读（前提 1）。
2. **duration 提取按命令语义**？专用 helper，不用通用 `params[N]`（前提 2）。
3. **seek 落点状态判定过 `derivePhase`**？不散落 `isAutoPlaying`/`progress` 字面量（前提 3）。
4. **若是 clear 类指令**：判别 clear-all vs clear-before；clear-all 用双维度（`timePosition < effectiveTime` 或同 effectiveTime 的 `sequence <= boundarySequence`），多 clear 取 max effectiveTime + 同 max 取较大 sequence（前提 4）。**创建序须用 `StageModifierRecord.sequence`（build/push 序），非 ordered 索引**——resetDuration=0 或 >>> overlap 时时间维度失效，创建序必需且须是真实 build 序。
5. **blocking/非 blocking**：非 blocking 时 replay 处理窗口内指令，不假设"无窗口内 record"。
6. **若带 ease**：ease 名进 record，replay 用 `gsap.parseEase` 求值（ease 交叉点）。
7. **回归测试覆盖语义全部边**：不只测复现的那一侧，加 case 到 `final-playback-test.ts`（SA-23 教训）。
8. **instant 特效 cleanup 模型覆盖所有副作用子类**：同类 `track:"instant"` 下可能有两种副作用——filter 特效返回 `Filter` 实例（cleanup = 从 `target.filters` 移除 + destroy），Graphics 特效返回 `void`（画到持久 `Graphics` 层，cleanup = `g.clear()`）。`InstantCleanup` 须同时支持 `filterInstance` 与 `graphicsLayer` 通道（R12/SA-26）。新增 instant 特效时确认它返回 filter 还是 Graphics，后者走 `graphicsLayer` 通道（`mutexGroup` 作层名）。**守卫 `typeof target.getGraphicsLayer === "function"` 依赖真实 target 的能力**——`TokenWrapper` 与 `KineticText` 都须实现 `getGraphicsLayer`（R12-block/SA-27：`KineticText` 补同构层 API），否则 block 级 Graphics 特效静默失效。回归守卫/能力检查类逻辑须用真实 target 验证，fake 替身满足守卫会掩盖真实 target 不满足。
9. **reset（清理）窗口与 apply（生效）窗口必须解耦**：record 驱动重放的资源，其 reset 阶段覆盖**所有曾在 record 中出现的目标**（清回 base/快照），apply 阶段才按 `timePosition <= currentTime` 过滤。**两者不能共用同一时间过滤**——seek 可回退意味着"已生效"≠"当前时间生效"，生效点之后应用的样式不会随 seek 回退自动消失（不像 entrance tween 靠 timeline 插值）。`replayStyles` 曾把两者共用 `timePosition <= currentTime`，seek 回退到样式生效点之前时 reset 窗口落空 → 样式残留（R13/SA-28）。判别：资源在 timeline 上（entrance tween）→ seek 插值自动回退；资源在 record 上（style 快照 / behavior modifier / instant filter / Graphics 层）→ reset 必须显式覆盖。回归须测 **seek 双向**——既测"推进到生效点之后"也测"回退到生效点之前"。
10. **reset 责任必须覆盖所有操作路径**：同一种 record-driven 资源的清理散落在多条操作路径（`seekToTime` / `playSegment`-ended / `stop` / `clearScreen`）。抽了 reset helper（如 `replayStyles`）后，必须审计所有"apply 或重置该资源"的路径是否都调到了它——任一路径手写一份清理就漏（R14/SA-29：ended 重播分支只清了 behavior/instant/modifier，漏了 style，因 `replayStyles` 只在 `seekToTime` 调）。特别地：凡"回到时间起点"的操作（ended 重播 / stop / 重 load）必须与 `seekToTime(0)` 的最终态对齐。回归要为每条这样的路径单独加 case，不只测 `seekToTime` 一条。
11. **reset baseline = 构建期烘焙态，构建期初始样式不进 record 重放集合**：构建期烘焙进字符的初始样式（如 `f.red` / `f.big` 在 `LayoutPlanner.applyInitialStylesToStyle` 烘焙）是字符的**起始状态**（进 baseline 快照），不是"运行时才生效的动态变更"（不进 `StyleRecord` 重放集合、不 `tl.call` 重上）。reset baseline 必须在构建期烘焙**之后**捕获（= 烘焙态，不是原始 base）。否则同一种样式在三处语义身份矛盾：构建期说"初始态"、record/tl.call 说"动态变更"、baseline 说"不存在"——绝对样式（red）幂等无害，相对样式（big/small: `fontSize *= 1.5`）重复放大（build 24→36 + replay/chain 36→54）（R15/SA-30）。判别：资源是构建期初始态（进 baseline，不重放）还是运行时动态变更（不进 baseline，进 record/tl.call）——二选一，不让同一资源在多处既是初始态又是变更。构建期数据流（如 `DisplayAssembler` 的 baseline 捕获）须用真实对象/真实代码验证，fake char 的手写契约会掩盖真实路径差异（SA-27 教训：`final-playback-test.ts` §11 fake + §11b 真实 KineticChar 双层覆盖）。
12. **"初始样式进 baseline"覆盖所有构建期写入路径**：pre-hold 初始样式有两条构建期写入路径——(a) `DisplayAssembler` 烘焙（`LayoutPlanner.applyInitialStylesToStyle` → `glyphPlan.style` → KineticChar 构造捕获 baseline，R15 修）；(b) `SegmentBuilder` 的 `applyGroupEffects` 同步应用（构造**之后** `applyStyleRecursively` force=true 写 char.style，baseline 已固化，R16 修：调 `recaptureBaseStyleSnapshot` 重新捕获）。block/global 初始样式（如 `[.red:block]`）走 (b)，若不 recapture，后续动态样式 record 触发 `replayStyles` 的 `resetStyle()` 回 baseline（无 block 样式）→ block 样式丢失（R16/SA-31）。修一条构建路径不等于修全部——凡为资源建立"进 baseline"语义，审计所有构建期写入路径（不止运行期操作路径）是否都纳入。
13. **style 资源身份判定经单一真相源分流（R17/SA-32）**：所有 style 写入路径（P1-P5）的"是样式吗 + 是 pre-hold 边界吗"判定经 `EffectProcessor.classifyStyleWrite(config) → {isStyle, isBlocking}` 单一真相源，调用方维护 `holdEncountered` 游标算 isInitial/isDynamic。消除散落各处的独立判定（SA-31 复发条件）——未来新增第六条 style 写入路径经 helper 分流即可。replayStyles 不做身份判定，只消费 baseline + record 集合（职责分离由 P1-P4 经 helper 保证）。回归须有**端到端真实管线**测试（§13：parser→SegmentBuilder→seek，headless shim 三件套见 `lifecycle-invariants.md` §B-bis-2「Headless 端到端管线测试配方」）——fake char 测试会掩盖真实管线的类型/默认值差异（Pixi Fill 对象 vs 字符串、KineticText 默认 fontSize 36 vs 24），真实管线才暴露（SA-27 教训：fake 满足语义≠真实代码满足）。
14. **收敛散落判定时独立验证被收敛逻辑的正确性（R19/SA-33）**：从既有代码提取单一真相源 helper 时，"收敛散落逻辑" ≠ "背书该逻辑正确"——若被收敛的判定本身有 bug，收敛只会让 bug 更隐蔽（五处一致地错）。R17 把 `classifyStyleWrite` 收敛时把 v1.0.0 遗留边界表达式（`level==="group"/"block"` 终止烘焙）原样固化，但该规则对 **style** 是错误的（style 经 applyStyleRecursively 落到每个 char，不分容器/逐字语义，不应被 level 边界终止）→ 显式 `f.red:group` / token 级 `f.red:block` 既不进 baseline 也不进 record，被吞。判别：style 身份与"非 style 容器级特效边界"必须解耦（`isStyleScoped = isStyle && (level group/block)`；`isBlocking = !isStyleScoped && (...)`）——该边界只对非 style（filter/timing/stage）生效。回归须覆盖**每个 level 变体**（char/group/block × style/filter）+ pre-hold vs post-hold，不只测最常见的 char 级（§14：f.red:group / f.red:block / f.big:group / post-hold 组合）。
15. **exact-boundary 的 apply 驱动所有权：快照消费者单一拥有当前态，tl.call 让位（R22/SA-37）**：seek 落在 record.timePosition 上、随后 `tl.play()` 时，GSAP deferred tick 跨越 boundary 会重触发同一 record 的 `tl.call`，与 seek 的 `register*`/`replayStyles`/`replayStageModifiers` 双 apply（pixelate/blur 双 push filter、big ×1.5 两次=×2.25 几何错）。**根因不是去重逻辑错，是 exact-boundary 上两个 apply 驱动撞车、所有权未定义**——seek 是"展示态快照"语义、play 的 tl.call 是"时间推进触发"语义，边界点属于快照态。**GSAP tl.call 触发语义**（探针验证 2026-06-30，gsap 3.14.2）：`tl.call(fn,[],t)` 在 ticker tick 上、当 `tl.time()` 跨越 t（从 =t 推进到 >t）那一刻触发，**不是** `tl.play()` 同步触发；`isAutoPlaying` guard 拦不住（play 前已置 true）、flip-the-guard（false→play→true）也拦不住（call deferred 到 tick，flip 在 play() 返回时已恢复 true——探针 D1 验证）。**修复**：`seekToTime` 与 `playSegment` 末设 `state.lastSeekTime = 目标时间`，所有 boundary `tl.call` guard 检查 `record.timePosition === state.lastSeekTime` 则跳过——ownership-flag 在 play() 与 deferred tick 之间存活（探针 M1 验证）。**这是项目"靠构建期分工不靠运行时判重"约定的有状态例外**——GSAP deferred 语义使构建期让两驱动不撞车在 exact-boundary 上不可能（seek 与 play 共享同一 tick 跨越事件）。**playSegment 统一驱动**：去掉原 `tl.time()>0` gate，所有路径（t=0 fresh-build / t=0 ended-replay / t>0 resume）统一调 `register*` + `replayStyles` + `replayStageModifiers` 单一拥有当前态，tl.call 让位。回归须测 seek-then-play 的 boundary 双 apply（A/B/C: filter 双 push、style 双 mutate）+ 对照 seek-非-record-时间 play 正常 apply（D）+ GSAP deferred 前提探针（锁定 load-bearing 假设，防 gsap 升级静默破坏）。

这些原则的代码实例与 SA 记录见 `lifecycle-invariants.md` §F / SA-24 / SA-25 / SA-26 / SA-27 / SA-28 / SA-29 / SA-30 / SA-31 / SA-32 / SA-33 / SA-37 / SA-38。