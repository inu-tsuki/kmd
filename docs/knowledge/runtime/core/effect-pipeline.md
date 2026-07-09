# 特效管线：从 EffectConfig 到屏幕

> 本文档描述视觉特效从解析到渲染的完整管线。
> 理解此文档可以避免 `instanceof` 守卫、`targetType` 不匹配等常见问题。
> **生命周期不变量合约**见 [`lifecycle-invariants.md`](./lifecycle-invariants.md)——操作路径硬约束 + 资源覆盖矩阵 + 新增特效检查清单。

## 特效元数据 (meta)

每个特效在 `presets/` 目录的分类文件中（`behavior.ts`/`entrance.ts`/`filter.ts`/`visual.ts`/`timing.ts`，由 `presets/index.ts` 用 `export *` 聚合）通过 `defineEffect(fn, meta)` 注册。

> **注意**：`defineEffect` 是每个 preset 文件内联的本地 helper（`presets/filter.ts:7`），不从外部 import；新 preset 必须写进既有分类文件或新建文件并在 `index.ts` 加 `export *`。`EffectManager` 构造时 `registerBatch(Presets)` 自动注册，**无需改 `Parser.validate()` 白名单**——`f.xxx` 命令经 `registryView.has()` 链自动 known。

```typescript
export const wave = defineEffect(_wave, {
  type: "behavior",       // behavior | action
  track: "behavior",      // entrance | behavior | instant | timing
  targetType: "char",     // char | group | both
  mutexGroup: "position", // 同 mutex 组互斥
  stackable: true,        // 允许同 mutex 叠加
});
```

**`targetType` 决定 apply 时的目标对象**：
- `"char"` → `effectManager.apply(kineticChar, ...)` — 特效实现内有 `instanceof KineticChar` 守卫
- `"group"` → `effectManager.apply(tokenWrapper, ...)` — 作用于容器
- `"both"` → 同时支持 char 和 group/container

## 四轨分类 (`EffectProcessor.classifyByTrack`)

| Track | 时间驱动 | seek 行为 | 典型特效 |
|-------|---------|----------|---------|
| `entrance` | gsap Tween (一次性) | GSAP 自动插值 | fadeIn, slideUp, punch |
| `behavior` | Ticker 回调 (持续) | `registerBehaviors(t)` 重注册 | shake, wave, rainbow, blur, rgbShift, warp |
| `instant` | 立即执行 (一次性) | style 经 `StyleRecord` 重放；filter 经 `InstantEffectRecord` 重放 | red, bold, font (style) / pixelate (filter) |
| `timing` | cursor 控制 | Timeline 位置隐含 | hold, pause |

> **`instant` track 说明**：原是“死桶”——`TextPlayer.placeCharOnTimeline` 只读 `.behavior`/`.entrance`，`instant` 滤镜 fn 永不执行。现已修复：非 style 的 instant 特效（如静态 filter）经 `InstantEffectRecord` 收集，seek 时由 `PlaybackController.registerInstantEffects` 从 `target.filters` 重置后 force 重 apply，靠 fn 返回的 filter 实例做幂等清理。`InstantCleanup.filterInstance` 支持 `Filter | Filter[]`（组合预设 return 数组）。现有 blur/rgbShift/warp 因含可选 `addModifier` 动画仍填 `behavior`；纯静态滤镜（pixelate 及 M1 的 gray/threshold/posterize/duotone/sharpen/emboss/edge/outline/bloom/halftone）用 `instant`。**block 作用域 filter 也经 `SegmentBuilder` 路由进 record + `segmentTl.call`**（与 char/group 路径对称，非 `applyGroupEffects` 同步挂载）——instant 进 `InstantEffectRecord`、behavior 进 `BehaviorRecord`，char/group/block × instant/behavior 六路径 seek 幂等均覆盖。

