# Project Memory: Kinetic Typography Engine (KMD)

> **Goal:** 构建一个高性能、插件化、支持复杂排版、艺术化演出和交互式阅读的 KMD 渲染引擎。
> **Stack:** Vue 3 + TypeScript + PixiJS v8 + GSAP

---

## 1. 核心设计哲学 (Core Philosophy)

1.  **文字即演员 (Text as Actor):** 文字拥有物理属性（位置、速度、震动、颜色、滤镜）的实体。
2.  **所见即所读 (WYSIWYR):** 演出指令深度内嵌于文本流，节奏与语义高度统一。
3.  **文学直觉排版 (Literary Intuition):** 定位算子 (`prev`, `next`, `line`) 遵循创作者对“文字盒子”的感知，而非物理像素。
4.  **全异步导演系统 (Director System):** [v0.9.0] 指令执行移至播放期，支持复杂的动画等待、信号分流与节奏控制。

---

## 2. 架构演进历程 (Version History)

### v0.9.0 - v1.0.0: 奠基、预言机与原子演出
*   **异步管线**: 确立了 `init -> applyEffects -> play` 的三相生命周期。
*   **Oracle Pass**: 引入双通扫描（Phantom Pass），使脚本能超前引用 `next.*` 点位。
*   **全知坐标系**: 确立以 `(960, 540)` 为原点的中心化设计空间。

### v1.1.0: 韵律标准与生产级表现
*   **Rhythm Standard**: 引入基于 MD 的韵律语法（`**` 加粗, `*` 轻声, `#` 特殊样式）。
*   **Baseline V2**: 彻底重构排版基准，实现了基于物理 `ascent` 的动态锚点对齐。
*   **Production Font System**: 使用原生 `FontFace` API 解决了 CJK 字体加载竞赛与匹配问题。

### v1.1.5: 智能编辑器与持久化节奏
*   **Intelligent Editor**: 深度集成 Monaco Editor，实现了上下文感知的 Monarch 语法高亮与 IntelliSense。
*   **Persistent Rhythm**: 实现了行级持久化 (`~`/`^`) 与组级持久化 (`:group`) 的速度状态机，解决了糖衣无限累加的逻辑缺陷。

### v1.3.0: 生产力架构与状态抽离
*   **State Decoupling**: 引入 Pinia 建立 `editorStore`，将编辑器状态、播放状态与全局配置解耦。
*   **Workspace System**: 实现了 `WindowFrame` 容器与多标签页布局，支持 Inspector 与 Preview 的多屏协作。

### v1.4.0: 自由布局引擎 (Docking System)
*   **LayoutTree Architecture**: 实现基于递归递归的布局树，支持复杂的嵌套停靠 (Docking) 与分栏。
*   **Atomic Refactoring**: 布局计算从组件内部抽离到独立的布局引擎，支持动态 DnD (拖拽) 交互。

### v1.5.0: 全链路同步与审计系统
*   **Front Matter Sync Engine**: 实现了编辑器源码与 Inspector UI 的双向实时同步。
*   **Layout Audit**: 引入布局审计系统，可导出渲染帧的完整坐标图谱 (Layout JSON)，用于辅助定位排版偏差。

---

## 3. 技术栈演进对照表

| 功能模块 | v1.1.5 | v1.5.0 (Latest) |
| :--- | :--- | :--- |
| **状态管理** | 组件内 State | **Pinia Store (解耦控制层)** |
| **界面布局** | 固定比例网格 | **递归 Docking System (自由停靠)** |
| **双向绑定** | 手动改写源码 | **Front Matter Sync Engine (实时响应)** |
| **调试工具** | Console Log | **Layout Audit System (可视化坐标审计)** |
| **编辑器** | 智能补全/高亮 | **增强型 IDE 集成 + 同步状态反馈** |

---

## 4. 关键技术突破 (Milestones)

### 4.1 命名空间感知的 IntelliSense
1.1.5 引入。通过对 `EffectManager`、`StageManager` 等注册表的深度映射，编辑器现在能识别 `cam.move` 与 `f.red` 的区别，并在输入 `cam.` 或 `f.` 时提供精确的过滤建议。

### 4.2 双层级持久化速度系统
针对 KMD 独特的“文字流即脚本”特性，1.1.5 实现了速度因子的堆栈式管理。单字级 sugar 作用于当前行，而组级指令作用于当前 Token，确保了演出的节奏既能灵活多变，又能在逻辑边界处准时恢复。

---
*Last Updated: 2026-02-05*
