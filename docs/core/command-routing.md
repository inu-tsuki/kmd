# 指令路由：从 @ 到渲染

> 本文档描述 KMD `@` 后指令的分类、路由和最终消费路径。
> 这是调试排版/特效 bug 时最关键的参考。

## 三种前缀 × 三种作用域

| 写法 | 前缀 | 语义 | 作用域 |
|------|------|------|--------|
| `f.red.wave` | `f.` | 逐 token 特效链 | **token 级** — 与花括号组 1:1 匹配 |
| `.red.offset(100,0)` | `.` | 全局效果 | **行级** — 应用于当前行所有 token |
| `cam.move(100,0,1s)` | 裸名 | 舞台/排版指令 | **行级** — 挂在当前行首 token |
| `[.glitch]` | block option | 段落全局 | **段落级** — `globalEffects` |

## 路由详解 (`KMDScanner.applyCommandsToTokens`)

```
@ 后指令字符串
  │
  ├─ 按空格拆分（括号内空格不拆）→ parts[]
  │
  └─ 遍历 parts:
       │
       ├─ f.xxx     → visualQueue（整条链作为一个 EffectConfig[]）
       │              ↓ 后续与花括号组 1:1 匹配分配到 token.effects
       │
       ├─ .xxx      → 逐效果分类：
       │    ├─ layoutManager.has() or stageManager.has()
       │    │    → dotLineLayoutInstructions（行级排版）
       │    │    ↓ 首 token 得 lineScope:"pre"，末 token 得 lineScope:"post"
       │    │
       │    └─ 其余（视觉特效/样式）
       │         → dotVisualEffects（独立于 visualQueue，直接注入全部 visualTargets）
       │
       └─ 裸名     → lineLayoutInstructions → 挂在行首 token
```

## 视觉特效分配逻辑

**两条独立管线**：

```
dotVisualEffects（.xxx 点链视觉特效）:
  → 直接注入全部 visualTargets 的 token.effects
  → 不参与花括号匹配，不进入 visualQueue
  → 保证 .shake 等特效作用于行内每一个 token

visualQueue（f.xxx 特效链）:
  有花括号组时:
    队列长度 === 组数 → 1:1 分配
    队列长度 !== 组数 → 首链给首组，余链给末组
  无花括号组时:
    队列长度 === 1 → 全部 visualTargets 共享
    队列长度 >  1 → 首链给首 target，余链给末 target
```

## 行级排版的 lineScope 机制

**问题**：`.offset(100,0)` 需要 `pushDisplayOffset` 在首字符前、`popDisplayOffset` 在末字符后。
但 token 级排版只包裹单个 token 的字符。

**解决**：`LayoutInstruction.lineScope` 字段

```
Scanner:
  首 token.layoutInstructions ← { type: "offset", lineScope: "pre" }
  末 token.layoutInstructions ← { type: "offset", lineScope: "post" }

LayoutStreamBuilder:
  expander 返回 { pre, post } 时：
    lineScope === undefined → 正常：pre + post 都发射
    lineScope === "pre"     → 只发射 pre 命令
    lineScope === "post"    → 只发射 post 命令
```

## 消费路径对比

### 排版指令 (goto, offset, mark...)

```
token.layoutInstructions
  → LayoutStreamBuilder: expander?
     ├─ 有 expander (offset, up, markStart...) → pre/post LayoutCommand 包裹字符
     └─ 无 expander → layoutManager.generate() → 直接 preCmds (operator)
  → TextLayoutEngine: 执行 operator，修改 cursor/markers
```

### 视觉特效 (shake, wave, rainbow...)

```
token.effects
  → EffectProcessor.partition() → visualConfigs
  → TextPlayer.buildTimeline() → unrollGroupChain()
     ├─ meta.targetType === "char" → 逐字 effectManager.apply(char)
     └─ meta.targetType === "group"/"both" → effectManager.apply(wrapper)
  → 特效实现: target.addModifier(name, track, fn)
```

### 舞台指令 (cam.move, pause...)