> **`behavior` track filter cleanup 说明**（M2 准备修复）：behavior-track filter（blur/rgbShift/warp 及 M2 displace/dissolve/scanline/noise/underwater）除 `addModifier` 外还会把 filter push 进 `target.filters`。原 `clearBehaviors` 只 `removeModifier`、不碰 filters → 每次 seek 累积一个 filter + stop/clearScreen 时 GPU 资源不释放。现已修复，与 instant 路径对称：
> - **fn 返回值契约**：char 级 fn `return filter`（`Filter | Filter[]`）；容器级（`:group`/`:block`，无 `addModifier`）fn `return { filters, tickerFn }`（`BehaviorFilterResult`），ticker 回调驱动 `uTime`/`uProgress`，cleanup 时 `gsap.ticker.remove(tickerFn)`。**`Filter[]` 首次实战**：M2 `underwater` 组合预设 char 级 `return { filters: [...] }`（无 tickerFn，addModifier 驱动）/ 容器级 `return { filters: [...], tickerFn }`——`unpackBehaviorResult` 经 `'filters' in result` 分支捕获数组，`clearBehaviors` 的 `Array.isArray` 分支逐个移除+`destroyFilterDeep`。回归覆盖见 `final-playback-test.ts` [20.5]。
> - **`BehaviorCleanup`** 扩展 `target?`/`filterInstance?`/`tickerFn?`；`clearBehaviors` 在 `removeModifier`（守卫：仅 KineticChar 有此方法）之外，从 `target.filters` 移除 filter + 深销毁（见下文 `destroyFilterDeep`）+ 移除 ticker。
> - **容器级 animation 驱动**：`addModifier` 是 KineticChar 专属；容器级用 `gsap.ticker.add(fn)` 注册回调更新 filter uniform（与 `addModifier` 同源，都是 `gsap.ticker`）。char 级与容器级在 fn 内按 `target instanceof KineticChar` 分走两条路，cleanup 统一由 `clearBehaviors` 处理。
> - **group-scope behavior 进 cleanup**：原 `unrollGroupChain` 容器级 behavior 用独立 `tl.call` 且不 push `behaviors` → seek 不重 apply、无 cleanup。现改为 push `behaviors`（`target = wrapper`），经 `SegmentBuilder` 统一 `tl.call` + `registerBehaviors` seek 重注册，与 char 级对称。
> - **block-scope behavior 进 cleanup**：原 `SegmentBuilder` 只把 block 级 instant filter（`blockInstant`）分流进 `InstantEffectRecord`，behavior filter（`blur:block(anim=true)` 及 M2 `displace/underwater:block`）落 `blockRemaining` → 同步 `applyGroupEffects` 执行，但 fn 返回的 `{ filters, tickerFn }` 被 `applyGroupEffects` 丢弃，不进 `activeBehaviorCleanups` → seek/stop/clearScreen 清不到 filter + ticker 泄漏（打在 M2 underwater 关键路径）。现补 `blockBehavior` 分支：**分流条件为 `track === "behavior"`**（非仅 `type === "filter"`），覆盖两类——`type:"filter"+track:"behavior"`（blur/rgbShift/warp/M2 displace/underwater）和 `type:"behavior"+track:"behavior"`（`shake:block` 用 `ContainerBehaviorOffset` 返回 `{ tickerFn }`）。原条件只认 `type:"filter"` → `shake:block`（`type:"behavior"`）落 `blockRemaining` → `addContainerOffset` 启动 ticker 但返回值被 warn 后丢弃 → ticker 泄漏（审计修复）。`dim`/`shift`/`glitch` 也 `track:"behavior"` 但容器分支处理不同：`dim` 容器分支用 `restoreProps` 机制（写 `target.alpha` 后记录原始值，`clearBehaviors` 恢复，seek 不残留半透明）；`shift`/`glitch` `targetType:"char"` 对容器跳过，进 record 后解包 `result=undefined` 不进 cleanup，安全。behavior 特效路由进 `BehaviorRecord`（`target = char = paragraphText`）+ `segmentTl.call`（解包 `BehaviorFilterResult`/tween/offset，与 char/group behavior 路径同构），seek 由 `registerBehaviors` 重 apply。
> - **容器级 offset 叠加（`ContainerBehaviorOffset`）**：容器级（`TokenWrapper`/`KineticText`）原无 offset 机制，`shake:group`/`:block` 只能直接 tween `target.pivot`。但 `pivot` 是布局中心值（`TokenWrapper` 构造时设为几何中心、`KineticText.position` 由段落定位写入），tween 污染后 `kill()` 不恢复 → seek/stop/clearScreen 后永久错位。`ContainerBehaviorOffset`（`core/ContainerBehaviorOffset.ts`）提供与 `KineticChar.modifiers` 对称的机制：`addOffset(id, fn)` 注册逐帧 fn（返回 `{x?, y?}`），首次注册时快照 `position` 为 base、启动 ticker 每帧 `position = base + sum(offsets)`；`removeOffset(id)` 移除 fn，offsets 清空时恢复 `position = base` 并惰性停 ticker。**仅支持 position（x/y），不支持 alpha**——ticker 每帧覆盖 `target.alpha` 会与 timeline alpha 动画（如 blurIn 0→1）冲突。用 `WeakMap` 绑定实例，不污染容器类。`shake` 容器分支改用 `addContainerOffset("shake", fn)` 返回 `{ tickerFn }`（`BehaviorFilterResult` filters 可选）纳入 ticker cleanup；`clearBehaviors` 调 `removeContainerOffset(offsetTarget, modName)` 恢复 position + 移除注册。ticker remove 只停驱动，不恢复 position 且注册残留会污染下次 apply（base 快照基于错位 position），故 offsetTarget 字段独立于 tickerFn cleanup。容器级 alpha 行为（`dim:group`/`:block`）用 `restoreProps` 机制（一次性写 `target.alpha` + 记录原始值 + cleanup 恢复），不走 ticker 叠加——避免与 timeline alpha 冲突。
> - **容器级属性恢复（`restoreProps`）**：`dim:group`/`:block` 写 `target.alpha = alpha` 后返回 `{ restoreProps: { target, props: { alpha: baseAlpha } } }`，`BehaviorCleanup` 携带 `restoreProps?`，`clearBehaviors` 遍历 props 写回 target。seek 时 `registerBehaviors` 先 `clearBehaviors`（恢复原始 alpha）再重 apply（写新 alpha），stop/clearScreen 时恢复后 destroy 容器。**不与 timeline alpha 冲突**——restoreProps 是一次性属性写入 + 一次性恢复，不持续驱动；timeline alpha 动画（blurIn）在每帧由 gsap 驱动，restoreProps 只在 clearBehaviors（seek/stop/clearScreen）时写回，不在每帧覆盖。
> - **`clearScreen`** 原只调 `clearInstantEffects`，现补调 `clearBehaviors`（与 `stop` 对称），避免 behavior filter + ticker + offset 在清屏后泄漏。

> **Filter 深销毁（`destroyFilterDeep`）**：`clearBehaviors` / `clearInstantEffects` 调用此 helper 而非裸 `filter.destroy()`。Pixi v8.15 的 `BlurFilter` 持有公开的 `blurXFilter` / `blurYFilter`（`BlurFilterPass`）且自身未 override `destroy()`——只 destroy 外层会泄漏这两个内部 pass 的 `GlProgram`/bind group。`BloomFilter.destroy()` 已自行处理其内部 `_extractFilter`/`_blurFilter`（含 `blurXFilter`/`blurYFilter`），但 `f.blur` 返回的是裸 `BlurFilter`（behavior 路径）裸销毁会泄漏 X/Y 子 pass。`destroyFilterDeep` 统一先销毁 `blurXFilter`/`blurYFilter`（若存在）再 destroy 外层，behavior/instant 两路径共用，seek churn / stop / clearScreen 的 GPU 释放均覆盖。其他持有内部子 filter 的滤镜（M2 underwater 的 displace+tint+blur 组合里的 blur 同此）也由该 helper 覆盖。

## 三路分流 (`EffectProcessor.partition`)

```
EffectConfig[]
  ├─ layoutManager.has(name) → layoutCmds[]      (goto, offset, mark...)
  ├─ stageManager.has(name)  → stageConfigs[]     (cam.move, pause...)
  └─ 其余                    → visualConfigs[]    (shake, red, fadeIn...)
```

## 管线路径

### 路径 A：per-token 特效 (`f.xxx` 或 `.xxx` 视觉)

```
token.effects: EffectConfig[]
  │
  ├─ LayoutStreamBuilder.build()
  │   └─ partition() → layoutCmds 进 stream, stageConfigs 进 charData
  │
  └─ TextPlayer.buildTimeline()
      └─ 在 token 末字符触发 unrollGroupChain():
          │
          ├─ isCharLevel (targetType === "char" 或 "both"，或显式 :char):
          │   └─ wrapper.chars.forEach(char => effectManager.apply(char, ...))
          │      根据 track:
          │        entrance → gsap Tween 挂到 tl
          │        behavior → behaviors[] (后续 registerBehaviors)
          │        instant  → instantEffects[] (SegmentBuilder.segmentTl.call 按 record 触发 apply；seek 时 registerInstantEffects 重放)
          │
          └─ 容器级 (显式 :group / :block，或 targetType === "group" / type === "action"):
              └─ effectManager.apply(wrapper, ...)
```

