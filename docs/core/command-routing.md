# 指令路由：从 AST 到渲染

> 本文档描述 KMD 指令的分类、路由和最终消费路径。
> 当前实现的关键分界是：`AstParser` 保留语法结构，`lowering.ts` 决定作用域路由，runtime 负责执行。

## 当前主路径

```text
AstParser.parseParagraph()
  -> CommandChainAst / BlockOptionAst
  -> lowering.ts
  -> ParagraphIR + legacy projection
  -> LayoutStreamBuilder / ScriptPlayer
```

这意味着：

- parser 前端不再直接做最终 token/globalEffects 分发
- `f.` / `.` / block option 的实际路由在 `lowering.ts`
- runtime 仍会消费一部分兼容层数据，但不再承担主要语法解释职责

## 三种前缀 × 三种作用域

| 写法 | 前缀 | 语义 | 作用域 |
|------|------|------|--------|
| `f.red.wave` | `f.` | token/group 特效链 | **token 级** — 与花括号组或视觉目标匹配 |
| `.red.offset(100,0)` | `.` | 行级广播链 | **行级** — 当前行全部视觉目标或 lineScope 指令 |
| `cam.move(100,0,1s)` | 裸名 | 裸名布局/舞台指令 | **行级** — 挂在主目标上 |
| `[.glitch]` | block option | 段落作用域链 | **段落级** — 由 `lowering.ts` 决定是 paragraph broadcast 还是 paragraph effect |

## 路由详解 (`lowering.ts`)

```
CommandChainAst / BlockOptionAst
  │
  ├─ buildInlineFromAst()
  │    └─ 先生成过渡态 inline IR（text / pause / sugar / newline ...）
  │
  ├─ applyBlockOptionCommands()
  │    ├─ layout / stage          → paragraphEffects
  │    ├─ 显式 :block 视觉命令     → paragraphEffects
  │    └─ 其余视觉命令             → paragraph broadcast
  │
  └─ applyLineCommands()
       ├─ f.xxx   → visualQueue（整条链与花括号组或 target 匹配）
       ├─ .xxx    → dotVisualEffects / dotLineInstructions
       └─ 裸名     → lineLayoutInstructions
```

## 视觉特效分配逻辑

**三条互相独立的路径**：

```
dotVisualEffects（.xxx 行级视觉特效）:
  → 直接注入当前行全部 visualTargets 的 token.effects
  → 不参与花括号匹配

visualQueue（f.xxx 特效链）:
  有花括号组时:
    队列长度 === 组数 → 1:1 分配
    队列长度 !== 组数 → 首链给首组，余链给末组
  无花括号组时:
    队列长度 === 1 → 全部 visualTargets 共享
    队列长度 >  1 → 首链给首 target，余链给末 target

paragraph broadcast（block option 默认视觉语义）:
  → 直接注入整段全部 visualTargets 的 token.effects
  → 保留视觉命令的默认 target 语义
  → 只有显式 :block 才进入 paragraph/container 路径
```

## 行级排版的 `lineScope` 机制

**问题**：`.offset(100,0)` 需要在行首发出 `pushDisplayOffset`，在行尾发出 `popDisplayOffset`。
如果只把指令挂在一个 token 上，就只会包裹局部字符。

**解决**：`LayoutInstruction.lineScope`

```
lowering:
  首 target.layoutInstructions ← { type: "offset", lineScope: "pre" }
  末 target.layoutInstructions ← { type: "offset", lineScope: "post" }

LayoutStreamBuilder:
  expander 返回 { pre, post } 时：
    lineScope === undefined → 正常：pre + post 都发射
    lineScope === "pre"     → 只发射 pre 命令
    lineScope === "post"    → 只发射 post 命令
```

## 消费路径对比

### 排版指令 (`goto`, `offset`, `mark` ...)

```
token.layoutInstructions
  → LayoutStreamBuilder: expander?
     ├─ 有 expander → pre/post LayoutCommand 包裹字符
     └─ 无 expander → layoutManager.generate() → 直接进入 stream
  → TextLayoutEngine: 执行 operator，修改 cursor/markers
```

### 视觉特效 (`shake`, `wave`, `rainbow` ...)

```
token.effects
  → EffectProcessor.partition() → visualConfigs
  → TextPlayer.buildTimeline() → unrollGroupChain()
     ├─ targetType === "char" → 逐字 apply
     └─ targetType === "group"/"both" → group/container apply
```

### 舞台指令 (`cam.move`, `pause` ...)

```
token.layoutInstructions
  → LayoutStreamBuilder: stageInstructions[]
  → TextBuilder: charData.stageInstructions
  → TextPlayer.buildTimeline(): tl.call(() => stageManager.apply(...))
```

### paragraph/global 特效（显式 `:block`）

```
pData.globalEffects
  → ScriptPlayer.buildSegment()
  → partition() → visualConfigs
  → applyGroupEffects(kt, visualConfigs)
```

这里的 target 是 `KineticText` 容器。
因此 char-only 特效只有在 paragraph broadcast 到 text targets 时才会保留逐字语义。

## 踩坑记录

### 1. `.xxx` 全部进 globalEffects → 标记前向引用失败

**现象**：`.goto(center_point)` 跳转到不存在的标记。
**原因**：如果 `.xxx` 排版指令被推到 paragraph/global 路径，它会早于行内 `mark(center_point)` 执行。
**修复**：`.xxx` 排版指令保留在 line-scope 路径中。

### 2. `.xxx` 全部进 lineLayoutInstructions → offset 只包裹首 token

**现象**：`.offset(100,0)` 只偏移第一个 token。
**原因**：push/pop 都落在同一个目标上，只包裹局部字符。
**修复**：引入 `lineScope`，将 pre 挂在首 target，post 挂在末 target。

### 3. `.rainbow` 进 paragraph/container 路径 → 特效不生效

**现象**：`.rainbow` 无效果。
**原因**：char-only 特效在 `KineticText` 容器上会被 `instanceof KineticChar` 守卫跳过。
**修复**：`.xxx` 视觉特效改为直接广播到当前行 `token.effects`。

### 4. `f.` 与 `.` 共用同一条视觉队列 → 花括号匹配被污染

**现象**：`.shake` 只对某个花括号组生效。
**原因**：如果 `.` 视觉链也进入 `visualQueue`，就会错误复用 `f.` 的 1:1 组匹配规则。
**修复**：`f.` 和 `.` 在 `lowering.ts` 中分成两条独立路径。

### 5. block option 视觉命令进入 globalEffects → char-only 特效失效

**现象**：`[.wave]`、`[.rainbow]` 等段落视觉特效不生效。
**原因**：旧路由会把它们提升为 paragraph/container effect，由 `KineticText` 执行。
**修复**：block option 默认视觉命令改为 paragraph broadcast，仅显式 `:block` 时才保留 container 语义。