```
token.layoutInstructions (stageManager.has() === true)
  → LayoutStreamBuilder: stageInstructions[]
  → TextBuilder: charData.stageInstructions
  → TextPlayer.buildTimeline(): tl.call(() => stageManager.apply(...))
```

## 踩坑记录

### 1. `.xxx` 全部进 globalEffects → 标记前向引用失败

**现象**：`.goto(center_point)` 跳转到不存在的标记。
**原因**：`globalEffects` 在 `LayoutStreamBuilder` 中被推到 stream 头部（position 0），
在 `mark(center_point)` 所在 token 之前执行。标记尚未写入。
**修复**：`.xxx` 排版指令走 `lineLayoutInstructions`，保持在当前行的流位置。

### 2. `.xxx` 全部进 lineLayoutInstructions → offset 只包裹首 token

**现象**：`.offset(100,0)` 只偏移第一个 token。
**原因**：`lineLayoutInstructions` 只挂在 `primaryTarget`（首 token），
expander 的 push/pop 只包裹该 token 的字符。
**修复**：引入 `lineScope` 机制，pre 挂首 token，post 挂末 token。

### 3. `.rainbow` 进 globalEffects → 特效不生效

**现象**：`.rainbow` 无效果。
**原因**：`globalEffects` 的视觉特效通过 `applyGroupEffects(kt, ...)` 应用到 KineticText 容器，
但 `rainbow` 实现有 `if (target instanceof KineticChar)` 守卫 → 跳过。
**修复**：`.xxx` 视觉特效走 `dotVisualEffects`，注入所有 token 的 `effects`，
走正常的 `buildTimeline → unrollGroupChain → 逐字 apply` 路径。

### 3b. `.shake` 进 visualQueue → 只应用于部分 token

**现象**：`{说吧}，... @ .offset(200,0).mark(left).shake` 中 shake 只对 `{说吧}` 生效。
**原因**：`.xxx` 视觉特效被 push 进 `visualQueue`，与 `f.xxx` 共用花括号 1:1 匹配逻辑。
`visualQueue = [[shake]]`，`bracedGroupIds = [0]`（`{说吧}`），队列长度 === 组数 → 1:1 分配。
**修复**：`.xxx` 视觉特效不进 `visualQueue`，改用独立的 `dotVisualEffects` 数组，
在花括号匹配之前直接注入全部 `visualTargets`。两条管线互不干扰。

### 6. 非展开器指令忽略 lineScope → mark 位置覆写

**现象**：`.mark(left)` 标记位置在 `{说吧}` 尾部而非行首。
**原因**：`dotLineLayoutInstructions` 将每条指令复制到首 token（lineScope "pre"）和末 token（lineScope "post"）。
展开器分支正确过滤了 lineScope，但非展开器的 `else` 分支完全忽略了 lineScope —
`mark(left)` 在两个 token 上都执行，末 token 的结果覆写了首 token 的结果。
**修复**：`else` 分支中，`lineScope === "post"` 的非展开器指令直接跳过。
单点操作（mark、stage 指令等）不像 offset 那样有 pre/post 成对结构，只需在行首执行一次。

### 4. `isVisual()` 不区分 f. 和 .

**现象**：`f.xxx` 和 `.xxx` 都被当作视觉特效，进入 visualQueue 做 1:1 匹配。
**原因**：`KMDCommandParser.isVisual()` 只检查 `startsWith("f.") || startsWith(".")`。
**修复**：在 `applyCommandsToTokens` 中用 `if/else if/else` 三路分流，
不再依赖 `isVisual()` 做统一判断。

### 5. ScriptPlayer 双次构建 + phantom pass 标记同步

**现象**：`goto(p2)` 跳转到 (0,0) 而非 `markStart(p2)` 的位置。
**原因**：ScriptPlayer 先用 `baseOffset: {0,0}` 构建，再用真实 baseOffset rebuild。
Phantom pass 同步只检查 `!globalMarkers.has(k)` → rebuild 时跳过已存在的标记。
**修复**：追踪 `writtenKeys`（本次 phantom pass 写入的标记），
用 `phantomWrittenKeys.has(k)` 替代 `!globalMarkers.has(k)` 判断。