> **`targetType` 是能力描述，不决定默认目标**：`"both"` 默认走逐字 char 路径（`{...} @ f.x` 仍逐字），
> 要容器级必须显式 `:group`（`f.x:group`）或 `:block`（`[.x:block]`）。`targetType:"group"` 才默认容器级。

### 路径 B：paragraph/global 特效（显式 `:block` 或段落级布局/舞台）

```
pData.globalEffects: EffectConfig[]
  │
  ├─ LayoutStreamBuilder.build()
  │   └─ partition() → layoutCmds 进 stream 头部
  │
  └─ ScriptPlayer.buildSegment()
      └─ partition() → visualConfigs:
          segmentTl.call(() => {
            applyGroupEffects(kt, visualConfigs)
          }, [], segmentCursor)
```

**注意**：`applyGroupEffects(kt, ...)` 的 target 是 KineticText (Container)。
因此只有显式要求 paragraph/container 语义的命令才应该走这条路径，例如 `[.shake:block]` 或段落级布局/舞台命令。

默认 block option 视觉命令（如 `[.rainbow]`、`[.wave]`）现在会在 `lowering.ts` 中先广播到整段 text targets，
再走路径 A 的逐 token 路径，以保留 char/group 的默认 target 行为。

## 字符级特效与 style 资源管线（R15–R18 现状）

> 本节沉淀 R13–R18 的修复结论：style 特效是唯一一条**跨构建期 + 运行期、跨多条写入路径**的管线。
> 理解 baseline 与 record 的职责分离是避免 INV-7（"初始态 vs 动态"判定散落）复发的关键。
> **审查 / 自审计细节**见 [`lifecycle-invariants.md`](./lifecycle-invariants.md)（SA-28…SA-32）+
> [`docs/planning/runtime/style-baseline-self-audit-r13-r16.md`](../../../planning/runtime/style-baseline-self-audit-r13-r16.md)（P1–P7 写入路径矩阵）。

### 字符级特效按四轨路由（`TextPlayer.placeCharOnTimeline`）

每个字符在揭示时间点 `cursor` 经 `placeCharOnTimeline`（`TextPlayer.ts:277`）统一处理。
特效经 `EffectProcessor.classifyByTrack`（`EffectProcessor.ts:105`）分四条 track：

| track | 处理 | 进 baseline? | 进 record? | tl.call? |
|-------|------|:---:|:---:|:---:|
| **style**（`red`/`big`/`bold`/`font`…） | pre-hold 部分构建期烘焙（见下"style 管线"）；post-hold 部分经 site 2/3 处理 | 初始→✓；动态→✗ | 初始→✗；动态→✓ | 动态→✓ |
| **behavior**（`shake`/`wave`/`blur`…持续） | 无 hold 链时注册 `BehaviorRecord@cursor`（`:309-319`）；hold 链时由 `unrollCharChain`/`unrollGroupChain` 处理 | ✗ | ✓（`BehaviorRecord`） | ✓（`segmentTl.call`） |
| **instant**（静态 filter 一次性挂载） | 无 hold 链时注册 `InstantEffectRecord@cursor`（`:328-337`）；style 经 `classifyStyleWrite(cfg).isStyle` 跳过（`:328-329`，R17） | ✗ | ✓（`InstantEffectRecord`） | ✓ |
| **entrance**（入场动画） | 第一个 `mutexGroup==="enter"` 作 `enterConfig` → `effectManager.apply` 出 tween 挂 tl（`:356-362`）；其余 entrance 同样挂 tween（`:373-375`） | ✗ | ✓（`EntranceFilterRecord`，`captureEntrance`） | ✓（`tl.add`） |

> `timing` / `stage` 经 `timingSugars` 与 `TextStageCueScheduler` / `stageConfigs`，不进 `placeCharOnTimeline`。

**hold 链对 char 级路由的影响**（`placeCharOnTimeline` `:307-308`）：
- `hold:char` → behavior / instant 全部跳过 `placeCharOnTimeline`，交 `unrollCharChain`（**site 3**）逐字错开；
- 组级 hold → 同样跳过，交 `unrollGroupChain`（**site 2**）在链时间点统一分流到 char 或 container。

### style 管线：baseline 与 record 的职责分离

核心契约（R15/R16 收束后）：

- **初始态样式**（pre-hold / block 全量）→ 进 **baseline**（`KineticChar.baseStyleSnapshot`），**不进 record、不 `tl.call`**。
  seek 时 `resetStyle()` 回 baseline 即恢复初始态。
- **动态样式**（post-hold）→ 进 **record**（`StyleRecord[]`），**不进 baseline**，经 `tl.call` 在生效点写 `char.style`。
  seek 时按 `timePosition <= currentTime` 重放。
- **seek 重放** = reset 回 baseline（恢复初始）+ 重放 record（恢复动态）。

> 相对样式（`big` ×1.5 / `small` ×0.8）的**双重放大隐患**：若初始样式既进 baseline 又进 record，seek 重放会从 baseline 再 apply 一次。
> R15/R16 把初始样式**只烘焙进 baseline、不进 record**彻底消除此隐患。

### 单一真相源：`EffectProcessor.classifyStyleWrite`

```
EffectProcessor.classifyStyleWrite(config) → { isStyle, isBlocking }   // EffectProcessor.ts:369
```

- `isStyle = styleManager.has(config.name)` —— 是否是 style 特效。
- `isBlocking`（非 style 时）= `hold || config.blocking || level==="group" || level==="block"` —— pre-hold 边界。

> **R19/SA-33（style vs 非 style 边界解耦）**：style **不受** `level==="group"/"block"` 边界阻断——
> `isStyleScoped = isStyle && (level group/block)`；`isBlocking = !isStyleScoped && (...)`。
> 原因：该边界是 v1.0.0 遗留、给**非 style 容器级特效**（filter/timing/stage）终止烘焙的规则（它们不该折叠进逐字初始快照）；
> 但 style 经 `applyStyleRecursively` 最终落到每个 KineticChar，不分容器/逐字语义，应与 char/block 同模型进 baseline + 测量。
> R19 前显式 `f.red:group` / token 级 `f.red:block` 因这个边界既不进 baseline（P1 break）也不进 record（site2 跳过），被整条吞掉。

