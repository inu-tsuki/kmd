# KMD Engine Architecture (v1.6.0)

> **Kinetic Markdown (KMD)** — 一种自定义标记语言，用于创作 GPU 加速的动态文字演出。
> 本文档是面向开发者的架构全景手册。

## 技术栈

Vue 3 + TypeScript + PixiJS v8 (WebGPU/Canvas) + GSAP 3 (Timeline) + Pinia + Monaco Editor

---

## 数据流全景

```
KMD 源码
  │
  ├─ KMDParser.parse()              // 分段 + YAML frontmatter
  │   └─ KMDScanner.scan()          // 逐行词法分析 → KMDToken[]
  │       └─ KMDCommandParser       // 解析 @ 后的指令链 (f.red.wave(amp=5))
  │
  ├─ KMDParagraphData[]             // 每段: tokens + globalEffects + blockOptions
  │
  ├─ LayoutStreamBuilder.build()    // Token → LayoutStream (字符 + 排版指令)
  │   ├─ Expander 展开              // 高级指令 → pushDisplayOffset/popDisplayOffset 等
  │   └─ TextLayoutEngine.calculate()
  │       ├─ Phantom Pass           // 幻影预扫描：发现标记、建立行边界
  │       └─ Main Pass              // 最终坐标计算，输出 LayoutResult[]
  │
  ├─ TextBuilder.build()            // LayoutResult → KineticChar + TokenWrapper (Pixi 场景)
  │
  ├─ TextPlayer.buildTimeline()     // 字符 → gsap.Timeline (入场动画 + 时序 + 舞台指令)
  │
  └─ ScriptPlayer.buildSegment()    // 多段落 Timeline 组合 → Segment (可 seek)
      └─ playSegment() / seekToTime()
```

---

## 核心子系统

### 1. Parser（解析器）

**文件**: `src/core/parser/`

| 模块 | 职责 |
|------|------|
| `Parser.ts` (singleton: `parser`) | 入口。分割段落、提取 YAML frontmatter、校验指令名 |
| `KMDScanner.ts` | 逐行扫描。处理 `[block options]`、`---` 场景切换、`{花括号组}`、markdown 语法糖、管道 `\|`、`@` 指令分割 |
| `KMDCommandParser.ts` | 解析 `f.effect.chain(params)` 为 `EffectConfig[]`；处理命名空间保护 (`cam.` → 临时替换) |
| `types.ts` | `KMDToken`, `EffectConfig`, `KMDParagraphData`, `LayoutInstruction` 等类型定义 |

**关键输出**：`KMDToken { content, effects: EffectConfig[], layoutInstructions[], sugar[], line, range }`

### 2. Layout（排版引擎）

**文件**: `src/core/layout/`

| 模块 | 职责 |
|------|------|
| `LayoutEngine.ts` (singleton: `layout`) | 全局段落垂直堆叠、`globalMarkers` 管理、响应式回流、状态序列化 |
| `LayoutStreamBuilder.ts` | Token → LayoutStream 转换。测量字宽、运行 Expander、收集舞台指令 |
| `TextLayoutEngine.ts` | 两趟扫描坐标引擎。**Phantom Pass** 发现标记和行边界，**Main Pass** 输出最终 `LayoutResult[]` |
| `LayoutManager.ts` (singleton: `layoutManager`) | Operator + Expander 双注册表。自动加载 layoutPresets 和 layoutExpanders |
| `layoutPresets.ts` | 运行时 Operator：`goto`, `flow`, `mark`, `offset`, `pushDisplayOffset`, `popDisplayOffset` 等 |
| `layoutExpanders.ts` | 构建时 Expander：将 `up(50)` 展开为 `pushDisplayOffset`/`popDisplayOffset` 对 |
| `types.ts` | `LayoutContext`, `LayoutResult`, `MarkerMap`, `CursorState` 等类型 |

**三层排版指令体系**：
- **视觉偏移** (`offset/up/down/left/right`)：per-token 作用域，push/pop 自动回收，不影响排版流
- **视觉跳转** (`goto`)：`isFlowBroken=true`，字符脱离流，行尾自动回归
- **排版流控制** (`flow`)：移动 cursor + 同步 `baselineY`，不脱离流

**指令路由（三前缀 × 三作用域）**（详见 `docs/core/command-routing.md`）：

| 前缀 | 视觉特效去向 | 排版/舞台指令去向 | 作用域 |
|------|------------|-----------------|--------|
| `f.xxx` | visualQueue → 1:1 花括号匹配 | token.effects → partition | token 级 |
| `.xxx` | visualQueue → 全部 token | dotLineLayoutInstructions → lineScope pre/post | 行级 |
| 裸名 `xxx` | — | lineLayoutInstructions → 行首 token | 行级 |
| `[.xxx]` | globalEffects | globalEffects → stream 头部 | 段落级 |

**行级 lineScope 机制**：`.offset(100,0)` 的 `pushDisplayOffset` 挂首 token (lineScope:"pre")，
`popDisplayOffset` 挂末 token (lineScope:"post")，横跨整行。

