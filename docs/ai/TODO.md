# KMD Editor - Implementation Plan

## 1. 韵律标准与排版进化 (v1.1.0) - [DONE]
- [x] MD 语法解糖、Baseline V2、相对字距。

## 2. Monaco 编辑器与智能增强 (v1.1.5) - [DONE]
- [x] Monarch 高亮、IntelliSense 补全、实时错误诊断。

## 3. 生产力工具集 (v1.2.0 - v1.3.0) - [DONE]
- [x] Pinia 状态抽离、WindowFrame 容器、标签页系统。

## 4. 自由布局引擎 (v1.4.0 - Docking System) - [DONE]
- [x] 递归 `LayoutTree`、拖拽停靠 (DnD)、原子布局重构。

## 5. 深度联调与同步 (v1.5.0 - Front Matter Sync) - [DONE]
- [x] 双向同步引擎、科技感 Inspector、布局审计系统。

## 6. 时间之主 (v1.6.0 - Segment Graph & Timeline Engine) - [Current]

> **核心架构决策**: 放弃"全局时间线"思维，采用 **Segment Graph + 局部 Timeline** 模型。
> 时间是 Segment 内部的概念，Segment 之间靠逻辑状态 (Checkpoint) 衔接。
> 动画分三轨：Entrance Anim (剧本时间, Timeline 驱动), Persistent Behavior (物理时间, Ticker 驱动), Post-entrance Chain (剧本时间, Timeline 驱动)。

### 6.0 已完成的基础工作 (Foundation)
- [x] **语义溯源**: 注入精确行号 (`line`) 和列号 (`range`)。
- [x] **时长烘培**: 预估逻辑时长，生成基础 `timelineMarkers`。
- [x] **分层属性架构**: 分离 Base/Anim/Behavior 层，解决特效覆盖与闪烁。
- [x] **播放头同步**: 实现播放进度与编辑器行高亮的实时双向同步。
- [x] **状态快照原型**: `StageManager.dumpState/loadState`、`LayoutEngine.dumpState/loadState`。

### 6.1 Phase A — Timeline 化 (线性脚本的精确跳转)

目标：让当前的线性脚本（无分支）支持精确的 seek，跨段落动画被正确插值。

- [x] **A1. 三轨分类 (Triple-Track Classification)**:
    - [x] `EffectMetadata.track: "entrance" | "behavior" | "instant" | "timing"` 字段。
    - [x] `EffectProcessor.classifyByTrack()` / `getTrack()` 分流。
    - [x] 审计全部 28 presets + 18 styles，标注正确的 track。
- [x] **A2. TextPlayer Timeline 化**:
    - [x] `TextPlayer.buildTimeline()` → `TimelineBuildResult { timeline, behaviors, duration, advanceTime }`。
    - [x] 字符入场动画 (entrance) 作为 Timeline 嵌套 Tween。
    - [x] 时序糖衣 (`~`, `^`, `>`, `|`, `>>`, `>>>`) 转化为 cursor offset。
    - [x] 组特效时序链 `unrollGroupChain()` 展开到 Timeline。
    - [x] Behavior 特效收集到 `BehaviorRecord[]`（不进 Timeline）。
    - [x] 旧 `play()` 保留但不再是主路径。
- [x] **A3. Stage Timeline 化**:
    - [x] `stagePresets` 始终返回 Tween（duration=0 用 `gsap.to({duration:0})`）。
    - [x] `cam.reset` 返回 `gsap.timeline()` 替代 `Promise.all()`。
    - [x] 移除 `killTweensOf`（依赖 `overwrite:"auto"`）。
    - [x] Modifier-based (`cam.shake`, `cam.drift`) 用 `tl.call()` 兜底。
    - [x] 导出 `MODIFIER_BASED_COMMANDS` 供 TextPlayer 使用。
- [x] **A4. Segment 数据结构**:
    - [x] `Segment` 接口：`{ id, paragraphs, timeline, behaviors, entryCheckpoint, exitCheckpoint, duration }`。
    - [x] `ParagraphUnit`：`{ paragraphIndex, kineticText, offsetInSegment, behaviors, duration }`。
    - [x] `Checkpoint`：`{ stage, layout, activeParagraphs }`。