P1–P4 全部经此 helper 判定 `isStyle` + pre-hold 边界，调用方维护 `holdEncountered` 游标算 `isInitial`/`isDynamic`
（`isInitial = isStyle && !holdEncountered`；`isDynamic = isStyle && holdEncountered`）。
这是 R17 的架构收敛点——消除 R15 前散落各处的独立 style 判定（SA-30/31 的复发条件）。
`replayStyles`（P5）**不做**身份判定，只消费 baseline + record 集合。

### style 的五条写入路径（P1–P5）

| 路径 | 位置 | 触发时机 | 写 baseline? | 写 record? | 说明 |
|------|------|---------|:---:|:---:|------|
| **P1** LayoutPlanner 烘焙 | `LayoutPlanner.ts:88` `applyInitialStylesToStyle(measurementStyle, ...)` | 构建 pre-hold 区 | ✓（force=false 烘进 `measurementStyle` → `glyphPlan.style` → `KineticChar(text, glyphPlan.style)` 构造捕获 `baseStyleSnapshot`） | ✗ | pre-hold 初始样式（含显式 group/block style，R19/SA-33 解耦后）。R15：`DisplayAssembler.ts:112` 不再用原始 `baseStyleSnapshot` 覆盖（构造已捕获烘焙态）。 |
| **P2** SegmentBuilder recapture | `SegmentBuilder.ts:241-285`（R21/SA-36 重构） | block 链 pre-hold style 经 applyGroupEffects 写后 | ✓（`recaptureBaseStyleSnapshot()`） | ✗ | block/global **pre-hold** 样式。`blockRemaining` 经 `classifyStyleWrite.isStyle` 分流后，R21 再按 pre-hold / post-hold 边界拆：pre-hold style → `applyGroupEffects` 同步写 `char.style`（构造之后）→ `recaptureBaseStyleSnapshot()` 烘进 baseline（R16 模型不变）。**R21 前**：整条 `blockRemaining`（含 `hold`）不 await 丢给 applyGroupEffects → `hold:block` 返回 `gsap.delayedCall` promise，applyGroupEffects 内 await（`:280`）挂起 → recapture 跑在 hold resolve 之前（post-hold 漏 baseline）+ 无 styleRecords（post-hold 既不进 baseline 也不进 record）→ hold 到点后 `applyStyleRecursively` 作为墙钟副作用触发（不播不 seek 自己染红）。R21 把 hold 抽成 cursor 推进（不进 applyGroupEffects）、post-hold style 路由进 P2b。 |
| **P2b** SegmentBuilder block post-hold | `SegmentBuilder.ts:282-301`（R21/SA-36 新增） | block 链 post-hold style | ✗ | ✓（`StyleRecord@chainCursor`） | block/global **post-hold** 样式（链中 `hold:block` 之后的 style）。R21 与 site2（P3）/ site3（P4）同模型：`classifyStyleWrite` 单一真相源判边界，hold 推进 `chainCursor`（构建期不真等，与 `unrollGroupChain` 的 `chainCursor += dur` 一致），post-hold style 经 `segmentTl.call` + `allStyleRecords`。seek 由 `replayStyles`（P5）重放（`segment.timeline.seek` 默认 suppressEvents，tl.call 不触发）；正向播放 segmentTl.call 触发 apply。 |
| **P3** unrollGroupChain site2 | `TextPlayer.ts:500-557` | 组级 hold 链 post-hold | ✗ | ✓（`StyleRecord@chainCursor`） | `classifyStyleWrite(config).isStyle`（R17，`:503`）；`shouldExecute` 里 `if(isStyle) return false`（`:534`）跳过 pre-hold（已在 baseline）。post-hold 经 `tl.call` + 注册 record。 |
| **P4** unrollCharChain site3 | `TextPlayer.ts:677-717` | char 级 hold 链 post-hold | ✗ | ✓（`StyleRecord@charCursor`） | `classifyStyleWrite` 在**原始 visualConfigs**（含 hold:char）上算 `firstBlockingOrigIdx`（pre-hold 边界，R20/SA-35）；`activeEffects` 携带 `origIdx`，`if(origIdx < firstBlockingOrigIdx && isStyle) continue` 跳过 pre-hold 样式（避免 `big/small` 双重放大）。post-hold `tl.call` + 注册 record。**R20**：旧逻辑在过滤后的 activeEffects 上算边界，hold:char 被提前滤掉 → 边界失效 → post-hold style 被吞。 |
| **P5** replayStyles | `PlaybackController.ts:442` | seek / ended 重播 | 消费（`resetStyle`） | 消费（apply） | **只消费不判定**。① reset **所有**有 styleRecord 的 char 回 baseline（R13：不按 currentTime 过滤，`:443-449`）；② 重放 `timePosition <= currentTime` 的 record（`:451-455`）。reset 窗口与 apply 窗口解耦（R13/SA-28）。ended 重播分支也调 `replayStyles(segment, 0)`（`PlaybackController.ts:134`，R14/SA-29）。 |

> R18 删除了两条死代码路径（无调用方，全树 grep 确认）：
> `applyCharEffects`（原 P6）+ `applyInitialStyles`（原 P7，注意 `applyInitialStylesToStyle` P1 是不同的、仍存活的方法）。
> self-audit 文档的残留风险 R-A/R-B/R-C/R-D 全部关闭。

### record 类型

四类 seek 可重放 record（`TextPlayer.ts:21-91`，`timeline-and-easing.md` §161 "四类"）：
`StyleRecord`（char + styleName + params + timePosition）/ `BehaviorRecord` / `InstantEffectRecord` / `EntranceFilterRecord`。
style 管线只涉及 `StyleRecord` 与 `baseStyleSnapshot`，其余三类各自有 register*/clear* 通道（见"特效实现模式"下各 track 的 seek 幂等说明）。

### 一句话总结

**初始态**（pre-hold / block pre-hold）→ P1 烘焙或 P2 recapture 进 baseline，不进 record、不 `tl.call`；
**动态**（post-hold：char 级 → P3/P4；block 级 → P2b）→ 进 record + `tl.call`；
**seek** → reset 回 baseline（恢复初始）+ 重放 record（恢复动态）。
`classifyStyleWrite` 是"初始 vs 动态"身份的单一真相源，`replayStyles` 只消费不判定。