**幻影预扫描 (Phantom Pass)**：
- 模拟完整排版路径，发现 `markStart(p2)` 等前向引用标记
- 使用 `writtenKeys` 追踪本次写入的标记，确保 rebuild 时坐标正确更新
- 建立行边界 `phantom_N.start/mid/end`，供 `next.start` 等保留标记使用

### 3. Rendering（渲染）

**文件**: `src/core/render/text/` + `src/core/`

| 模块 | 职责 |
|------|------|
| `KineticText.ts` | Pixi Container，一个段落的顶层对象。持有 tokens、chars、options |
| `TextBuilder.ts` | 桥接层：Parser 输出 + Layout 结果 → KineticChar + TokenWrapper 场景树 |
| `KineticChar.ts` | 单字符 Pixi Text。**三层变换**：`layoutX/Y` (基准) + `displayOffset` (视觉偏移) + `animOffset` (GSAP) + `modifiers` (Ticker) |
| `TokenWrapper.ts` | Token 分组容器，管理 chars[] 和图形层 |

**KineticChar 属性层级**：
```
最终位置 = layoutX/Y + displayOffset + animOffset + Σ modifiers
                ↑             ↑            ↑            ↑
           TextLayout    三层布局     GSAP Tween    Ticker 回调
         (基准，影响        (视觉，      (可seek)    (shake/wave)
          段落高度)     不影响高度)
```

### 4. Effects（特效系统）

**文件**: `src/core/effects/`

| 模块 | 职责 |
|------|------|
| `EffectManager.ts` (singleton: `effectManager`) | 视觉特效注册表 (shake, wave, pulse, glitch...) + mutex 组冲突管理 |
| `StyleManager.ts` (singleton: `styleManager`) | 样式修改器注册表 (red, bold, dim, font...) + mutex 管理 |
| `EffectProcessor.ts` | 智能路由：四轨分类 + 三路分流 (layout/visual/stage)；参数解析；样式应用 |
| `presets.ts` | 28 种特效实现 (每个导出 `{ fn, meta }`) |
| `styles.ts` | 18 种样式实现 |

**四轨特效分类**：
| Track | 时间驱动 | seek 行为 | 示例 |
|-------|---------|----------|------|
| `entrance` | Timeline Tween | GSAP 自动插值 | fadeIn, slideUp |
| `behavior` | Ticker 回调 | 通过 `registerBehaviors(t)` 重注册 | shake, wave, rainbow |
| `instant` | 立即执行 | 通过 `StyleRecord` 重放 | red, bold, blur |
| `timing` | cursor 控制 | Timeline 位置隐含 | hold, pause |

**三路分流** (`EffectProcessor.partition`)：
- `layoutManager.has(name)` → `layoutCmds[]`
- `stageManager.has(name)` → `stageConfigs[]`
- 其余 → `visualConfigs[]`

### 5. Stage（舞台系统）

**文件**: `src/core/stage/`

| 模块 | 职责 |
|------|------|
| `StageManager.ts` (singleton: `stageManager`) | 世界容器层级 (bg → content → ui)，三层摄影机，设计分辨率信封适配 |
| `stagePresets.ts` | 舞台指令实现 (`cam.move`, `cam.zoom`, `cam.offset`, `cam.reset` 等) |

**三层摄影机**：
```
updateWorldTransform():
  最终变换 = base camera (cam.move/zoom/rotate)
           + cameraOffset (cam.offset, 叠加层)
           + Σ modifiers (cam.shake/drift, Ticker)
```

**buildMode**：场景烘焙时 `stageManager.buildMode = true`，stagePresets 使用 `overwrite:false` + `immediateRender:false` 避免并发 Tween 冲突。

### 6. Playback（播放引擎）

**文件**: `src/core/player/` + `src/core/state/`

| 模块 | 职责 |
|------|------|
| `ScriptPlayer.ts` | 多段落播放指挥。加载 → `buildSegment()` 烘焙 → `seekToTime(t)` / `playSegment()` |
| `TextPlayer.ts` | 段落级 Timeline 构建。`buildTimeline()` 将字符排入 gsap.Timeline |
| `Segment.ts` | 数据结构：`Segment { timeline, behaviors[], paragraphs[], checkpoints }` |

**Segment + Timeline 架构**：
```
ScriptPlayer.buildSegment()
  ├─ 遍历段落: KineticText.init() → TextPlayer.buildTimeline()
  ├─ 每段子 Timeline 嵌入 Segment Timeline (offset = segmentCursor)
  ├─ 烘焙 exitCheckpoint (stage/layout state snapshot)
  └─ 记录 InFlightAnimation (跨段落未结束的 Tween)

seekToTime(t):
  1. 恢复 entryCheckpoint (stage + layout)
  2. segment.timeline.seek(t)
  3. registerBehaviors(t) — 重注册 Ticker 回调
  4. replayStyles(t) — 重放 StyleRecord 到时间点 t
```

### 7. IDE 层

**文件**: `src/store/`, `src/components/`, `src/views/`