- [x] **A5. ScriptPlayer 重构**:
    - [x] `buildSegment()` 替代 `bakeAll()`：构建 Segment 含完整 Timeline。
    - [x] `playSegment()` / `pauseSegment()` / `seekToTime(seconds)` 新 API。
    - [x] `seekTo(paragraphIndex)` 转发到 `seekToTime()`。
    - [x] `toggleAutoPlay()` / `next()` 适配 Segment 模式。
    - [x] Behavior 注册/重注册通过 `registerBehaviors(time)`。
    - [x] TimeLordBar 直接调用 `seekToTime()` 实现精确跳转。
- [ ] **A6. Bridge Tween (跨段落动画衔接)**:
    - [ ] 烘焙时检测：如果一个 Stage Tween 在段落边界未结束，计算剩余量。
    - [ ] 在下一段落的子 Timeline 开头插入延续 Tween。
    - [ ] seek 时 GSAP 自动插值跨段落动画的中间状态。

### 6.2 Phase B — Segment Graph 基础设施 (控制流)

目标：引入 Segment Graph，为分支/循环/异步做好结构准备。

- [ ] **B1. Segment Graph 数据结构**:
    - [ ] `SegmentGraph` 类：`nodes: Segment[]`, `edges: SegmentEdge[]`。
    - [ ] `SegmentEdge`: `{ from, to, condition?, isDefault? }`。
    - [ ] 默认路径（default path）: 所有 `isDefault=true` 边构成的链。
- [ ] **B2. 控制流语法扩展 (Parser)**:
    - [ ] `@branch(condition)` / `@end_branch` — 分支语法。
    - [ ] `@loop(count)` / `@end_loop` — 循环语法。
    - [ ] `@wait_click` / `@wait_signal(name)` — 异步等待语法。
    - [ ] Parser 识别控制流节点，在段落边界处切割 Segment。
- [ ] **B3. Segment Graph 烘焙**:
    - [ ] 分支：每条 arm 独立烘焙为 Segment，各有自己的 Timeline。
    - [ ] 循环：循环体烘焙一次为 Segment，Checkpoint 记录迭代起始状态。
    - [ ] 异步等待：在等待点切割 Segment，前段 exitCheckpoint 含"待继续动画"描述。
- [ ] **B4. 跳转逻辑升级**:
    - [ ] 同 Segment 内：`timeline.seek(localTime)`。
    - [ ] 跨 Segment（同路径）：恢复目标 Segment 的 `entryCheckpoint` + `timeline.seek()`。
    - [ ] 分支内：恢复分支点 Checkpoint → 进入目标 arm → `timeline.seek()`。
    - [ ] 循环第 N 次：恢复循环入口 Checkpoint → warp-replay (N-1) 次 → `timeline.seek()`。

### 6.3 Phase C — 交互式运行时 (Interactive Runtime)

- [ ] **C1. SignalRegistry**: 跟踪异步事件状态（信号触发/未触发），纳入 Checkpoint。
- [ ] **C2. 游戏化 Segment**: 无预烘焙 Timeline 的 Segment，运行在 Behavior Layer，支持实时玩家输入。
- [ ] **C3. 桥接动画 (Carry-over Anims)**: 非确定性边界处，entryCheckpoint 记录"进行中动画"描述，启动时创建延续补间。

### 6.4 IDE Integration

- [ ] **热重载跳转 (Hot Replay)**:
    - [ ] 实现 Monaco 右键菜单/快捷键"从此处播放"。
    - [ ] 逻辑还原：`segment.timeline.seek(targetTime)` + 恢复 Behavior Modifiers。
- [ ] **Monaco 视觉增强**:
    - [ ] 侧边栏标记：展示 Segment 边界、场景切换点。
    - [ ] 缩略图增强：在 Minimap 上标注 Segment Graph 结构。
- [ ] **交互式属性调参 (Inspector v2)**:
    - [ ] 指令元数据系统：扩展 `EffectManager`，定义指令的 UI 描述。
    - [ ] 实时调参：UI 修改参数 → 自动改写 KMD 源码 → 触发 Hot Replay。

## 7. 资产与视觉进阶
- [ ] **资产库 (Asset Explorer)**: 管理图片、音频资源。
- [ ] **西文 Kerning Pair 自动微调**。