> **R22/SA-37 边界所有权补充**：上面"动态 → record + tl.call"在 **exact-boundary**（seek 落在 record.timePosition 上、随后 play）有一个有状态例外——GSAP `tl.call` 是 ticker tick 跨越时触发（非 play() 同步），故 seek+play 会让 deferred tick 跨越 boundary 重触发同一 record 的 tl.call，与 seek 的 `replayStyles` 双 apply（big ×1.5 两次=×2.25）。修复：`seekToTime`/`playSegment` 设 `state.lastSeekTime`，boundary `tl.call` guard 检查 `record.timePosition===lastSeekTime` 则跳过——快照消费者（register*/replayStyles/replayStageModifiers）单一拥有当前态，tl.call 让位。这是"构建期分工"约定在 GSAP deferred 语义下的必要有状态例外（两驱动共享同一 tick 跨越事件，构建期无法分离）。详见 `timeline-and-easing.md` 检查清单 15 + `lifecycle-invariants.md` SA-37。

## 特效实现模式

### Behavior 特效（KineticChar 上）

```typescript
const _wave: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {        // ← 守卫！
    const offset = params.charIndex || 0;     // ← charIndex 来自逐字分发
    target.addModifier("wave", 'behavior', (time) => ({
      y: Math.sin(time * freq + offset * 0.5) * height,
    }));
  }
};
```

- `addModifier(name, track, fn)` 在 Ticker 每帧调用 `fn(time)`
- 返回的 `{ x?, y?, scale?, rotation?, alpha?, tint? }` 叠加到字符变换
- `charIndex` 参数实现逐字错开效果（波浪、彩虹相位差）
- **modifier id 必须等于 effectName**（!!! 审计修复：`KineticChar.removeModifier(id)` 是 `Map.delete(id)` 精确匹配；`PlaybackController.clearBehaviors` 用 `behavior.effectName` 调 `removeModifier`）。原 `rgbShift→rgbAnim`/`warp→warpAnim`/`blur→blurAnim`/`gravity→physics`/`fadeShake→shake` 五处 id 与 effectName 不一致 → seek/stop/clearScreen 时 `removeModifier(effectName)` 命中失败、modifier 残留继续 tick、写已 destroy 的 filter uniform 抛错或留下错误状态。已统一为 effectName。`fadeShake` 原用 `shake` id 还附带 `Map.set` 同 key 覆盖 `shake` 的隐患（同 char 共存互斥），改为 `fadeShake` 后两者独立 tick 叠加。

### Style 特效（递归应用）

```typescript
EffectProcessor.applyStyleRecursively(target, styleName, params, force)
```
递归遍历 Container 子树，对每个 KineticChar 调用 `styleManager.apply(char, ...)`。
样式直接修改 `char.style`（如 `style.fill = "#ff0000"`），不经过 Ticker。

### Filter 特效（Pixi v8 fragment shader）

参考 `core/filters/RGBSplitFilter.ts`（自写 shader 模板）与 `presets/filter.ts`（preset）：

```typescript
// 1. Filter 类：继承 Pixi v8 Filter + fragment shader（core/filters/XxxFilter.ts）
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";
const fragment = /* glsl */ `#version 300 es
  in vec2 vTextureCoord; out vec4 finalColor;
  uniform sampler2D uTexture; uniform vec4 uInputSize; // Pixi 自动注入，.zw = (1/w, 1/h)
  void main(void) { ... }
`;
super({ glProgram: new GlProgram({ vertex: defaultFilterVert, fragment, name: "xxx-filter" }),
        resources: { filterUniforms: { uX: { value, type: "f32" } } } });
// uniform 经 getter/setter 暴露 this.resources.filterUniforms.uniforms.uX

// 2. preset（presets/filter.ts，defineEffect 是本文件内联 helper）
const _xxx: EffectFunction = (target, params = {}) => {
  const filter = new XxxFilter();
  filter.xxx = params.xxx ?? default;
  target.filters = [...(target.filters || []), filter];
  return filter;   // ← instant filter 必须返回实例，供 registerInstantEffects seek 清理
};
export const xxx = defineEffect(_xxx, { type: "filter", track: "instant"|"behavior", ... });
```