| 模块 | 职责 |
|------|------|
| `editorStore.ts` (Pinia) | 响应式状态中心：kmdContent, isPlaying, canvasConfig, timelineMarkers, layoutTree |
| `DockSystem/` | 递归分栏布局：4 种面板 (editor, preview, monitor, inspector) |
| `App.vue` | 外壳：工具栏 + 停靠布局 |
| `KmdEditor.vue` | Monaco 编辑器集成 |
| `TimeLordBar.vue` | 进度条 + seek 控制 |

---

## KMD 语法速查

```kmd
---
mode: stage              # stage | scroll | page
designWidth: 1920
designHeight: 1080
fontFamily: Sasara Regular
---

// 这是注释

[align=center .glitch]                    # 块选项 + 全局特效
普通文字行 @ .goto(0, 100)               # 排版指令
{Hello} {World} @ f.red.wave f.blue.bold  # 花括号组 + 特效链

---                                       # 场景切换 (淡出当前内容)

**加粗** *斜体* # 标题                    # Markdown 语法糖

> / >> / >>>                              # 时序推进 (字符/组/块级)
~ 减速  ^ 加速                            # 速度糖衣
| 或 |(1s)                                # 段落级暂停 (Segment 时间)

{text} @ f.red.hold(1s).blue              # 特效链时序：红色保持1秒后变蓝
{text} @ f.pause(2s)                      # 舞台暂停
{text} @ f.cam.move(100,0,1s)!            # 阻塞舞台指令 (! = blocking)
```

**指令语法**：`f.effect(params)` 视觉特效 | `.instruction` 排版指令 | `cam.command` 舞台指令
**特效链**：`f.red.hold(1s).wave(amp=5)` — 点分隔，按序执行
**Blocking (`!`)**：指令后加 `!` 表示后续内容等待该指令完成

---

## 代码地图

```
src/
├── core/
│   ├── App.ts                    # Pixi Application 单例，字体加载
│   ├── KineticText.ts            # 段落容器 (init/rebuild/play/bakeTimeline)
│   ├── KineticChar.ts            # 字符对象 (三层变换 + modifier + style snapshot)
│   ├── TokenWrapper.ts           # Token 分组容器
│   ├── parser/
│   │   ├── Parser.ts             # KMD 解析入口 (单例: parser)
│   │   ├── KMDScanner.ts         # 行级词法扫描器
│   │   ├── KMDCommandParser.ts   # @ 指令链解析
│   │   └── types.ts              # 解析器类型定义
│   ├── layout/
│   │   ├── LayoutEngine.ts       # 全局垂直流 + globalMarkers (单例: layout)
│   │   ├── LayoutStreamBuilder.ts # Token → LayoutStream 转换
│   │   ├── TextLayoutEngine.ts   # 两趟扫描坐标引擎 (phantom + main)
│   │   ├── LayoutManager.ts      # Operator/Expander 注册表 (单例: layoutManager)
│   │   ├── layoutPresets.ts      # 排版指令算子 (goto/flow/mark/offset...)
│   │   ├── layoutExpanders.ts    # 排版指令展开器 (up→pushDisplayOffset...)
│   │   └── types.ts              # LayoutContext, LayoutResult, MarkerMap
│   ├── effects/
│   │   ├── EffectManager.ts      # 特效注册表 + mutex (单例: effectManager)
│   │   ├── EffectProcessor.ts    # 四轨分类 + 三路分流 + 参数解析
│   │   ├── StyleManager.ts       # 样式注册表 + mutex (单例: styleManager)
│   │   ├── presets.ts            # 28 种特效实现
│   │   └── styles.ts             # 18 种样式实现
│   ├── stage/
│   │   ├── StageManager.ts       # 三层摄影机 + 世界容器 (单例: stageManager)
│   │   └── stagePresets.ts       # 舞台指令实现 (cam.move/zoom/reset...)
│   ├── player/
│   │   └── ScriptPlayer.ts       # 多段落播放 (buildSegment/seekToTime/play)
│   ├── render/text/
│   │   ├── TextPlayer.ts         # 段落 Timeline 构建 (buildTimeline/unrollChain)
│   │   └── TextBuilder.ts        # Parser→Layout→Pixi 桥接
│   ├── state/
│   │   └── Segment.ts            # Segment/Checkpoint/ParagraphUnit 接口
│   ├── editor/
│   │   └── kmd-lang.ts           # Monaco Monarch 语法定义
│   └── filters/                  # 自定义 Pixi 滤镜 (RGBSplit, Warp)
├── store/
│   └── editorStore.ts            # Pinia 响应式状态 (kmdContent, player, config)
├── components/
│   ├── DockSystem/               # 递归停靠布局
│   ├── Playback/TimeLordBar.vue  # 进度条 + seek
│   └── ...                       # WindowFrame, KmdEditor 等
└── views/                        # InspectorView, MonitorView 等面板
```

---

## 模块逻辑文档

| 文档 | 内容 | 何时查阅 |
|------|------|---------|
| `docs/core/command-routing.md` | @ 指令三路分流、lineScope 机制、5 个踩坑记录 | 修改解析器或排版路由时 |
| `docs/core/effect-pipeline.md` | 特效四轨分类、targetType 守卫、管线路径 A/B | 修改特效应用或添加新特效时 |

*Last Updated: 2026-03-10*