契约要点：
- **挂载点**：`target.filters = [...(target.filters||[]), filter]`，`target` 是任意 Pixi `Container`（char=KineticChar / group=TokenWrapper / block=KineticText）。
- **GLSL**：`#version 300 es` + `defaultFilterVert`（不自写顶点）；`uInputSize.zw` 自动注入为 `(1/width, 1/height)`。
- **静态滤镜 `track: "instant"`**；含逐帧动画的（用 `addModifier` 驱动 uniform）`track: "behavior"`。
- **char 守卫**：`targetType` 含 char 且实现用 `addModifier`/假定 KineticChar 时，加 `instanceof KineticChar` 守卫 + 非匹配 `console.warn` 后 return。
- **卷积/邻域类必须设 `filter.padding`**（否则邻域采样取透明边）；纯逐像素/点运算类（pixelate/gray/threshold/duotone/posterize）不需要。卷积模板见 `SharpenFilter.ts`：padding 匹配 kernel 步长（`Math.ceil(radius)`），在 `radius` setter 内同步更新。
- **预乘 alpha**：颜色/点运算类对 `c.rgb` 操作前需 `c.rgb/max(c.a,1e-4)` 再写回乘 alpha（审查重点）。点运算模板见 `GrayFilter.ts`。
- **vec3/vec4 uniform 值格式**：Pixi v8 的 GL uniform setter（`UNIFORM_TO_SINGLE_SETTERS`）对 `vec3<f32>`/`vec4<f32>` 使用数组索引 `v[0],v[1],v[2]`，不是 `.x/.y/.z` 属性。故 vec3/vec4 uniform 值**必须用 `Float32Array`**（如 `new Float32Array([r,g,b])`），不能用 `{x,y,z}` 对象——否则 `v[0]=undefined→0`，颜色 uniform 全变黑色。`vec2<f32>` 走另一条 setter 路径用 `v.x/v.y`，`{x,y}` 可用（RGBSplitFilter 即如此），但为一致性建议 vec2 也用 Float32Array。`hexToVec3`（`filters/colorUtils.ts`）已返回 Float32Array。
- **bloom 辉光需扩展 alpha**：辉光要扩散到文字外区域（alpha=0），不能只乘原图 alpha。bloom shader 取 `outAlpha = max(c.a, bloomAlpha * strength)`，让亮部 tap 的 alpha 扩散到邻域。
- **seek 幂等**：instant filter 的 fn 返回 filter 实例 → SegmentBuilder 记入 `activeInstantCleanups` → seek 时 `clearInstantEffects` 从 `target.filters` 移除后重 apply（经 `destroyFilterDeep` 深销毁旧实例，含 BlurFilter 的 X/Y 子 pass）。`InstantCleanup.filterInstance` 支持 `Filter | Filter[]`：组合预设（M2 underwater）return `Filter[]`，清理时全部移除+深销毁。**block 作用域（`[.x:block]`）经 Commit 1 修复后也走 `InstantEffectRecord` + `segmentTl.call`**（与 char/group 路径对称），不再同步挂载于 `applyGroupEffects`，seek 回退能正确移除。
- **behavior-track filter seek 幂等**（M2 准备修复）：behavior-track filter（blur/rgbShift/warp 及 M2 displace/dissolve/scanline/noise/underwater）的 fn 返回 filter 实例（char 级 `return Filter`；容器级 `return { filters, tickerFn }`）→ `registerBehaviors` / `segmentTl.call` 捕获记入 `activeBehaviorCleanups` → seek 时 `clearBehaviors` 从 `target.filters` 移除 filter + 深销毁（`destroyFilterDeep`，含 BlurFilter X/Y 子 pass）+ `gsap.ticker.remove(tickerFn)` + `removeModifier`（与 `clearInstantEffects` 对称）。容器级无 `addModifier`，animation 驱动靠 `gsap.ticker.add(fn)` 回调更新 filter uniform，cleanup 移除 ticker。容器级纯位移 behavior（`shake:group`/`:block`）用 `ContainerBehaviorOffset` 叠加 offset 到 position（不 tween pivot），返回 `{ tickerFn }`（filters 可选），cleanup 调 `removeContainerOffset` 恢复 position。char 级 `fadeShake` 的 state 推进 tween 记入 `BehaviorCleanup.tween`，cleanup `tween.kill()`。`BehaviorCleanup` 扩展 `target?`/`filterInstance?`/`tickerFn?`/`offsetTarget?`/`tween?`；`BehaviorRecord.char` 放宽为 `Container`（char 级 = KineticChar，容器级 = wrapper/KineticText）。**block 作用域 behavior filter 同样经 `SegmentBuilder` 路由进 `BehaviorRecord` + `segmentTl.call`**（与 instant/char/group 路径对称），不再落 `applyGroupEffects` 同步挂载——M2 `underwater:block` 关键路径由此 seek 幂等。
- **入场特效 filter 生命周期**（`EntranceFilterResult` + `EntranceFilterRecord`）：entrance 特效（fadeIn/popIn/blurIn…）的 tween 经 `captureTween` 入时间线（靠 `stop` 的 timeline kill 释放）。但 `blurIn` 创建持久 `BlurFilter` push 进 `target.filters`——原靠 tween `onComplete` 移除，`stop` kill 时间线时 `onComplete` 不触发 → GPU 泄漏。现 `blurIn` 返回 `EntranceFilterResult`（`{ tween, filter }`），`captureEntrance` 解包：tween → `captureTween` 入时间线（strength 动画靠 kill），filter → `entranceFilters`（`EntranceFilterRecord`，**不进 instantEffects**）。`Segment` 携带 `entranceFilters`，`clearEntranceFilters(segment)` 在 stop/clearScreen 时移除 filter + `destroyFilterDeep`。**结尾重播（`playSegment` 的 `tl.progress() >= 1` 分支）不清理 entranceFilters**——entrance filter 的 tween 在时间线上，`tl.seek(0)` 会把 strength 动画插值回开始状态（filter 仍在 target.filters），tween 从头播；若清理则 filter 被 destroy、时间线仍驱动已销毁 filter。**seek 时不清理/重 apply**——entrance tween 靠时间线插值到正确状态。若走 instantEffects 路径会被 `registerInstantEffects` 在 seek 时重 apply blurIn → `gsap.set(alpha=0)` 重置 + rogue tween（不入时间线）+ `destroy()` 对 `{tween,filter}` 崩溃。容器级 blurIn 的 alpha + strength 动画须并入同一 `gsap.timeline`（非另起 `gsap.to`），否则 strength tween 不入 segment timeline → seek 无法插值、kill 杀不到 → orphan。普通 entrance（无 filter）照旧只 return tween。
- **`clearScreen` 与 `stop` 对称**：原 `clearScreen` 只调 `clearBehaviors`/`clearInstantEffects` 不 kill 时间线 → 入场 tween orphan 在已 destroy 的 target 上。现 `clearScreen` 先 `segment.timeline.pause().kill()` 再 clear*，与 `stop` 对称。**clearScreen 置空 segment**——它已 kill timeline + destroy 所有显示对象，segment 引用的是死对象，后续 playSegment/seekToTime/next 用它会崩。clearScreen 也 reset layout + loadState(entryCheckpoint.stage) + clearModifiers（与 stop 对齐）。fade tween（`gsap.to(kt,{alpha:0})`）在 `.then(destroy)` 前加 `gsap.killTweensOf(kt)` 兜底防并发 orphan。
- **stage modifier 在 stop/clearScreen/seek/重播 清理 + seek/replay 重放（命令级生命周期建模）**：`cam.shake`/`cam.drift` 等 stage 特效用 `stageRuntime.addModifier` 注册 modifier。`cam.shake` 靠 tween `onComplete` 移除 modifier，但 stop kill 时间线后 `onComplete` 不触发 → 残留；`cam.drift` 无 tween、modifier 永久残留。`StageManager.loadState` 只 restore camera + `killTweensOf`，不 `clearModifiers`。stop/clearScreen 在 `loadState` 后显式调 `stageManager.clearModifiers()`；seek（`ScriptPlayer.seekToTime`）在 `PlaybackController.seekToTime` 前调 `clearModifiers` + `replayStageModifiers` 按 `timePosition` + `duration` + `isClearBoundary` 重放（`tl.call` seek 跨过不补触发 → modifier 缺失）；结尾重播也调 `clearModifiers`；**resume（playSegment, tl.time()>0）也调 `clearModifiers` + `replayStageModifiers(live)`**（R4-1：与 register* 对称，seek 用静态快照、resume 重建衰减 tween）；**`ScriptPlayer.seekToTime` 在 `isAutoPlaying && timeline.progress()<1` 时也 resume playSegment**（R5-1：reader runtime `seek` / `editorStore.seekRelative` 播放中 seek 也走 live replay，避免公共 API seek 到 shake 中途永久震动；R6-1：seek 到结尾 progress>=1 不 resume——playSegment 对 progress>=1 是 restart 语义，会让"拖到尾/seek({progress:1})"从 0 重播而非停在 ended；暂停态 seek 不触发，UI 拖条拖前 pauseSegment → 不误恢复）。**R6-2 衰减 tween 生命周期**：`cam.shake` 非 static 路径的衰减 tween 注册进 `StageRuntime.modifierTweens`（`registerModifierTween("shake", tween)`），`clearModifiers`/`removeModifier` 一并 kill（`tween.kill()` 抑制 onComplete——§B-bis 已验证），否则旧 tween 的 onComplete 会在 clearModifiers + 新 shake 后误删新 modifier。**命令级生命周期**：(1) `duration` 按命令语义提取（`getStageModifierDuration`，经 `resolveStageNumeric` 解析 `var.*`，与 `StageRuntime.apply` 同源——R4-3）——`cam.shake`: `params.duration ?? params.d ?? params[1] ?? 0.5`（有限）；`cam.drift` 及其他：persistent。(2) **clear boundary**——`cam.reset` 记为 `isClearBoundary` + `resetDuration`，`replayStageModifiers` 的 boundary 生效时间 = `timePosition + resetDuration`（与正常播放对齐——buildMode 下 resetTl 末尾才 clearModifiers——R4-2），之前的 modifier 不重放。(3) **cam.shake 中间强度**——seek 到 shake 进行中（含起点 `elapsed>=0`，结束点 `>= start+duration` 直接跳过——R5-2）时用 `gsap.parseEase("power2.out")` 求剩余强度 `strength * (1 - ease(elapsed/duration))`（strength 经 `resolveStageNumeric` 解析 `var.*`——R5-3；不硬编码 `(1-t)^2`——GSAP `power2.out` 实为 `1-(1-t)^3`，R3-4）；seek 用 `static:true`（恒定快照），resume 用 `live`（创建 `remainingDuration` 衰减 tween，onComplete 自删——R4-1）。**单一真相源 + 三路径共用**：`buildStageModifierRecord(command, params)`（`stagePresets.ts`）决定 cam.reset（boundary + resetDuration）/ modifierBased（duration）/ 可 seek tween（null）的分流，global（`applyStageConfigs`）、inline（`TextStageCueScheduler.schedule`）、token-chain（`TextPlayer.unrollGroupChain`/`unrollCharChain`）三路径共用此 helper。注意 seek 不调 `loadState`——camera position 由时间线插值恢复。
- **`loadScript`/`loadSource`/`load` 先清旧 segment**：`ScriptPlayer.loadSourceContent` 和 `load` 在 build 新 segment 前先调 `this.stop()`，释放旧 timeline、显示对象、behavior ticker/filter、entrance filter、stage modifier。runtime 公共入口（`loadScript`/`loadSource` 经 protocol dispatch）不保证上层已 stop（编辑器包装层 `ReaderCanvas.vue` / `editorStore.ts` 已 stop，但公共契约不强约束）。ScriptPlayer 层兜底保证"先清旧再建新"不变量（INV-4）。stop() 对空 segment 是 no-op，编辑器层已 stop 时无害。
- **`blockRemaining` 契约约束**：`SegmentBuilder` 的 `blockRemaining` 桶（非 filter 的 block 级特效：style/action/pure-modifier behavior）仍经 `applyGroupEffects` 同步执行，返回值不进 record。**契约 = 不得 return 资源**（filter/tween/{filters,tickerFn}）——需 return 资源的 block 级特效必须像 instant/behavior filter 那样在 SegmentBuilder 分流进 record 通道。`applyGroupEffects` 对违规 return 加运行时 `console.warn` 守卫。当前不泄漏（dim 降级一次性 alpha 写、shift/glitch 对容器 target 跳过）。
- **死路径删除**：legacy `KineticText.play`/`bakeTimeline`/`skipToEnd`/`applyParagraphEffects` + `TextPlayer.play`（setTimeout 驱动）/`executePerformance`/`sliceLegacyPlaybackAssembly`/`fastForward`/`bakeTimeline`/`skipToEnd`/`isNewLineItem` + `LegacyTextPlaybackOptions` 接口 + orphan `example/layout-debug.ts` 均已删除（审计确认 Segment 引擎零引用，生产路径 `ReaderRuntimeSession → scriptPlayer.playSegment → SegmentBuilder → TextPlayer.buildTimeline` 完全不触碰）。`LayoutEngine.ts` 注释行一并清理。保留 `TextPlayer.buildTimeline`/`captureTween`/`captureEntrance`（Segment 引擎核心）。

### 已注册 filter 清单

| name | track | targetType | mutexGroup | padding | 说明 |
|---|---|---|---|---|---|
| `rgbShift` | behavior | both | filter_rgb | — | RGB 通道偏移（可选 anim；char 级 addModifier / 容器级 ticker 驱动） |
| `warp` | behavior | both | filter_warp | 20 (preset) | sin(y*freq+time)*amp 波浪扭曲（M0→§0.5.3 扩展到容器级，原 char-only） |
| `blur` | behavior | both | filter_blur | — | Pixi BlurFilter（可选 anim；char 级 addModifier / 容器级 ticker 驱动） |
| `pixelate` | instant | both | filter_pixelate | — | 下采样马赛克（M0 模板） |
| `gray` | instant | both | filter_color | — | 灰度点运算（M1 premult-alpha 模板） |
| `threshold` | instant | both | filter_color | — | alpha 软阈值二值化边缘（M1 点运算） |
| `duotone` | instant | both | filter_color | — | alpha→shadow/highlight 渐变（M1，hexToVec3） |
| `posterize` | instant | both | filter_color | — | alpha 量化+可选 Bayer 4×4 抖动（M1 点运算） |
| `sharpen` | instant | both | filter_conv | ceil(radius) | alpha unsharp mask 3×3（M1 卷积模板） |
| `emboss` | instant | both | filter_conv | ceil(width) | alpha 梯度浮雕 + 多步长斜坡（M1，可链 f.blur.emboss） |
| `edge` | instant | both | filter_conv | ceil(width) | alpha 内描边（M1，hexToVec3，类似 CSS text-stroke） |
| `outline` | instant | both | filter_outline | ceil(width*2) | alpha 膨胀描边 + 可选发光（M1 形态学，hexToVec3） |
| `bloom` | instant | both | filter_bloom | ceil(radius*2) | 多通道辉光 extract→BlurFilter→composite + 曝光混合（M1，推荐 :block） |
| `halftone` | instant | both | filter_halftone | ceil(scale) | 网格网点 dot/line + invert（M1，推荐 :block） |
| `vignette` | instant | both | filter_vignette | — | 径向亮度衰减 smoothstep（M2，推荐 :block） |
| `scanline` | behavior | both | filter_scanline | — | CRT 周期亮度调制 + 桶形畸变 + 闪烁（M2，推荐 :block） |
| `noise` | behavior | both | filter_noise | — | 时变噪声叠加 hash21，单色/彩噪（M2） |
| `dissolve` | behavior | both | filter_dissolve | ceil(scale) | 噪声场与 uProgress 阈值比较消散 + 边缘上色（M2，progress 同构 fadeShake） |
| `displace` | behavior | both | filter_displace | ceil(amount) | sin 组合噪声场驱动 UV 位移（M2，underwater 几何半边，amount=像素值，推荐 :block） |
| `underwater` | behavior | both | filter_underwater | — | **组合预设**（非新 shader）：displace+duotone 蓝移+blur，fn 内 `new` 三 filter 串联，返回 `filters:Filter[]`（M2 首个 Filter[] preset） |

### 背景命令 bg（DIP-FX M2 Task B）

`bg` 是 **stage 命令**（注册在 `stagePresets.ts`，非 `effectManager`）。与 `visual.ts` 的元素级 `box` 样式（原名 `bg`，因命令名碰撞已改名——见下方审查修复第 1 条；Graphics 画圆角矩形，`mutexGroup:"box"`）是不同概念：

| 用法 | 路径 | 效果 |
|---|---|---|
| `bg(color="#1a0a2e")` | B1 → `stageManager.setBackgroundColor` + `setBackgroundSprite(null)` | 设置画布纯色背景，清除已有图片 |
| `bg(src="tests/assets/photo.jpg")` | B2 → `stageManager.loadBackgroundFromUrl` → cover-fit Sprite → `backgroundLayer` | 加载图片作为背景（editor-dev 级，fire-and-forget async，纪元号守卫） |
| `bg(color="#0f3460", src="...")` | B1+B2 组合 | 先设色（图片加载前可见），图片加载后替换 |
| `[.duotone:bg]` / `[.emboss:bg]` | B3 → `:bg` scope 路由 | DIP 滤镜作用于背景精灵（`stageManager.getBackgroundSprite()`），fn 零改动 |

**`:bg` scope 路由**：`CommandLevel` 加 `"bg"`，parser regex 识别 `:bg` 后缀。`:bg` 与 `:block` 同构（都是容器级 block-option scope），在 `SegmentBuilder` 块拆分中 target 解析为 `stageManager.getBackgroundSprite()` 而非 `paragraphText`。DIP filter `fn`/`meta` 完全复用。四条轨道（instant/behavior/style/entrance）均已接线：
- **instant/behavior**：target 延后到 `segmentTl.call` 触发时解析（Bug 6 修复）；sprite 未就绪时注册 `onBackgroundReady` 回调延后 apply。
- **style**：`:bg` style 跳过并 warn（Sprite 无 `getGraphicsLayer`/`tokens`，`:bg` style 无语义）。
- **entrance**：target 解析同 instant/behavior 模式。
- **内联 `@ f.x:bg`**：`TextPlayer.unrollGroupChain` 容器级分支加 `:bg` target 解析。

**审查修复（2026-07-09，7 处 bug，详见 spec §0.5.1）**：
1. `bg(...)` 命令名碰撞——`visual.ts` 旧 `bg` 改名 `box`，消除 `effectManager.has("bg")` 恒真导致的 stage bg 死代码。
2. `:bg` 四条轨道 target 解析补齐（见上）。
3. `setBackgroundSprite` 不销毁 Assets 缓存共享 texture——改 `destroy({ texture: false })` + `Assets.unload(url)`。
4. `dumpState`/`restoreState` 快照 `bgSpriteUrl`——seek/restore 后重新加载背景图。
5. `bg(color)`/无参 `bg()` 补 `setBackgroundSprite(null)` 清除旧图片。
6. `bg(src)` 异步竞态——target 延后到 `segmentTl.call` 触发时解析 + `onBackgroundReady` 延后 apply。
7. 并发 `bg(src)` 纪元号守卫——`_bgEpoch` 丢弃过期 resolve。

**语法方向约束**：`:bg` 是过渡期兼容写法，非终态——`design.md` D12 封盘"覆盖范围归主语不归 `:`"，`:bg` 已违反此条。终态应为 `bg.<effect>(...)` 主语形态（Phase B 链语法统一重写），工程债记在 `migration.md` #9。**不再往 `CommandLevel` 加更多主语性质值**。

## 已知边界

- **`targetType: "both"` 的特效** (如 shake)：在 Container 上也能工作（修改 Container.position），
  但效果是整体移动而非逐字错开。
- **显式 paragraph/container 路径中的 char 级特效**：如果强制 `:block`，仍可能因为目标是 `KineticText` 而失效。
  默认 block option 视觉命令不会走这条路径，只有显式 `:block` 时才需要注意这一点。
- **特效的 `charIndex` 参数**：仅在 `unrollGroupChain` 逐字分发路径中注入。
  直接调用 `effectManager.apply(char, "wave", {})` 不会有 charIndex → 所有字符同相位。
- **block 作用域 filter 的纹理范围**：`[.x:block]` 经 `SegmentBuilder` 路由进 record + `segmentTl.call`（instant → `InstantEffectRecord`，behavior → `BehaviorRecord`，entrance → `entranceFilters` + `segmentTl.add`），target 是整段 `KineticText`（持有所有 TokenWrapper），filter 覆盖整段合成纹理。邻域类滤镜（bloom/halftone/vignette）推荐此作用域。`shake:block` 等纯位移 behavior 也经此路径（`track:"behavior"` 分流，`ContainerBehaviorOffset` 驱动 position offset）。`blurIn:block` 等 entrance 也经此路径（`track:"entrance"` 分流，tween 入 segmentTl、filter 进 entranceFilters）。char/group/block × instant/behavior/entrance 路径 seek 幂等均已覆盖。
- **seek 顺序：clear-before-seek-before-reapply**：`seekToTime` 顺序为 `clearBehaviors → clearInstantEffects → timeline.seek → registerBehaviors(replay) → replayStyles → registerInstantEffects(replay) → replayStageModifiers`。clear 在 seek 前：restoreProps 写回旧值 → timeline.seek 覆盖为插值结果（不残留旧 alpha）。原顺序（seek 再 clear）导致 dim restoreProps 覆盖 timeline 刚插值的 alpha（dim + blurIn 组合 seek 回 blurIn 中途）。**生命周期不变量 INV-2**（见 `lifecycle-invariants.md`）。
